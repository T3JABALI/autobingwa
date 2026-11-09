package com.autobingwa.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import java.util.Calendar;
import java.util.Iterator;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

// The native engine: SMS in, USSD out, with no web view. Port of engine.js process() and ingest().
// Step 2: nothing calls this yet. Fallbacks, renewals, customer SMS and contacts come in Step 4.
final class EngineCore {
    private static final String TAG = "AutoBingwa";
    private static final String FILE = "autobingwa_native";
    private static final Object LOCK = new Object();
    private static final Object WAIT = new Object();
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor();
    private static final AtomicBoolean pumping = new AtomicBoolean(false);
    private static volatile boolean recovered = false;
    private static Waiter waiter = null;

    private static final Pattern SUCCESS_SCREEN = Pattern.compile(
        "successfully\\s+(purchased|bought|subscribed|activated|recommended)", Pattern.CASE_INSENSITIVE);
    private static final Pattern FAIL_SCREEN = Pattern.compile(
        "not\\s+successful|unsuccessful|not\\s+been\\s+successful|failed", Pattern.CASE_INSENSITIVE);
    private static final Pattern EXPRESS_REFUSED = Pattern.compile("code -[12]\\)");

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
    private static JSONArray load(Context c) {
        try {
            return new JSONArray(sp(c).getString("tx", "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private static void save(Context c, JSONArray a) {
        sp(c).edit().putString("tx", a.toString()).commit();
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

    private static void add(Context c, JSONObject tx) {
        synchronized (LOCK) {
            JSONArray a = load(c);
            try { tx.put("rev", 1); } catch (Exception ignored) { }
            a.put(tx);
            // keep the newest 300: only finished transactions are ever dropped
            if (a.length() > 300) {
                JSONArray t = new JSONArray();
                int drop = a.length() - 300;
                for (int i = 0; i < a.length(); i++) {
                    JSONObject o = a.optJSONObject(i);
                    if (drop > 0 && o != null && terminal(o.optString("status"))) { drop--; continue; }
                    t.put(a.opt(i));
                }
                a = t;
            }
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

    // What the app reads: the switches, the token charge counter and every native transaction
    static JSONObject state(Context c) {
        synchronized (LOCK) {
            return obj("owner", owns(c), "running", running(c),
                "chargesTotal", sp(c).getLong("chargesTotal", 0), "transactions", load(c));
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
                sp(c).edit().putString("handled", h.toString()).commit();
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
        long applied = w == null ? 0 : w.optLong("chargesApplied", 0);
        long total = sp(c).getLong("chargesTotal", 0);
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
        final CountDownLatch latch = new CountDownLatch(1);
        volatile EngineRules.Conf got = null;
        volatile String text = "";
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
            if (cf.phone != null && !w.phone.isEmpty()) {
                EngineRules.Phone n = EngineRules.normalizePhone(cf.phone);
                if (n != null && !n.phone.equals(w.phone)) mine = false; // a reply about another customer
            }
            if (mine) {
                w.got = cf;
                w.text = text;
                w.latch.countDown();
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
                    JSONArray r = o.optJSONArray("responses");
                    if (r != null) prev = r;
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
        return true;
    }

    private static EngineRules.Conf awaitConfirm(Waiter w, long ms) {
        try {
            w.latch.await(ms, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
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
                try {
                    if (!recovered) { recover(c); recovered = true; }
                    for (;;) {
                        if (!owns(c) || !running(c) || !hasToken(c)) break;
                        JSONObject next = oldestPending(c);
                        if (next == null) break;
                        try {
                            process(c, next);
                        } catch (Exception e) {
                            Log.e(TAG, "native process", e);
                            update(c, next.optString("id"), obj("status", "Failed", "completedAt", System.currentTimeMillis(),
                                "responses", new JSONArray().put(resp("-",
                                    "The native engine hit an error. Check your balance, then retry. " + e))));
                            Notifier.alert(c, "idle", "", "");
                        }
                        long gap = EngineStore.snapshot(c).optJSONObject("config") == null ? 400
                            : EngineStore.snapshot(c).optJSONObject("config").optLong("gapMs", 400);
                        Thread.sleep(Math.max(0, gap));
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } finally {
                    pumping.set(false);
                }
                // something may have arrived just as the loop ended
                if (owns(c) && running(c) && hasToken(c) && oldestPending(c) != null) pump(c);
            }
        });
    }

    // If the phone was restarted mid-dial, a Processing transaction is marked Failed so it is checked before a retry
    private static void recover(Context c) {
        synchronized (LOCK) {
            JSONArray a = load(c);
            boolean changed = false;
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o != null && "Processing".equals(o.optString("status"))) {
                    try {
                        o.put("status", "Failed");
                        o.put("responses", new JSONArray().put(resp("-",
                            "The app closed while this was processing. Check your balance, then retry.")));
                        changed = true;
                    } catch (Exception ignored) { }
                }
            }
            if (changed) save(c, a);
        }
    }

    private static JSONObject oldestPending(Context c) {
        synchronized (LOCK) {
            JSONArray a = load(c);
            JSONObject best = null;
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o == null || !"Pending".equals(o.optString("status"))) continue;
                if (best == null || o.optLong("createdAt", 0) < best.optLong("createdAt", 0)) best = o;
            }
            return best;
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
        boolean sigOn = sigObj != null && sigObj.optBoolean("complete", false)
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

    // Runs ONE transaction to its final state (port of process() in engine.js, without fallbacks yet)
    private static void process(Context c, JSONObject startTx) throws Exception {
        final String id = startTx.optString("id");
        final String phone = startTx.optString("phone");
        final double amount = startTx.optDouble("amount", 0);
        final String label = "KES " + money(amount) + " \u00b7 " + phone;

        JSONObject snap = EngineStore.snapshot(c);
        JSONArray offers = snap.optJSONArray("offers");
        JSONObject cfg = snap.optJSONObject("config");
        if (cfg == null) cfg = new JSONObject();

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

        String mode = cfg.optString("mode", "Advanced");
        int slot = "SIM 1".equals(cfg.optString("bingwaSim", "SIM 2")) ? 0 : 1;
        long stepMs = positive(cfg.optLong("stepTimeoutSec", 20), 20) * 1000;
        long keyMs = positive(cfg.optLong("keyDelayMs", 80), 80);
        long totalMs = positive(cfg.optLong("totalTimeoutSec", 90), 90) * 1000;
        long retryMs = positive(cfg.optLong("retryAfterSec", 15), 15) * 1000;
        long confirmMs = positive(cfg.optLong("confirmWaitSec", 45), 45) * 1000;

        int maxRetries = offer.optBoolean("autoRetry", false) ? Math.max(0, offer.optInt("retryCount", 0)) : 0;
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
            JSONObject result = runUssd(c, ussd, mode, offer, slot, stepMs, keyMs, totalMs);
            String status = result.optString("status", "error");
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
            EngineRules.Conf conf = EngineRules.classifyScreen(lastText);
            String smsText = "";
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
            } else if ("sig_mismatch".equals(status) || message.toLowerCase().contains("accessibility")) {
                kind = "stop";
            } else if ("no_reply".equals(status) || resultOk) {
                kind = "pending";
                rs.put(resp("-", "no_reply".equals(status)
                    ? "The last step was sent but no reply came back. Check the customer before retrying."
                    : "No success message or SMS came back. Check the customer before retrying."));
            } else {
                kind = "failed";
            }

            update(c, id, obj("attempts", attempt, "responses", rs));
            boolean again = ("failed".equals(kind) && retryFailed) || ("pending".equals(kind) && retryPending);
            if ("ok".equals(kind) || !again || attempt > maxRetries) break;
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
    private static void failNow(Context c, String id, String label, String text) {
        update(c, id, obj("status", "Failed", "completedAt", System.currentTimeMillis(),
            "responses", new JSONArray().put(resp("-", text))));
        Notifier.alert(c, "failed", "Failed: " + label, text);
    }
}