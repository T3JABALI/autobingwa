package com.autobingwa.app;

import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.telecom.PhoneAccountHandle;
import android.telecom.TelecomManager;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.telephony.TelephonyManager;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

public class UssdFlow {
    private static final String TAG = "AutoBingwa";
    private static final Object LOCK = new Object();

    // Express: the whole code goes out in one request and the answer comes back without any dialog.
    public static volatile boolean express = true;

    // Dialog route only: how many of the first steps go out WITH the first dial, in one request,
    // so only the remaining steps are typed into the dialog. 0 = off (every step is typed).
    // Always keeps at least the last step for the dialog, so the final screen is still read.
    // Never used with a signature (a signature has to check every menu).
    public static volatile int chain = 0;
    // ---------- USSD Settings page (set by apply) ----------
    public static volatile long executionDelayMs = 0;
    public static volatile long initialDialDelayMs = 0;
    public static volatile long failureCheckDelayMs = 50;
    public static volatile long cleanupDelayMs = 100;

    public static void apply(JSONObject u) {
        if (u == null) return;
        executionDelayMs = Math.max(0, u.optLong("executionDelayMs", 0));
        initialDialDelayMs = Math.max(0, u.optLong("initialDialDelayMs", 0));
        failureCheckDelayMs = Math.max(0, u.optLong("failureCheckDelayMs", 50));
        cleanupDelayMs = Math.max(0, u.optLong("cleanupDelayMs", 100));
        chain = u.optBoolean("fasten", false) ? 2 : 0; // only used for *180 offers, see run()
        UssdAccessibilityService.configure(u);
        Log.d(TAG, "USSD settings applied: chain=" + chain + " execDelay=" + executionDelayMs
            + " dialDelay=" + initialDialDelayMs);
    }

    private static void nap(long ms) {
        if (ms <= 0) return;
        try { Thread.sleep(ms); } catch (InterruptedException e) { /* continue */ }
    }
    // True while a USSD run is in progress. The app never comes forward or goes back during this time.
    public static volatile boolean busy = false;

    // ---------- weak network settings ----------
    // How many times a run may be dialed AGAIN when the network dropped it before the last step was sent.
    // Dialing again is only ever done while nothing has been bought.
    public static volatile int redials = 5;
    // Express: how many extra tries when the network refuses the request
    public static volatile int expressRetries = 2;
    // If Express keeps being refused, finish the purchase through the dialer window instead
    public static volatile boolean dialogAfterExpress = true;
    // A run may take at least this long in total, so a weak network has time to recover
    public static volatile long minBudgetMs = 120000;

    // The network refused or dropped the request (checked on any screen BEFORE the last step is sent)
    private static final Pattern TRANSIENT = Pattern.compile(
        "connection problem|invalid mmi|network (error|busy|unavailable)|unable to connect"
        + "|service (is )?(temporarily )?unavailable|temporarily unavailable|try again later"
        + "|ussd (busy|session)|timed? ?out|no service", Pattern.CASE_INSENSITIVE);

    // Express replies: only the phone's own "network refused it" messages count, nothing else
    private static final Pattern NET_DROP = Pattern.compile("connection problem|invalid mmi", Pattern.CASE_INSENSITIVE);

    private static final class Step {
        String status = "error";
        String message = "";
        boolean safeRedial = false; // the last step was NOT sent, so nothing was bought and dialing again is safe
        boolean slowNet = false;    // the network is weak: wait longer before dialing again
        String retryNote = "";
    }

    private static PhoneAccountHandle handleForSlot(Context ctx, int slot) {
        try {
            SubscriptionManager sm = ctx.getSystemService(SubscriptionManager.class);
            SubscriptionInfo info = sm.getActiveSubscriptionInfoForSimSlotIndex(slot);
            if (info == null) return null;
            TelecomManager tc = ctx.getSystemService(TelecomManager.class);
            TelephonyManager tm = ctx.getSystemService(TelephonyManager.class);
            for (PhoneAccountHandle h : tc.getCallCapablePhoneAccounts()) {
                if (Build.VERSION.SDK_INT >= 30 && tm.getSubscriptionId(h) == info.getSubscriptionId()) return h;
                String id = h.getId() == null ? "" : h.getId();
                if (id.equals(String.valueOf(info.getSubscriptionId()))) return h;
                if (info.getIccId() != null && id.startsWith(info.getIccId())) return h;
            }
        } catch (SecurityException e) {
            // falls back to the default SIM
        }
        return null;
    }

    private static void dial(Context ctx, int slot, String code) {
        TelecomManager tc = ctx.getSystemService(TelecomManager.class);
        Bundle extras = new Bundle();
        PhoneAccountHandle h = handleForSlot(ctx, slot);
        if (h != null) extras.putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, h);
        tc.placeCall(Uri.parse("tel:" + Uri.encode(code)), extras);
    }

    private static void add(JSArray list, String input, String text) {
        JSObject o = new JSObject();
        o.put("input", input);
        o.put("text", text);
        list.put(o);
    }

    // *180#  +  5,2,0712345678,1,1   ->   *180*5*2*0712345678*1*1#
    public static String expressCode(String first, String[] steps) {
        String base = first.trim();
        if (base.endsWith("#")) base = base.substring(0, base.length() - 1);
        StringBuilder sb = new StringBuilder(base);
        for (String s : steps) sb.append('*').append(s.trim());
        return sb.append('#').toString();
    }

    // Returns null when NOTHING was sent (not supported / no permission), so the dialog route can take over.
    // Once the request has gone out and an answer (or a hang) came back, the result is final here.
    private static JSObject runExpress(Context ctx, int slot, String first, String[] steps, long totalMs) {
        final String ussd = expressCode(first, steps);
        TelephonyManager tm;
        try {
            tm = ctx.getSystemService(TelephonyManager.class);
            SubscriptionManager sm = ctx.getSystemService(SubscriptionManager.class);
            SubscriptionInfo info = sm.getActiveSubscriptionInfoForSimSlotIndex(slot);
            if (info != null) tm = tm.createForSubscriptionId(info.getSubscriptionId());
        } catch (Exception e) {
            Log.d(TAG, "express: could not pick the SIM: " + e);
            return null;
        }

        final CountDownLatch latch = new CountDownLatch(1);
        final String[] reply = { null };
        final int[] failure = { 0 };
                nap(initialDialDelayMs);
        final long sentAt = System.currentTimeMillis();
        try {
            tm.sendUssdRequest(ussd, new TelephonyManager.UssdResponseCallback() {
                @Override
                public void onReceiveUssdResponse(TelephonyManager t, String request, CharSequence response) {
                    reply[0] = String.valueOf(response);
                    latch.countDown();
                }

                @Override
                public void onReceiveUssdResponseFailed(TelephonyManager t, String request, int failureCode) {
                    failure[0] = failureCode;
                    latch.countDown();
                }
            }, new Handler(Looper.getMainLooper()));
        } catch (SecurityException e) {
            Log.d(TAG, "express: no permission, using the dialog route: " + e);
            return null;
        } catch (Exception e) {
            Log.d(TAG, "express: not available, using the dialog route: " + e);
            return null;
        }
        Log.d(TAG, "express sent: " + ussd);

        JSArray responses = new JSArray();
        String status;
        String message = "";
        try {
            boolean got = latch.await(Math.max(totalMs, 20000), TimeUnit.MILLISECONDS);
            if (!got) {
                status = "no_reply";
                message = "Express request was sent but no answer came back. Check the confirmation SMS before retrying.";
            } else if (reply[0] != null) {
                status = "complete";
                add(responses, ussd, reply[0]);
            } else {
                status = "error";
                message = "Express request failed (code " + failure[0] + "). Check the confirmation SMS before retrying.";
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            status = "no_reply";
            message = "Express request was interrupted after sending. Check the confirmation SMS.";
        }
        Log.d(TAG, "express done: " + status + " in " + (System.currentTimeMillis() - sentAt) + "ms " + message);
        JSObject out = new JSObject();
        out.put("status", status);
        out.put("message", message);
        out.put("responses", responses);
        out.put("code", failure[0]);
        return out;
    }

    // True when the network or phone refused the Express request outright (not a real answer, not a hang)
    private static boolean isExpressRefusal(JSObject r) {
        String st = r.optString("status", "");
        if ("error".equals(st)) {
            int c = r.optInt("code", 0);
            return c == -1 || c == -2;
        }
        if ("complete".equals(st)) {
            JSONArray a = r.optJSONArray("responses");
            if (a == null || a.length() == 0) return false;
            JSONObject last = a.optJSONObject(a.length() - 1);
            return last != null && NET_DROP.matcher(last.optString("text", "")).find();
        }
        return false; // no_reply may have sold: never sent again
    }

    // Express with patience: a refused request is sent again after a short, growing pause
    private static JSObject runExpressResilient(Context ctx, int slot, String first, String[] steps,
                                                long totalMs, long budgetMs, long started) {
        JSObject last = null;
        long pause = 1500;
        for (int a = 0; a <= expressRetries; a++) {
            if (a > 0) {
                if (budgetMs - (System.currentTimeMillis() - started) < 10000) break;
                Log.d(TAG, "express refused, sending again (" + (a + 1) + ")");
                try {
                    Thread.sleep(pause);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
                pause = Math.min(pause * 2, 8000);
            }
            JSObject r = runExpress(ctx, slot, first, steps, totalMs);
            if (r == null) return last;
            last = r;
            if (!isExpressRefusal(r)) return r;
        }
        return last;
    }

    private static UssdAccessibilityService.Dialog poll(long ms) throws InterruptedException {
        return UssdAccessibilityService.events.poll(ms, TimeUnit.MILLISECONDS);
    }

    // After sending a MIDDLE step, wait for the next screen. If it comes, it is returned straight away.
    // If nothing comes for 4 seconds and the SAME menu is still showing, the send did not go through,
    // so send again (at most twice).
    private static UssdAccessibilityService.Dialog resendIfStuck(String menuText, String value) throws InterruptedException {
        UssdAccessibilityService s = UssdAccessibilityService.instance;
        for (int r = 0; r < 2 && s != null; r++) {
            UssdAccessibilityService.Dialog d = poll(4000);
            if (d != null) return d;
            // the phone is still working on it ("USSD code running"): that is not a stuck menu
            if (UssdAccessibilityService.sawProgress()) return null;
            if (!menuText.equals(s.currentText())) return null;
            Log.d(TAG, "Same menu still on screen, sending '" + value + "' again (" + (r + 1) + ")");
            s.typeAndSend(value);
        }
        return null;
    }

    // The last step confirms the purchase. It is only sent again when it clearly did not register.
    private static UssdAccessibilityService.Dialog resendLastIfNotAccepted(String menuText, String value) throws InterruptedException {
        UssdAccessibilityService s = UssdAccessibilityService.instance;
        if (s == null) return null;
        long end = System.currentTimeMillis() + 5000;
        while (System.currentTimeMillis() < end) {
            UssdAccessibilityService.Dialog d = poll(100);
            if (d != null) return d;
            if (UssdAccessibilityService.sawProgress()) return null;
        }
        if (!menuText.equals(s.currentText())) return null;
        Log.d(TAG, "Last step '" + value + "' did not register, sending it once more");
        s.typeAndSend(value);
        return null;
    }

    // One pass through the dialog route. With a signature, each menu option is found by its text.
    private static Step interactiveOnce(Context ctx, int slot, String first, String[] steps, long stepMs,
                                        long keyDelayMs, long budgetMs, long started, JSArray responses,
                                        JSONArray sig)
            throws InterruptedException {
        Step r = new Step();
        if (UssdAccessibilityService.instance == null) {
            r.message = "Turn on the AutoBingwa accessibility service first";
            return r;
        }
        if (sig != null && sig.length() != steps.length) {
            r.status = "sig_mismatch";
            r.message = "The saved signature does not match this USSD code. Learn the signature again.";
            return r;
        }
        // On a dual-SIM phone, never fall back to the default SIM: that could spend the wrong SIM's airtime
        if (handleForSlot(ctx, slot) == null) {
            try {
                SubscriptionManager sm0 = ctx.getSystemService(SubscriptionManager.class);
                if (sm0 != null && sm0.getActiveSubscriptionInfoCount() > 1) {
                    r.status = "error";
                    r.message = "Could not select SIM " + (slot + 1) + " for the dialer, so nothing was dialed. Use Express mode or check the SIM setting.";
                    return r;
                }
            } catch (SecurityException e) {
                // carry on with the default SIM
            }
        }
                nap(initialDialDelayMs);
        dial(ctx, slot, first);
        String sent = first;
        r.status = "complete";
        UssdAccessibilityService.Dialog carry = null; // a screen already received while checking the last send
        long sentAt = System.currentTimeMillis();
        for (int i = 0; i <= steps.length; i++) {
            boolean afterLast = (i == steps.length && steps.length > 0);
            // While the last step has not been sent, nothing can have been bought, so dialing again is safe
            boolean beforeLast = steps.length > 0 && !afterLast;
            long left = budgetMs - (System.currentTimeMillis() - started);
            long base = afterLast ? Math.max(stepMs, 15000) : stepMs;
            long wait = Math.min(base, Math.max(left, 1000));
            UssdAccessibilityService.Dialog d = carry != null ? carry : poll(wait);
            carry = null;

            // Weak network: the phone still shows "USSD code running", so the request is alive. Keep waiting.
            if (d == null && UssdAccessibilityService.sawProgress()) {
                long hard = started + budgetMs;
                long patience = System.currentTimeMillis() + base * 2;
                while (d == null && UssdAccessibilityService.sawProgress()
                        && System.currentTimeMillis() < Math.min(patience, hard)) {
                    d = poll(300);
                }
            }

            if (d == null) {
                r.status = afterLast ? "no_reply" : "timeout";
                if (afterLast && UssdAccessibilityService.sawProgress()) {
                    r.message = "The last step '" + sent + "' was sent. The phone showed 'USSD code running' but no final message. Check the confirmation SMS.";
                } else if (afterLast) {
                    r.message = "No reply from the network after sending '" + sent + "'. Check the confirmation SMS.";
                } else {
                    r.message = "No reply from the network after sending '" + sent + "'";
                    r.safeRedial = beforeLast;
                    r.slowNet = true;
                    r.retryNote = "No reply from the network (weak signal). Nothing was bought. Dialing again";
                }
                return r;
            }
            Log.d(TAG, "TIMING screen " + i + " came back " + (System.currentTimeMillis() - sentAt) + "ms after sending '" + sent + "'");
            add(responses, sent, d.text);
            if (!d.hasInput) {
                if (beforeLast && TRANSIENT.matcher(d.text).find()) {
                    // The network refused or dropped the session before the last step. Nothing was bought.
                    r.status = "ended_early";
                    r.safeRedial = true;
                    r.slowNet = true;
                    r.retryNote = "The network dropped the session ('" + d.text.replace('\n', ' ').trim() + "'). Waiting, then dialing again";
                    return r;
                }
                if (i < steps.length) r.status = "ended_early";
                return r;
            }
            if (i == steps.length) {
                r.message = "Menu still open after the last step";
                return r;
            }

            // What to type: the saved number, or the number the saved option has NOW
            String value = steps[i];
            if (sig != null) {
                JSONObject st = sig.optJSONObject(i);
                if (st != null && "menu".equals(st.optString("kind"))) {
                    String pick = SigMatch.pick(st.optString("label"), d.text);
                    if (pick == null) {
                        r.status = "sig_mismatch";
                        r.message = "Step " + (i + 1) + ": could not find '" + st.optString("label")
                            + "' in the menu. Nothing was bought. Learn the signature again.";
                        return r; // nothing was sent for this step
                    }
                    if (!pick.equals(st.optString("hint"))) {
                        Log.d(TAG, "menu moved at step " + (i + 1) + ": now option " + pick);
                    }
                    value = pick;
                }
            }

            // The dialog is already on screen and readable, so type at once (no extra pause)
            long typeStart = System.currentTimeMillis();
            boolean ok = false;
            for (int t = 0; t < 160 && !ok; t++) {   // up to 4 seconds for the dialog to be ready
                ok = UssdAccessibilityService.instance.typeAndSend(value);
                if (!ok) {
                    if ("no USSD window found".equals(UssdAccessibilityService.lastFail) && t >= 40) break; // 1s: the window is gone
                    Thread.sleep(25);
                }
            }
            if (!ok) {
                String why = UssdAccessibilityService.lastFail;
                r.status = "error";
                r.safeRedial = true; // this step was never sent, so dialing again is safe
                r.retryNote = "The USSD window changed before step " + (i + 1) + " could be typed (" + why + "). Dialing again";
                r.message = "Could not type '" + value + "' into the USSD window at step " + (i + 1)
                    + " (" + why + ")";
                return r;
            }
            sent = value;
            sentAt = System.currentTimeMillis();
            Log.d(TAG, "TIMING step " + i + " typed and sent in " + (sentAt - typeStart) + "ms");
                        nap(failureCheckDelayMs);
            carry = (i < steps.length - 1) ? resendIfStuck(d.text, value) : resendLastIfNotAccepted(d.text, value);
        }
        return r;
    }

    // status: complete | ended_early | timeout (nothing was bought, safe to retry)
    //         | no_reply (last step sent, result unknown) | error | sig_mismatch
    public static JSObject run(Context ctx, int slot, String first, String[] steps,
                               long stepMs, long keyDelayMs, long totalMs) {
        return run(ctx, slot, first, steps, stepMs, keyDelayMs, totalMs, express);
    }

    public static JSObject run(Context ctx, int slot, String first, String[] steps,
                               long stepMs, long keyDelayMs, long totalMs, boolean useExpress) {
        return run(ctx, slot, first, steps, stepMs, keyDelayMs, totalMs, useExpress, null);
    }

    @SuppressWarnings("deprecation")
    public static JSObject run(Context ctx, int slot, String first, String[] steps,
                               long stepMs, long keyDelayMs, long totalMs, boolean useExpress, JSONArray sig) {
        synchronized (LOCK) {
            JSArray responses = new JSArray();
            String status = "error";
            String message = "";
            long started = System.currentTimeMillis();
            // A weak network gets more time than the normal limit
            final long budget = Math.max(totalMs, minBudgetMs);
            PowerManager pm = ctx.getSystemService(PowerManager.class);
            PowerManager.WakeLock cpu = null;
            PowerManager.WakeLock screen = null;
            boolean usedDialog = false;
            busy = true;
            try {
                cpu = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AutoBingwa:ussd");
                cpu.acquire(budget + 15000);
                nap(executionDelayMs);
                // A signature has to be checked against each menu, so it always uses the dialog route.
                if (useExpress && sig == null && Build.VERSION.SDK_INT >= 26) {
                    JSObject fast = runExpressResilient(ctx, slot, first, steps, totalMs, budget, started);
                    if (fast != null) {
                        boolean canDialog = dialogAfterExpress && UssdAccessibilityService.instance != null;
                        if (!isExpressRefusal(fast) || !canDialog) return fast;
                        add(responses, "-", "The network kept refusing the Express request. Nothing was bought. Using the dialer window.");
                    }
                }

                // Dialog route. The screen has to be on for the dialog to be readable.
                usedDialog = true;
                if (!pm.isInteractive()) {
                    screen = pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, "AutoBingwa:screen");
                    screen.acquire(budget + 15000);
                }

                // Optional chaining: the first steps ride along with the first dial, the rest are typed.
                String dialFirst = first;
                String[] dialSteps = steps;
                int k = (sig == null && first.trim().startsWith("*180")) ? Math.max(0, Math.min(chain, steps.length - 1)) : 0;
                if (k > 0) {
                    dialFirst = expressCode(first, Arrays.copyOfRange(steps, 0, k));
                    dialSteps = Arrays.copyOfRange(steps, k, steps.length);
                    Log.d(TAG, "chain " + k + " step(s) into the first dial: " + dialFirst);
                }

                UssdAccessibilityService.begin();
                String note = "";
                long pause = 1000;
                int tries = 0;
                boolean gaveUp = false;
                for (int attempt = 0; attempt <= redials; attempt++) {
                    if (attempt > 0) {
                        UssdAccessibilityService s0 = UssdAccessibilityService.instance;
                        if (s0 != null) s0.dismiss();
                        Thread.sleep(pause);
                        add(responses, "-", note + " (attempt " + (attempt + 1) + " of " + (redials + 1) + ")");
                        UssdAccessibilityService.begin();
                    }
                    tries++;
                    Step r = interactiveOnce(ctx, slot, dialFirst, dialSteps, stepMs, keyDelayMs, budget, started, responses, sig);
                    status = r.status;
                    message = r.message;
                    note = r.retryNote;
                    gaveUp = false;
                    long left = budget - (System.currentTimeMillis() - started);
                    if (!r.safeRedial) break;      // finished, or the last step was already sent: never dial again
                    gaveUp = true;                 // safe to dial again, unless the tries or the time run out
                    if (left < 15000) break;
                    // weak network: wait 2s, then 4s, then 8s. Other failures: 1s.
                    pause = r.slowNet ? Math.min(8000L, 2000L << Math.min(attempt, 2)) : 1000;
                }
                if (gaveUp && !"complete".equals(status)) {
                    message = (message.isEmpty() ? "The network dropped the request" : message)
                        + ". Tried " + tries + " times. Nothing was bought.";
                }
                Log.d(TAG, "TIMING whole run " + (System.currentTimeMillis() - started) + "ms, status " + status + ", tries " + tries);
            } catch (Exception e) {
                status = "error";
                message = String.valueOf(e.getMessage());
            } finally {
                if (usedDialog) {
                                        nap(cleanupDelayMs);
                    UssdAccessibilityService.end();
                    UssdAccessibilityService s = UssdAccessibilityService.instance;
                    if (s != null) s.dismiss();
                }
                if (screen != null && screen.isHeld()) screen.release();
                if (cpu != null && cpu.isHeld()) cpu.release();
                busy = false;
            }
            JSObject out = new JSObject();
            out.put("status", status);
            out.put("message", message);
            out.put("responses", responses);
            return out;
        }
    }
}