package com.autobingwa.app;

import android.accessibilityservice.AccessibilityService;
import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.AtomicFile;
import android.util.Log;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Calendar;
import java.util.Date;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

// The native engine: SMS in, USSD out, with no web view. Port of engine.js process() and ingest().
//
// What changed in this version (the "everything went to Pending" fix):
//  1. A USSD attempt can no longer hang the queue. Every attempt runs on its own thread with a hard time limit.
//     If it does not finish, the USSD dialog is closed, the payment is marked "check the customer", and the queue moves on.
//  2. A payment has a total time budget, so 10 retries can no longer block the queue for half an hour.
//  3. The transaction list lives in memory and is saved to its own file in the background. Before, every
//     update parsed and rewrote the whole list (up to 4000 rows) on the calling thread, while holding the lock.
//  4. A "Processing" row left behind by a dead worker is cleaned up on every pump, not only after a restart.
//  5. A small diagnostics log (and Android's own record of why the app last died) is kept for support.
final class EngineCore {
    private static final String TAG = "AutoBingwa";
    private static final String FILE = "autobingwa_native";
    private static final Object LOCK = new Object();
    private static final Object WAIT = new Object();
    private static final Object DIAG = new Object();
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor();
    private static final ScheduledExecutorService WRITER = Executors.newSingleThreadScheduledExecutor();
    private static final AtomicBoolean pumping = new AtomicBoolean(false);
    private static volatile boolean recovered = false;
    private static Waiter waiter = null;

    // The transaction list, kept in memory. Every access below holds LOCK.
    private static JSONArray txCache = null;
    private static boolean flushQueued = false;
    private static final long FLUSH_DELAY_MS = 300;

    // One USSD attempt may run its own timeout plus this much longer before it is cut off.
    private static final long ATTEMPT_GRACE_MS = 30_000;
    // One payment (all its retries) may use this long. No retry starts if it could not finish inside it.
    private static final long TX_BUDGET_MS = 2 * 60_000;
    private static volatile Thread lastUssdThread = null;
// How many payments in a row ended with no reply from the phone (cut-off or timed out)
private static int stallStreak = 0;
// After this many in a row, the queue waits STALL_PAUSE_MS before dialing the next payment
private static final int STALL_LIMIT = 2;
private static final long STALL_PAUSE_MS = 15_000;
    private static final Pattern SUCCESS_SCREEN = Pattern.compile(
        "successfully\\s+(purchased|bought|subscribed|activated|recommended)", Pattern.CASE_INSENSITIVE);
    private static final Pattern FAIL_SCREEN = Pattern.compile(
        "not\\s+successful|unsuccessful|not\\s+been\\s+successful|failed", Pattern.CASE_INSENSITIVE);
    private static final Pattern EXPRESS_REFUSED = Pattern.compile("code -[12]\\)");
    private static final Pattern CONN_SCREEN = Pattern.compile(
        "connection\\s+problem|invalid\\s+mmi|mmi\\s+code", Pattern.CASE_INSENSITIVE);
    private EngineCore() {}

    // ---------- small helpers ----------
    private static SharedPreferences sp(Context c) {
        return c.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    private static JSONObject obj(Object... kv) {
        JSONObject o = new JSONObject();
        try {
            for (int i = 0; i + 1 < kv.length; i += 2) o.put(String.valueOf(kv[i]), kv[i + 1]);
        } catch (Exception e) {
            Log.e(TAG, "obj", e);
        }
        return o;
    }

    private static JSONObject resp(String input, String text) {
        return obj("input", input, "text", text);
    }

    private static boolean sameId(Object a, Object b) {
        return String.valueOf(a).equals(String.valueOf(b));
    }

    private static String money(double amount) {
        return amount == Math.floor(amount) ? String.valueOf((long) amount) : String.valueOf(amount);
    }

    private static long positive(long v, long fallback) {
        return v > 0 ? v : fallback;
    }

    private static JSONArray copyOf(JSONArray a) {
        try {
            return new JSONArray(a == null ? "[]" : a.toString());
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    // ---------- diagnostics (kept on the phone, newest 60 lines) ----------
    private static void diag(Context c, String line) {
        Log.w(TAG, "diag " + line);
        synchronized (DIAG) {
            try {
                JSONArray old = new JSONArray(sp(c).getString("diag", "[]"));
                JSONArray out = new JSONArray();
                for (int i = Math.max(0, old.length() - 59); i < old.length(); i++) out.put(old.get(i));
                String stamp = new java.text.SimpleDateFormat("MM-dd HH:mm:ss", Locale.US).format(new Date());
                out.put(stamp + " " + line);
                sp(c).edit().putString("diag", out.toString()).apply();
            } catch (Exception ignored) { }
        }
    }

    private static String reasonName(int r) {
        switch (r) {
            case ApplicationExitInfo.REASON_ANR: return "ANR";
            case ApplicationExitInfo.REASON_CRASH: return "CRASH";
            case ApplicationExitInfo.REASON_CRASH_NATIVE: return "NATIVE CRASH";
            case ApplicationExitInfo.REASON_LOW_MEMORY: return "LOW MEMORY";
            case ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE: return "EXCESSIVE RESOURCE USAGE";
            case ApplicationExitInfo.REASON_USER_REQUESTED: return "USER REQUESTED";
            case ApplicationExitInfo.REASON_USER_STOPPED: return "USER STOPPED";
            case ApplicationExitInfo.REASON_PERMISSION_CHANGE: return "PERMISSION CHANGE";
            case ApplicationExitInfo.REASON_SIGNALED: return "SIGNALED";
            case ApplicationExitInfo.REASON_EXIT_SELF: return "EXIT SELF";
            case ApplicationExitInfo.REASON_DEPENDENCY_DIED: return "DEPENDENCY DIED";
            case ApplicationExitInfo.REASON_INITIALIZATION_FAILURE: return "INIT FAILURE";
            case ApplicationExitInfo.REASON_OTHER: return "OTHER";
            default: return "reason " + r;
        }
    }

    // Android keeps a short record of why this app's process last ended (Android 11+). An ANR shows up here with its cause.
    private static void logExitReasons(Context c) {
        if (Build.VERSION.SDK_INT < 30) return;
        try {
            ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
            if (am == null) return;
            List<ApplicationExitInfo> list = am.getHistoricalProcessExitReasons(c.getPackageName(), 0, 6);
            long seen = sp(c).getLong("exitSeen", 0);
            long newest = seen;
            for (int i = list.size() - 1; i >= 0; i--) { // oldest first
                ApplicationExitInfo e = list.get(i);
                if (e.getTimestamp() <= seen) continue;
                newest = Math.max(newest, e.getTimestamp());
                String when = new java.text.SimpleDateFormat("MM-dd HH:mm:ss", Locale.US).format(new Date(e.getTimestamp()));
                diag(c, "LAST EXIT " + when + " " + reasonName(e.getReason()) + " | " + e.getDescription());
            }
            if (newest > seen) sp(c).edit().putLong("exitSeen", newest).apply();
        } catch (Throwable t) {
            Log.e(TAG, "exit reasons", t);
        }
    }

    // ---------- switches (kept on the phone, so they survive the app being closed) ----------
    static boolean owns(Context c) { return sp(c).getBoolean("owner", false); }
    static boolean running(Context c) { return sp(c).getBoolean("running", false); }

    static void setOwner(Context c, boolean on) {
        boolean was = owns(c);
        SharedPreferences.Editor ed = sp(c).edit().putBoolean("owner", on);
        if (on && !was) ed.putLong("ownerSince", System.currentTimeMillis());
        ed.commit();
        if (on) pump(c);
    }

    static long ownerSince(Context c) { return sp(c).getLong("ownerSince", 0); }

    // True while a native transaction is waiting or being dialed
    static boolean busy(Context c) {
        synchronized (LOCK) {
            JSONArray a = load(c);
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o == null) continue;
                String s = o.optString("status");
                if ("Pending".equals(s) || "Processing".equals(s)) return true;
            }
            return false;
        }
    }
    static void setRunning(Context c, boolean on) {
        sp(c).edit().putBoolean("running", on).commit();
        if (on) pump(c);
    }

    // ---------- transactions (same field names as the app's transactions:list) ----------
    // The list is kept in memory and saved to its own file by a background thread.
    // All of load, save, flush and the code that touches txCache must hold LOCK.
    private static File txFile(Context c) {
        return new File(c.getFilesDir(), "autobingwa_tx.json");
    }

    private static JSONArray readFromDisk(Context c) {
        try {
            AtomicFile af = new AtomicFile(txFile(c));
            if (af.getBaseFile().exists()) {
                return new JSONArray(new String(af.readFully(), StandardCharsets.UTF_8));
            }
        } catch (Exception e) {
            Log.e(TAG, "tx file read", e);
        }
        // First start after this update: the rows used to live in the preferences file.
        try {
            String old = sp(c).getString("tx", null);
            if (old != null) return new JSONArray(old);
        } catch (Exception ignored) { }
        return new JSONArray();
    }

    private static JSONArray load(Context c) {
        if (txCache == null) txCache = readFromDisk(c.getApplicationContext());
        return txCache;
    }

    private static void save(Context c, JSONArray a) {
        txCache = a;
        if (flushQueued) return;
        flushQueued = true;
        final Context app = c.getApplicationContext();
        WRITER.schedule(new Runnable() {
            @Override public void run() { flush(app); }
        }, FLUSH_DELAY_MS, TimeUnit.MILLISECONDS);
    }

    // Runs on the writer thread. The list is turned into text under the lock; the slow disk write happens outside it.
    private static void flush(Context c) {
        String json;
        synchronized (LOCK) {
            flushQueued = false;
            if (txCache == null) return;
            json = txCache.toString();
        }
        AtomicFile af = new AtomicFile(txFile(c));
        FileOutputStream out = null;
        try {
            out = af.startWrite();
            out.write(json.getBytes(StandardCharsets.UTF_8));
            af.finishWrite(out);
            if (sp(c).contains("tx")) sp(c).edit().remove("tx").apply(); // old copy, no longer needed
        } catch (Exception e) {
            Log.e(TAG, "tx file write", e);
            if (out != null) af.failWrite(out);
        }
    }

    private static boolean hasCode(Context c, String code) {
        synchronized (LOCK) {
            JSONArray a = load(c);
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o != null && code.equals(o.optString("mpesaId", ""))) return true;
            }
            return false;
        }
    }

    private static boolean terminal(String s) {
        return "Completed".equals(s) || "Failed".equals(s) || "Skipped".equals(s) || "Unmatched".equals(s);
    }
    private static final int KEEP_SAVED = 300;    // finished rows the app has saved: newest 300 kept
private static final int KEEP_UNSAVED = 4000; // finished rows the app has NOT saved yet: never dropped before this

    // True when the app has saved this row exactly as it is now
    private static boolean saved(JSONObject o) {
        return o.optLong("appRev", -1) >= o.optLong("rev", 1);
    }

    // Open transactions are never dropped. Finished ones the app already saved go first, oldest first.
    private static JSONArray trimRows(JSONArray a) {
        int savedN = 0, unsavedN = 0;
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o == null || !terminal(o.optString("status"))) continue;
            if (saved(o)) savedN++; else unsavedN++;
        }
        int dropSaved = Math.max(0, savedN - KEEP_SAVED);
        int dropUnsaved = Math.max(0, unsavedN - KEEP_UNSAVED);
        if (dropSaved == 0 && dropUnsaved == 0) return a;
        JSONArray t = new JSONArray();
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o != null && terminal(o.optString("status"))) {
                if (saved(o)) {
                    if (dropSaved > 0) { dropSaved--; continue; }
                } else if (dropUnsaved > 0) {
                    dropUnsaved--;
                    continue;
                }
            }
            t.put(a.opt(i));
        }
        return t;
    }

    private static void add(Context c, JSONObject tx) {
        synchronized (LOCK) {
            JSONArray a = load(c);
            try { tx.put("rev", 1); } catch (Exception ignored) { }
            a.put(tx);
            a = trimRows(a);
            save(c, a);
        }
    }

    private static JSONObject update(Context c, String id, JSONObject patch) {
        synchronized (LOCK) {
            JSONArray a = load(c);
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o == null || !id.equals(o.optString("id"))) continue;
                try {
                    Iterator<String> it = patch.keys();
                    while (it.hasNext()) {
                        String k = it.next();
                        o.put(k, patch.get(k));
                    }
                    o.put("rev", o.optLong("rev", 1) + 1);
                } catch (Exception e) {
                    Log.e(TAG, "update", e);
                }
                save(c, a);
                return o;
            }
            return null;
        }
    }

      // What the app reads: the switches, the token charge counter and the transactions the app still needs.
    // Finished rows the app has already saved are NOT sent again. At most 300 finished rows go in one call,
    // oldest first; the app asks again every 3 seconds, so a big backlog arrives in pieces.
    private static final int MAX_SYNC = 300;

    static JSONObject state(Context c) {
        synchronized (LOCK) {
            JSONArray log = new JSONArray();
            try { log = new JSONArray(sp(c).getString("diag", "[]")); } catch (Exception ignored) { }
            JSONArray a = load(c);
            JSONArray out = new JSONArray();
            int finished = 0;
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o == null) continue;
                boolean open = !terminal(o.optString("status"));
                if (!open) {
                    if (saved(o)) continue;
                    if (finished >= MAX_SYNC) continue;
                    finished++;
                }
                try { out.put(new JSONObject(o.toString())); } catch (Exception ignored) { }
            }
            return obj("owner", owns(c), "running", running(c),
                "chargesTotal", sp(c).getLong("chargesTotal", 0), "transactions", out, "diag", log);
        }
    }

    // null when the native engine may be switched on, otherwise the reason it may not
    static String cannotOwn(Context c) {
        JSONObject snap = EngineStore.snapshot(c);
        if (snap.optJSONArray("offers") == null || snap.optJSONObject("wallet") == null) {
            return "The service has no copy of the app's data yet. Open Settings and check that it matches.";
        }
        return null;
    }

    // True the first time an SMS id is seen. Native keeps its own list and never touches the app's SMS queue.
    // (The payment code check in ingest() is the real guard against a double sale, so this save need not wait for the disk.)
    private static boolean markHandled(Context c, String id) {
        synchronized (LOCK) {
            try {
                JSONArray h = new JSONArray(sp(c).getString("handled", "[]"));
                for (int i = 0; i < h.length(); i++) if (id.equals(h.getString(i))) return false;
                h.put(id);
                if (h.length() > 500) {
                    JSONArray t = new JSONArray();
                    for (int i = h.length() - 500; i < h.length(); i++) t.put(h.get(i));
                    h = t;
                }
                sp(c).edit().putString("handled", h.toString()).apply();
                return true;
            } catch (Exception e) {
                return false;
            }
        }
    }

    // ---------- tokens ----------
    // The app's wallet copy minus the charges native made that the app has not applied yet
    private static long effectiveUnits(Context c) {
        JSONObject w = EngineStore.snapshot(c).optJSONObject("wallet");
        long units = w == null ? 0 : w.optLong("units", 0);
        long total = sp(c).getLong("chargesTotal", 0);
        // no counter in the wallet means nothing is owed yet
        long applied = w == null ? 0 : w.optLong("chargesApplied", total);
        return units - Math.max(0, total - applied);
    }
    static boolean hasToken(Context c) {
        JSONObject w = EngineStore.snapshot(c).optJSONObject("wallet");
        long until = w == null ? 0 : w.optLong("unlimitedUntil", 0);
        return until > System.currentTimeMillis() || effectiveUnits(c) > 0;
    }

    // One token per dialed transaction, whatever the outcome (unlimited plans are not charged)
    private static void charge(Context c) {
        synchronized (LOCK) {
            JSONObject w = EngineStore.snapshot(c).optJSONObject("wallet");
            long until = w == null ? 0 : w.optLong("unlimitedUntil", 0);
            if (until > System.currentTimeMillis()) return;
            if (effectiveUnits(c) > 0) {
                sp(c).edit().putLong("chargesTotal", sp(c).getLong("chargesTotal", 0) + 1).commit();
            }
        }
    }

    // ---------- incoming SMS ----------
    // Called for every message SmsStore saves. Does nothing unless the native engine is switched on.
    static void onSms(Context c, String id, String sender, String body, long time) {
        if (!owns(c)) return;
        try {
            if (id == null || !markHandled(c, id)) return; // the same SMS twice
            String text = body == null ? "" : body;
            boolean isPayment = Pattern.compile("^[A-Z0-9]{10}\\s+Confirmed", Pattern.CASE_INSENSITIVE)
                .matcher(text.trim()).find();
            EngineRules.Conf conf = isPayment ? null : EngineRules.classifyConfirmation(text);
            if (conf != null) {
                boolean used = confirm(c, conf, text);
                Log.d(TAG, "native confirmation " + conf.status + (used ? " used" : " no transaction waiting"));
                return;
            }
            // Same rule as the app: only a sender that looks like M-PESA can start a purchase
            String letters = (sender == null ? "" : sender).toLowerCase().replaceAll("[^a-z]", "");
            if (!letters.contains("mpesa")) return;
            if (time < ownerSince(c)) return; // older payments stay with the app's engine
            ingest(c, text);
        } catch (Exception e) {
            Log.e(TAG, "native onSms", e);
        }
    }

    private static void ingest(Context c, String body) {
        EngineRules.Mpesa p = EngineRules.parseMpesa(body);
        if (!p.ok || p.code.isEmpty()) return;
        if (hasCode(c, p.code)) return;

        JSONObject snap = EngineStore.snapshot(c);
        JSONArray offers = snap.optJSONArray("offers");
        JSONObject cfg = snap.optJSONObject("config");
        if (cfg == null) cfg = new JSONObject();
        long now = System.currentTimeMillis();

        boolean typeOn;
        if ("mpesa".equals(p.type)) typeOn = cfg.optBoolean("processMpesa", true);
        else if ("paybill".equals(p.type)) typeOn = cfg.optBoolean("processPaybill", true);
        else typeOn = cfg.optBoolean("processTill", true);

        boolean blacklisted = false;
        if (!p.phone.isEmpty()) {
            String key = p.phone.replaceAll("\\D", "");
            key = key.length() > 9 ? key.substring(key.length() - 9) : key;
            JSONArray bl = snap.optJSONArray("blacklist");
            for (int i = 0; bl != null && key.length() == 9 && i < bl.length(); i++) {
                if (key.equals(bl.optString(i))) blacklisted = true;
            }
        }

        String skip = "";
        if (!typeOn) skip = "This message type is switched off in Settings";
        else if (blacklisted) skip = "Customer is blacklisted";

        EngineRules.Pick hit = (skip.isEmpty() && !p.phone.isEmpty()) ? EngineRules.pickOffer(offers, p.amount, now) : null;
        JSONObject offer = hit == null ? null : hit.offer;
        String status = !skip.isEmpty() ? "Skipped" : offer == null ? "Unmatched" : running(c) ? "Pending" : "Paused";

        String offerName;
        if (!skip.isEmpty()) offerName = skip;
        else if (offer != null) offerName = offer.optString("name", "");
        else offerName = p.phone.isEmpty() ? "No customer number in message" : "No matching offer";

        boolean verified = offer != null && (offer.optBoolean("smart", false)
            || (offer.has("signature") && !offer.isNull("signature") && !Boolean.FALSE.equals(offer.opt("signature")))
            || offer.optBoolean("sigEnabled", false));

        JSONObject tx = obj(
            "id", p.code + "-" + now, "mpesaId", p.code, "name", p.name, "phone", p.phone,
            "account", p.account, "messageType", p.type, "blacklisted", blacklisted, "amount", p.amount,
            "rawMessage", p.raw, "status", status,
            "offerId", offer == null ? JSONObject.NULL : offer.opt("id"),
            "fallbackOf", (hit != null && hit.primary != null) ? hit.primary.opt("id") : JSONObject.NULL,
            "offerName", offerName,
            "ussd", offer == null ? "" : EngineRules.fillPhone(offer.optString("ussd", ""), p.phone),
            "verified", verified,
            "cost", offer == null ? 0 : offer.optDouble("safPrice", 0),
            "attempts", 0, "responses", new JSONArray(), "createdAt", now,
            "engine", "native");
        add(c, tx);
        Log.d(TAG, "native ingest " + p.code + " " + status);
        pump(c);
    }

    // ---------- waiting for Safaricom's SMS ----------
    private static final class Waiter {
        final String phone;
        volatile EngineRules.Conf got = null;
        volatile String text = "";
        volatile boolean strict = false;   // only an SMS naming this customer's number may be accepted
        volatile boolean numbered = false; // the accepted SMS named this customer's number
        Waiter(String phone) { this.phone = phone; }
    }

    private static Waiter arm(String phone) {
        synchronized (WAIT) {
            waiter = new Waiter(phone);
            return waiter;
        }
    }

    private static void disarm(Waiter w) {
        synchronized (WAIT) {
            if (waiter == w) waiter = null;
        }
    }

    private static boolean confirm(Context ctx, EngineRules.Conf cf, String text) {
        Waiter w;
        synchronized (WAIT) { w = waiter; }
        if (w != null) {
            boolean mine = true;
            boolean numbered = false;
            if (cf.phone != null && !w.phone.isEmpty()) {
                EngineRules.Phone n = EngineRules.normalizePhone(cf.phone);
                if (n != null && !n.phone.equals(w.phone)) mine = false; // a reply about another customer
                else if (n != null) numbered = true;
            }
            // "Thank you for choosing Safaricom" has no phone field: check the numbers inside the text
            if (mine && cf.phone == null && text != null && !w.phone.isEmpty()) {
                java.util.List<EngineRules.Phone> named = EngineRules.phonesIn(text);
                boolean hit = false;
                for (EngineRules.Phone p : named) if (p.phone.equals(w.phone)) hit = true;
                if (!named.isEmpty() && !hit) mine = false; // names a different customer
                else if (hit) numbered = true;
            }
            // Strict: an SMS that does not name this customer's number is ignored
            if (mine && w.strict && !numbered) mine = false;
            if (mine) {
                synchronized (w) {
                    w.got = cf;
                    w.text = text;
                    w.numbered = numbered;
                    w.notifyAll();
                }
                return true;
            }
        }
        return cancelPendingFallback(ctx, cf, text);
    }

    // A late success SMS cancels a backup that is still waiting out its delay
    private static boolean cancelPendingFallback(Context ctx, EngineRules.Conf cf, String text) {
        if (!"success".equals(cf.status) || cf.phone == null) return false;
        EngineRules.Phone n = EngineRules.normalizePhone(cf.phone);
        if (n == null) return false;
        String fbId = null, fromId = "", trigger = "";
        JSONArray prev = new JSONArray();
        synchronized (LOCK) {
            JSONArray a = load(ctx);
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o != null && o.optBoolean("fallbackPending", false) && "Scheduled".equals(o.optString("status"))
                        && n.phone.equals(o.optString("phone"))) {
                    fbId = o.optString("id");
                    fromId = o.optString("fallbackFromId", "");
                    trigger = o.optString("fallbackTrigger", "");
                    prev = copyOf(o.optJSONArray("responses")); // a copy: the live list changes under the lock
                    break;
                }
            }
        }
        if (fbId == null) return false;
        JSONArray rs = new JSONArray();
        for (int i = 0; i < prev.length(); i++) rs.put(prev.opt(i));
        if (text != null && !text.isEmpty()) rs.put(resp("SMS", text));
        rs.put(resp("-", "Fallback cancelled: the original purchase was confirmed."));
        update(ctx, fbId, obj("status", "Skipped", "fallbackPending", false, "scheduledFor", JSONObject.NULL, "responses", rs));
        if ("failed".equals(trigger) && !fromId.isEmpty()) update(ctx, fromId, obj("status", "Completed"));
        pump(ctx);
        return true;
    }

    private static EngineRules.Conf awaitConfirm(Waiter w, long ms) {
        long end = System.currentTimeMillis() + ms;
        synchronized (w) {
            try {
                while (w.got == null) {
                    long left = end - System.currentTimeMillis();
                    if (left <= 0) break;
                    w.wait(left);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        disarm(w);
        return w.got;
    }

    // ---------- the queue ----------
    static void pump(final Context ctx) {
        final Context c = ctx.getApplicationContext();
        if (!pumping.compareAndSet(false, true)) return;
        WORKER.execute(new Runnable() {
            @Override
            public void run() {
                boolean crashed = false;
                try {
                    if (!recovered) { logExitReasons(c); recovered = true; }
                    recoverOrphans(c); // nothing is being processed at this point, so a "Processing" row is left over
                    for (;;) {
                        if (!owns(c) || !running(c) || !hasToken(c)) break;
                        JSONObject next = oldestPending(c);
                        if (next == null) break;
                        try {
                            process(c, next);
                        } catch (Throwable e) {
                            Log.e(TAG, "native process", e);
                            diag(c, "process error for " + next.optString("phone") + ": " + e);
                            update(c, next.optString("id"), obj("status", "Failed", "completedAt", System.currentTimeMillis(),
                                "responses", new JSONArray().put(resp("-",
                                    "The native engine hit an error. Check your balance, then retry. " + e))));
                            Notifier.alert(c, "idle", "", "");
                        }
                        if (stallStreak >= STALL_LIMIT) {
    diag(c, stallStreak + " stalled payments in a row, pausing " + (STALL_PAUSE_MS / 1000) + "s so the phone can recover");
    Thread.sleep(STALL_PAUSE_MS);
}
                        JSONObject usGap = EngineStore.snapshot(c).optJSONObject("ussd");
                        long gap = usGap != null ? usGap.optLong("betweenMs", 250)
                            : (EngineStore.snapshot(c).optJSONObject("config") == null ? 400
                            : EngineStore.snapshot(c).optJSONObject("config").optLong("gapMs", 400));
                        Thread.sleep(Math.max(0, gap));
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } catch (Throwable t) {
                    crashed = true;
                    Log.e(TAG, "native pump", t);
                    diag(c, "queue stopped: " + t);
                } finally {
                    pumping.set(false);
                }
                // something may have arrived just as the loop ended
                if (!crashed && owns(c) && running(c) && hasToken(c) && oldestPending(c) != null) pump(c);
            }
        });
    }

    // A "Processing" row with no worker behind it (phone restarted, app killed, worker died) is marked Failed so it is checked before a retry
    private static void recoverOrphans(Context c) {
        int n = 0;
        synchronized (LOCK) {
            JSONArray a = load(c);
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o != null && "Processing".equals(o.optString("status"))) {
                    try {
                        o.put("status", "Failed");
                        o.put("rev", o.optLong("rev", 1) + 1);
                        o.put("completedAt", System.currentTimeMillis());
                        o.put("responses", new JSONArray().put(resp("-",
                            "The app closed while this was processing. Check your balance, then retry.")));
                        n++;
                    } catch (Exception ignored) { }
                }
            }
            if (n > 0) save(c, a);
        }
        if (n > 0) {
            diag(c, "cleared " + n + " payment(s) left in Processing");
            Notifier.alert(c, "idle", "", "");
        }
    }

    // A backup (fallback) goes before any other waiting payment; otherwise the oldest goes first.
    // While a fallback is still waiting out its delay, no other payment may start.
    // Returns a copy, so the worker never reads a row that another thread is changing.
    private static JSONObject oldestPending(Context c) {
        synchronized (LOCK) {
            JSONArray a = load(c);
            boolean fbWaiting = false;
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o != null && o.optBoolean("isFallback", false) && o.optBoolean("fallbackPending", false)
                        && "Scheduled".equals(o.optString("status"))) { fbWaiting = true; break; }
            }
            JSONObject best = null;
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o == null || !"Pending".equals(o.optString("status"))) continue;
                if (fbWaiting && !o.optBoolean("isFallback", false)) continue;
                if (best == null) { best = o; continue; }
                boolean oFb = o.optBoolean("isFallback", false);
                boolean bestFb = best.optBoolean("isFallback", false);
                if (oFb && !bestFb) best = o;
                else if (oFb == bestFb && o.optLong("createdAt", 0) < best.optLong("createdAt", 0)) best = o;
            }
            if (best == null) return null;
            try {
                return new JSONObject(best.toString());
            } catch (Exception e) {
                return best;
            }
        }
    }

    private static JSONObject findOffer(JSONArray offers, Object id) {
        for (int i = 0; offers != null && i < offers.length(); i++) {
            JSONObject o = offers.optJSONObject(i);
            if (o != null && sameId(o.opt("id"), id)) return o;
        }
        return null;
    }

    private static long nextDayAt(String hhmm, long from) {
        int h = 6, m = 0;
        try {
            String[] p = (hhmm == null || hhmm.isEmpty() ? "06:00" : hhmm).split(":");
            h = Integer.parseInt(p[0].trim());
            m = p.length > 1 ? Integer.parseInt(p[1].trim()) : 0;
        } catch (Exception ignored) { }
        Calendar d = Calendar.getInstance();
        d.setTimeInMillis(from);
        d.add(Calendar.DAY_OF_YEAR, 1);
        d.set(Calendar.HOUR_OF_DAY, h);
        d.set(Calendar.MINUTE, m);
        d.set(Calendar.SECOND, 0);
        d.set(Calendar.MILLISECOND, 0);
        return d.getTimeInMillis();
    }

    // "*180*5*2*0712345678*1*1#" -> first "*180#", steps [5, 2, 0712345678, 1, 1]
    private static String[] splitUssd(String ussd) {
        String t = (ussd == null ? "" : ussd).trim().replaceAll("\\s+", "");
        t = t.replaceFirst("^\\*", "").replaceFirst("#$", "");
        java.util.ArrayList<String> parts = new java.util.ArrayList<>();
        for (String p : t.split("\\*")) if (!p.isEmpty()) parts.add(p);
        if (parts.isEmpty()) return null;
        String[] out = new String[parts.size()];
        out[0] = "*" + parts.get(0) + "#";
        for (int i = 1; i < parts.size(); i++) out[i] = parts.get(i);
        return out;
    }

    // Same decisions as realBridge.runUssd in index.js
    private static JSONObject runUssd(Context c, String ussd, String mode, JSONObject offer, int slot,
                                      long stepMs, long keyMs, long totalMs) {
        String[] parts = splitUssd(ussd);
        if (parts == null) return obj("status", "error", "message", "This offer has no USSD code", "responses", new JSONArray());
        String first = parts[0];
        String[] steps = new String[parts.length - 1];
        System.arraycopy(parts, 1, steps, 0, steps.length);

        // A complete, switched-on signature always uses the dialer window
        JSONObject sigObj = offer.optJSONObject("sig");
        boolean sigOn = !"Express".equals(mode) && sigObj != null && sigObj.optBoolean("complete", false)
            && (offer.optBoolean("smart", false) || offer.optBoolean("sigEnabled", false));
        if (sigOn) {
            JSONArray st = sigObj.optJSONArray("steps");
            if (st == null) return obj("status", "error", "message",
                "The saved signature could not be used. Nothing was sent. Learn it again.", "responses", new JSONArray());
            return UssdFlow.run(c, slot, first, steps, stepMs, keyMs, totalMs, false, st);
        }

        if ("Express".equals(mode)) {
            JSONObject r = UssdFlow.run(c, slot, first, steps, stepMs, keyMs, totalMs, true, null);
            String msg = r.optString("message", "");
            if ("error".equals(r.optString("status")) && EXPRESS_REFUSED.matcher(msg).find()) {
                // the phone refused the silent request: try once more, then use the dialer window
                try { Thread.sleep(1500); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                r = UssdFlow.run(c, slot, first, steps, stepMs, keyMs, totalMs, true, null);
                msg = r.optString("message", "");
                if ("error".equals(r.optString("status")) && EXPRESS_REFUSED.matcher(msg).find()
                        && UssdAccessibilityService.instance != null) {
                    r = UssdFlow.run(c, slot, first, steps, stepMs, keyMs, totalMs, false, null);
                }
            }
            return r;
        }
        return UssdFlow.run(c, slot, first, steps, stepMs, keyMs, totalMs, false, null);
    }

    // Presses Back on whatever USSD dialog is still open, so the next payment starts from a clean screen
    private static void closeUssdDialog() {
        try {
            UssdAccessibilityService s = UssdAccessibilityService.instance;
            if (s == null) return;
            s.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK);
            Thread.sleep(500);
            s.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Throwable ignored) { }
    }

    // runUssd with a hard time limit. If the USSD session hangs (a dialog that never answers, a lost accessibility
    // event) the attempt is cut off, the dialog is closed and the queue moves on. A cut-off attempt is reported as
    // "no_reply": the purchase may have gone through, so no backup offer is started and the customer must be checked.
    private static JSONObject runUssdGuarded(final Context c, final String ussd, final String mode, final JSONObject offer,
                                             final int slot, final long stepMs, final long keyMs, final long totalMs)
            throws Exception {
final long limit = Math.max(totalMs, UssdFlow.minBudgetMs) + 45_000;

        // A previous attempt that would not stop: give it a moment, then carry on regardless
        Thread old = lastUssdThread;
        if (old != null && old.isAlive()) {
            old.join(10_000);
            if (old.isAlive()) diag(c, "a previous USSD attempt is still stuck; starting the next one anyway");
        }

        final JSONObject[] out = new JSONObject[1];
        final Throwable[] err = new Throwable[1];
        Thread t = new Thread(new Runnable() {
            @Override public void run() {
                try {
                    out[0] = runUssd(c, ussd, mode, offer, slot, stepMs, keyMs, totalMs);
                } catch (Throwable e) {
                    err[0] = e;
                }
            }
        }, "ab-ussd");
        t.setDaemon(true);
        lastUssdThread = t;
        t.start();
        t.join(limit);

        if (t.isAlive()) {
            diag(c, "USSD attempt hung for " + (limit / 1000) + "s, cutting it off (" + ussd + ")");
            t.interrupt();
            closeUssdDialog();
            UssdAccessibilityService.end(); // stop the polling and give the keyboard back, even if the stuck thread never exits
            t.join(3_000);
            return obj("status", "no_reply",
                "message", "The USSD session stopped responding after " + (limit / 1000) + " seconds and was closed.",
                "responses", new JSONArray());
        }
        if (err[0] != null) {
            if (err[0] instanceof Exception) throw (Exception) err[0];
            throw new Exception(err[0]);
        }
        return out[0] != null ? out[0] : obj("status", "error", "message", "The USSD attempt returned nothing.",
            "responses", new JSONArray());
    }

    // Runs ONE transaction to its final state (port of process() in engine.js, without fallbacks yet)
    private static void process(Context c, JSONObject startTx) throws Exception {
        final String id = startTx.optString("id");
        final String phone = startTx.optString("phone");
        final double amount = startTx.optDouble("amount", 0);
        final String label = "KES " + money(amount) + " \u00b7 " + phone;
        final long t0 = System.currentTimeMillis();

        JSONObject snap = EngineStore.snapshot(c);
        JSONArray offers = snap.optJSONArray("offers");
        JSONObject cfg = snap.optJSONObject("config");
        if (cfg == null) cfg = new JSONObject();
        JSONObject us = snap.optJSONObject("ussd"); // the USSD Settings page
        UssdFlow.apply(us);
        update(c, id, obj("status", "Processing", "startedAt", System.currentTimeMillis()));
        Notifier.alert(c, "processing", "Processing", label);

        JSONObject offer = findOffer(offers, startTx.opt("offerId"));
        if (offer == null) { failNow(c, id, label, "The offer was deleted."); return; }
        String ussd = startTx.optString("ussd");

        // Re-check the time window just before dialing (a payment can wait in the queue past closing time)
        JSONObject tw = offer.optJSONObject("tw");
        Object fbOf = startTx.opt("fallbackOf");
        boolean twOn = tw != null && tw.optBoolean("on", false);
        boolean viaAlt = fbOf != null && fbOf != JSONObject.NULL;
        boolean fixed = startTx.optBoolean("fixedOffer", false);
        long nowMs = System.currentTimeMillis();
        if (fixed) {
            // A backup or direct transaction: the offer is fixed. Only its own time window applies.
            if (twOn && !EngineRules.inWindow(tw, nowMs)) {
                Object altId = tw.opt("altId");
                JSONObject alt = (altId == null || altId == JSONObject.NULL || "".equals(altId)) ? null : findOffer(offers, altId);
                if (alt == null || !alt.optBoolean("enabled", true) || !EngineRules.inWindow(alt.optJSONObject("tw"), nowMs)) {
                    failNow(c, id, label, "This offer is outside its time window and has no alternative offer.");
                    return;
                }
                Object primaryId = offer.opt("id");
                offer = alt;
                ussd = EngineRules.fillPhone(offer.optString("ussd", ""), phone);
                update(c, id, obj("offerId", offer.opt("id"), "offerName", offer.optString("name", ""), "ussd", ussd,
                    "cost", offer.optDouble("safPrice", 0), "fallbackOf", primaryId));
            }
        } else if (twOn || viaAlt) {
            EngineRules.Pick hit = EngineRules.pickOffer(offers, amount, nowMs);
            if (hit == null) { failNow(c, id, label, "This offer is outside its time window and has no alternative offer."); return; }
            if (!sameId(hit.offer.opt("id"), offer.opt("id"))) {
                offer = hit.offer;
                ussd = EngineRules.fillPhone(offer.optString("ussd", ""), phone);
                update(c, id, obj("offerId", offer.opt("id"), "offerName", offer.optString("name", ""), "ussd", ussd,
                    "cost", offer.optDouble("safPrice", 0),
                    "fallbackOf", hit.primary == null ? JSONObject.NULL : hit.primary.opt("id")));
            }
        }

        // The offer's own mode wins. Nothing saved uses the mode from the app settings.
        String offerType = offer.optString("type", "");
        String mode = ("Express".equals(offerType) || "Advanced".equals(offerType))
            ? offerType
            : cfg.optString("mode", "Advanced");
        // The offer's own SIM wins. "Default" (or nothing saved) uses the SIM from the app settings.
        String simPref = offer.optString("execSim", "Default");
        String simName = ("SIM 1".equals(simPref) || "SIM 2".equals(simPref))
            ? simPref
            : cfg.optString("bingwaSim", "SIM 2");
        int slot = "SIM 1".equals(simName) ? 0 : 1;
        long stepMs = positive(cfg.optLong("stepTimeoutSec", 20), 20) * 1000;
        long keyMs = positive(cfg.optLong("keyDelayMs", 80), 80);
        long totalMs = positive(cfg.optLong("totalTimeoutSec", 90), 90) * 1000;
        long retryMs = positive(cfg.optLong("retryAfterSec", 15), 15) * 1000;
        long confirmMs = positive(cfg.optLong("confirmWaitSec", 45), 45) * 1000;
        if (us != null) {
            stepMs = positive(us.optLong("advancedTimeoutSec", 30), 30) * 1000;
            keyMs = us.optLong("keyInputDelayMs", 50);
            if ("Express".equals(mode)) totalMs = positive(us.optLong("expressTimeoutSec", 20), 20) * 1000;
        }
        int maxRetries = offer.optBoolean("autoRetry", false) ? Math.max(0, offer.optInt("retryCount", 0))
            : (us != null && us.optBoolean("autoRetry", false) ? 1 : 0);
        boolean retryFailed = offer.optBoolean("retryFailed", true);
        boolean retryPending = offer.optBoolean("retryPending", false);

        int attempt = 0;
        boolean ok = false;
        boolean alreadyRec = false;
        String kind = "failed"; // ok | failed (nothing bought) | pending (may have sold) | stop (retrying cannot help)
        JSONArray rs = new JSONArray();
        for (;;) {
            attempt++;
            Waiter w = arm(phone);
            JSONObject result = runUssdGuarded(c, ussd, mode, offer, slot, stepMs, keyMs, totalMs);
            String status = result.optString("status", "error");
            if ("no_reply".equals(status)) stallStreak++; else stallStreak = 0;
            String message = result.optString("message", "");
            boolean resultOk = "complete".equals(status);

            rs = new JSONArray();
            JSONArray src = result.optJSONArray("responses");
            for (int i = 0; src != null && i < src.length(); i++) rs.put(src.opt(i));
            if (!message.isEmpty() && !resultOk) rs.put(resp("-", message));

            // 1) the final USSD screen
            String lastText = "";
            if (rs.length() > 0) {
                JSONObject last = rs.optJSONObject(rs.length() - 1);
                if (last != null) lastText = last.optString("text", "");
            }
            // A "connection problem" after the last step may still have bought the plan: wait for the SMS.
            // A success SMS that already arrived wins over any screen.
            boolean connAfterSend = resultOk && CONN_SCREEN.matcher(lastText).find();
            if (connAfterSend || "no_reply".equals(status)) {
                synchronized (w) {
                    w.strict = true;
                    if (w.got != null && !w.numbered) { w.got = null; w.text = ""; }
                }
            }
            EngineRules.Conf conf;
            String smsText = "";
            if (w.got != null && "success".equals(w.got.status)) {
                conf = w.got;
                smsText = w.text;
            } else {
                conf = connAfterSend ? null : EngineRules.classifyScreen(lastText);
            }
            if (conf == null && SUCCESS_SCREEN.matcher(lastText).find() && !FAIL_SCREEN.matcher(lastText).find()) {
                conf = new EngineRules.Conf("success", null, null);
            }
            // 2) otherwise Safaricom's SMS decides
            if (conf == null && (resultOk || "no_reply".equals(status))) {
                conf = awaitConfirm(w, confirmMs);
                if (conf != null) smsText = w.text;
            } else {
                disarm(w);
            }

            ok = false;
            alreadyRec = conf != null && "Already recommended".equals(conf.reason);
            if (conf != null) {
                ok = "success".equals(conf.status);
                if (!smsText.isEmpty()) rs.put(resp("SMS", smsText));
                kind = ok ? "ok" : conf.reason != null ? "stop" : "failed";
            } else if ("sig_mismatch".equals(status) || "wrong_path".equals(status) || message.toLowerCase().contains("accessibility")) {
                kind = "stop";
            } else if ("no_reply".equals(status) || resultOk) {
                kind = "pending";
                rs.put(resp("-", "No final reply or success message came back. Check the customer before retrying."));
            } else {
                kind = "failed";
            }

            update(c, id, obj("attempts", attempt, "responses", rs));
            boolean again = ("failed".equals(kind) && retryFailed) || ("pending".equals(kind) && retryPending);
            if ("ok".equals(kind) || !again || attempt > maxRetries) break;
            // One payment may not hold the queue for ever: no retry starts if it could not finish inside the time budget
            long spent = System.currentTimeMillis() - t0;
            if (spent > TX_BUDGET_MS) {
                rs.put(resp("-", "Stopped retrying: this payment used its time limit so the next customers are not kept waiting."));
                update(c, id, obj("responses", rs));
                diag(c, "retry budget used up for " + phone + " after " + attempt + " attempt(s)");
                break;
            }
            if ("pending".equals(kind)) {
                JSONArray more = new JSONArray();
                for (int i = 0; i < rs.length(); i++) more.put(rs.opt(i));
                more.put(resp("-", "Retry pending is on, so the app is trying again. The first attempt may already have sold."));
                update(c, id, obj("responses", more));
            }
            Thread.sleep(retryMs);
        }

        charge(c); // the engine dialed: one token, whatever the outcome
        // Fallback: only after a DEFINITE failure (all retries used) or "already recommended".
        // A timeout or no reply may have sold, so it never triggers a backup.
        if (!ok) {
            String trigger = alreadyRec ? "recommended" : "failed".equals(kind) ? "failed" : "";
            if (!trigger.isEmpty()) {
                JSONObject fb = startFallback(c, startTx, offer, trigger);
                if (fb != null) {
                    String t = fb.optBoolean("fallbackPending", false)
                        ? "Fallback queued: " + fb.optString("offerName") + " in " + fb.optLong("delayMin") + " min, unless a success SMS arrives first."
                        : "Fallback started: " + fb.optString("offerName") + ".";
                    rs.put(resp("-", t));
                    update(c, id, obj("status", "Failed", "completedAt", System.currentTimeMillis(),
                        "hasFallback", true, "responses", rs));
                    Notifier.alert(c, "idle", "", "");
                    return;
                }
            }
        }
        long end = System.currentTimeMillis();

        // A definite failure (nothing bought) with "try again tomorrow" switched on
        boolean already = startTx.optBoolean("autoRescheduled", false);
        if (!ok && "failed".equals(kind) && !alreadyRec && offer.optBoolean("autoReschedule", false) && !already) {
            update(c, id, obj("status", "Scheduled",
                "scheduledFor", nextDayAt(offer.optString("rescheduleTime", "06:00"), end),
                "autoRescheduled", true, "completedAt", JSONObject.NULL));
            Notifier.alert(c, "idle", "", "");
            return;
        }

        // Step 4 will start the backup offer here. For now the reason is recorded so nothing is lost.
        JSONObject patch = obj("status", ok ? "Completed" : "Failed", "completedAt", end);
        if (!ok) {
            String trigger = alreadyRec ? "recommended" : "failed".equals(kind) ? "failed" : "";
            if (!trigger.isEmpty()) patch.put("fallbackTrigger", trigger);
        }
        update(c, id, patch);
        if (ok) {
            Notifier.alert(c, "idle", "", "");
        } else {
            String text = "The transaction failed";
            if (rs.length() > 0) {
                JSONObject last = rs.optJSONObject(rs.length() - 1);
                if (last != null && !last.optString("text", "").isEmpty()) text = last.optString("text");
            }
            Notifier.alert(c, "failed", "Failed: " + label, text);
        }
    }

    // Creates the backup transaction for a failed one. Returns null when there is no usable mapping.
    private static JSONObject startFallback(Context c, JSONObject tx, JSONObject offer, String trigger) {
        JSONObject snap = EngineStore.snapshot(c);
        JSONObject cfg = snap.optJSONObject("fallback");
        if (cfg == null || !cfg.optBoolean("active", true)) return null;
        JSONArray maps = cfg.optJSONArray("mappings");
        JSONObject m = null;
        for (int i = 0; maps != null && i < maps.length(); i++) {
            JSONObject x = maps.optJSONObject(i);
            if (x != null && sameId(x.opt("primaryId"), offer.opt("id")) && trigger.equals(x.optString("trigger"))) { m = x; break; }
        }
        if (m == null) return null;

        JSONArray chain = tx.optJSONArray("fallbackChain");
        JSONArray newChain = new JSONArray();
        if (chain == null) newChain.put(offer.opt("id"));
        else for (int i = 0; i < chain.length(); i++) newChain.put(chain.opt(i));
        for (int i = 0; i < newChain.length(); i++) {
            if (sameId(newChain.opt(i), m.opt("fallbackId"))) return null; // never loop A -> B -> A
        }
        JSONObject target = findOffer(snap.optJSONArray("offers"), m.opt("fallbackId"));
        if (target == null || !target.optBoolean("enabled", true)) return null;
        newChain.put(target.opt("id"));

        int depth = tx.optInt("fallbackDepth", 0) + 1;
        // "Already recommended" is final, so there is nothing to wait for
        long delayMin = "recommended".equals(trigger) ? 0 : Math.max(0, cfg.optLong("delay", 0));
        boolean wait = delayMin > 0;
        long now = System.currentTimeMillis();
        String phone = tx.optString("phone");
        String note = "Fallback for " + offer.optString("name", "") + ": "
            + ("recommended".equals(trigger) ? "Already recommended" : "Purchase failed");
        String code = tx.optString("mpesaId", "");

        JSONObject fb = obj(
            "id", (code.isEmpty() ? "FB" : code) + "-FB" + depth + "-" + now,
            "mpesaId", code, "name", tx.optString("name"), "phone", phone,
            "account", tx.optString("account"), "messageType", tx.optString("messageType"),
            "blacklisted", false, "amount", tx.optDouble("amount", 0), "rawMessage", tx.optString("rawMessage"),
            "status", wait ? "Scheduled" : running(c) ? "Pending" : "Paused",
            "scheduledFor", wait ? (Object) (now + delayMin * 60000) : JSONObject.NULL,
            "offerId", target.opt("id"), "fallbackOf", JSONObject.NULL, "fixedOffer", true,
            "offerName", target.optString("name", ""),
            "ussd", EngineRules.fillPhone(target.optString("ussd", ""), phone),
            "cost", target.optDouble("safPrice", 0),
            "attempts", 0, "responses", new JSONArray().put(resp("-", note)), "createdAt", now,
            "isFallback", true, "fallbackDepth", depth, "fallbackChain", newChain,
            "fallbackNote", note, "fallbackTrigger", trigger, "fallbackFromId", tx.optString("id"),
            "fallbackFromName", offer.optString("name", ""), "fallbackNotify", m.optBoolean("notify", false),
            "fallbackPending", wait, "delayMin", delayMin, "engine", "native");
        add(c, fb);
        return fb;
    }

    // Scheduled transactions whose time has come become Pending (or Paused if automation is off)
    static void tick(Context ctx) {
        final Context c = ctx.getApplicationContext();
        if (!owns(c)) return;
        long now = System.currentTimeMillis();
        java.util.ArrayList<String> due = new java.util.ArrayList<>();
        synchronized (LOCK) {
            JSONArray a = load(c);
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o == null || !"Scheduled".equals(o.optString("status"))) continue;
                long at = o.optLong("scheduledFor", 0);
                if (at > 0 && at <= now) due.add(o.optString("id"));
            }
        }
        for (String id : due) {
            update(c, id, obj("status", running(c) ? "Pending" : "Paused",
                "scheduledFor", JSONObject.NULL, "fallbackPending", false));
        }
        pump(c);
    }

    // The native transactions, for the service's own portal sync (a copy)
    static JSONArray recent(Context c) {
        synchronized (LOCK) { return copyOf(load(c)); }
    }

    // Tokens left after native charges the app has not applied yet
    static long unitsLeft(Context c) { return effectiveUnits(c); }

    // The app is taking this transaction over (a retry or a release): the background engine lets go of it
    static void release(Context c, String id) {
        synchronized (LOCK) {
            JSONArray a = load(c);
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o == null || !id.equals(o.optString("id"))) continue;
                String s = o.optString("status");
                if ("Scheduled".equals(s) || "Paused".equals(s) || "Pending".equals(s)) {
                    update(c, id, obj("status", "Skipped", "scheduledFor", JSONObject.NULL, "fallbackPending", false,
                        "responses", new JSONArray().put(resp("-", "Handed over to the app."))));
                }
                return;
            }
        }
    }

    // The app has saved these transactions (id and the revision it saved). Only the revision is marked,
    // so a later change on this side makes the row count as unsaved again.
    static void ack(Context c, JSONArray items) {
        synchronized (LOCK) {
            JSONArray a = load(c);
            java.util.HashMap<String, Long> got = new java.util.HashMap<>();
            for (int i = 0; i < items.length(); i++) {
                JSONObject it = items.optJSONObject(i);
                if (it != null) got.put(it.optString("id"), it.optLong("rev", 0));
            }
            boolean changed = false;
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o == null) continue;
                Long r = got.get(o.optString("id"));
                if (r == null) continue;
                if (r >= o.optLong("rev", 1) && o.optLong("appRev", -1) < r) {
                    try { o.put("appRev", r); changed = true; } catch (Exception ignored) { }
                }
            }
            if (changed) save(c, a);
        }
    }

    private static void failNow(Context c, String id, String label, String text) {
        update(c, id, obj("status", "Failed", "completedAt", System.currentTimeMillis(),
            "responses", new JSONArray().put(resp("-", text))));
        Notifier.alert(c, "failed", "Failed: " + label, text);
    }
}