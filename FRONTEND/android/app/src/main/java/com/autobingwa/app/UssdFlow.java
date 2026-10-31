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
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

public class UssdFlow {
    private static final String TAG = "AutoBingwa";
    private static final Object LOCK = new Object();

    // Express: the whole code goes out in one request and the answer comes back without any dialog.
    public static volatile boolean express = true;

    private static final class Step {
        String status = "error";
        String message = "";
        boolean windowLost = false;
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
    // Once the request has gone out, the result is final: it is never sent a second time.
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
        Log.d(TAG, "express done: " + status + " " + message);
        JSObject out = new JSObject();
        out.put("status", status);
        out.put("message", message);
        out.put("responses", responses);
        return out;
    }

    // After sending a MIDDLE step, give the next screen up to 4 seconds. If the SAME menu is still showing,
    // the send did not go through, so send again (at most twice).
    private static void resendIfStuck(String menuText, String value) throws InterruptedException {
        UssdAccessibilityService s = UssdAccessibilityService.instance;
        for (int r = 0; r < 2 && s != null; r++) {
            long end = System.currentTimeMillis() + 4000;
            while (System.currentTimeMillis() < end) {
                if (!UssdAccessibilityService.events.isEmpty()) return;
                Thread.sleep(80);
            }
            if (!menuText.equals(s.currentText())) return;
            Log.d(TAG, "Same menu still on screen, sending '" + value + "' again (" + (r + 1) + ")");
            s.typeAndSend(value);
        }
    }

    // The last step confirms the purchase. It is only sent again when it clearly did not register.
    private static void resendLastIfNotAccepted(String menuText, String value) throws InterruptedException {
        UssdAccessibilityService s = UssdAccessibilityService.instance;
        if (s == null) return;
        long end = System.currentTimeMillis() + 5000;
        while (System.currentTimeMillis() < end) {
            if (!UssdAccessibilityService.events.isEmpty() || UssdAccessibilityService.sawProgress()) return;
            Thread.sleep(80);
        }
        if (!menuText.equals(s.currentText())) return;
        Log.d(TAG, "Last step '" + value + "' did not register, sending it once more");
        s.typeAndSend(value);
    }

    // One pass through the dialog route. With a signature, each menu option is found by its text.
    private static Step interactiveOnce(Context ctx, int slot, String first, String[] steps, long stepMs,
                                        long keyDelayMs, long totalMs, long started, JSArray responses,
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
        dial(ctx, slot, first);
        String sent = first;
        r.status = "complete";
        for (int i = 0; i <= steps.length; i++) {
            boolean afterLast = (i == steps.length && steps.length > 0);
            long left = totalMs - (System.currentTimeMillis() - started);
            long base = afterLast ? Math.max(stepMs, 15000) : stepMs;
            long wait = Math.min(base, Math.max(left, 1000));
            UssdAccessibilityService.Dialog d = UssdAccessibilityService.events.poll(wait, TimeUnit.MILLISECONDS);
            if (d == null) {
                r.status = afterLast ? "no_reply" : "timeout";
                if (afterLast && UssdAccessibilityService.sawProgress()) {
                    r.message = "The last step '" + sent + "' was sent. The phone showed 'USSD code running' but no final message. Check the confirmation SMS.";
                } else {
                    r.message = "No reply from the network after sending '" + sent + "'";
                }
                return r;
            }
            add(responses, sent, d.text);
            if (!d.hasInput) {
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

            if (keyDelayMs > 0) Thread.sleep(keyDelayMs);
            boolean ok = false;
            for (int t = 0; t < 80 && !ok; t++) {   // up to 4 seconds for the dialog to be ready
                ok = UssdAccessibilityService.instance.typeAndSend(value);
                if (!ok) {
                    if ("no USSD window found".equals(UssdAccessibilityService.lastFail) && t >= 20) break; // 1s: the window is gone
                    Thread.sleep(50);
                }
            }
            if (!ok) {
                r.status = "error";
                r.windowLost = "no USSD window found".equals(UssdAccessibilityService.lastFail);
                r.message = "Could not type '" + value + "' into the USSD window at step " + (i + 1)
                    + " (" + UssdAccessibilityService.lastFail + ")";
                return r; // this step was never sent, so dialing again is safe
            }
            sent = value;
            if (i < steps.length - 1) resendIfStuck(d.text, value);
            else resendLastIfNotAccepted(d.text, value);
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
            PowerManager pm = ctx.getSystemService(PowerManager.class);
            PowerManager.WakeLock cpu = null;
            PowerManager.WakeLock screen = null;
            boolean usedDialog = false;
            try {
                cpu = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AutoBingwa:ussd");
                cpu.acquire(totalMs + 15000);

                // A signature has to be checked against each menu, so it always uses the dialog route.
                if (useExpress && sig == null && Build.VERSION.SDK_INT >= 26) {
                    JSObject fast = runExpress(ctx, slot, first, steps, totalMs);
                    if (fast != null) return fast;
                }

                // Dialog route. The screen has to be on for the dialog to be readable.
                usedDialog = true;
                if (!pm.isInteractive()) {
                    screen = pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, "AutoBingwa:screen");
                    screen.acquire(totalMs + 15000);
                }
                UssdAccessibilityService.begin();
                for (int attempt = 0; attempt < 3; attempt++) {
                    if (attempt > 0) {
                        UssdAccessibilityService s0 = UssdAccessibilityService.instance;
                        if (s0 != null) s0.dismiss();
                        Thread.sleep(1200);
                        add(responses, "-", "Another app closed the USSD window before the next step. Dialing again (attempt " + (attempt + 1) + " of 3)");
                        UssdAccessibilityService.begin();
                    }
                    Step r = interactiveOnce(ctx, slot, first, steps, stepMs, keyDelayMs, totalMs, started, responses, sig);
                    status = r.status;
                    message = r.message;
                    long left = totalMs - (System.currentTimeMillis() - started);
                    if (!r.windowLost || left < 20000) break;
                }
            } catch (Exception e) {
                status = "error";
                message = String.valueOf(e.getMessage());
            } finally {
                if (usedDialog) {
                    UssdAccessibilityService.end();
                    UssdAccessibilityService s = UssdAccessibilityService.instance;
                    if (s != null) s.dismiss();
                }
                if (screen != null && screen.isHeld()) screen.release();
                if (cpu != null && cpu.isHeld()) cpu.release();
            }
            JSObject out = new JSObject();
            out.put("status", status);
            out.put("message", message);
            out.put("responses", responses);
            return out;
        }
    }
}