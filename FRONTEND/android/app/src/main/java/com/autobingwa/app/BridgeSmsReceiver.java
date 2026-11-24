package com.autobingwa.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Receives a payment sent by SMS from the reader phone when it had no internet. */
public class BridgeSmsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !"android.provider.Telephony.SMS_RECEIVED".equals(intent.getAction())) return;
        SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (parts == null || parts.length == 0) return;
        StringBuilder sb = new StringBuilder();
        for (SmsMessage m : parts) {
            if (m == null) continue;
            String b = m.getMessageBody();
            if (b != null) sb.append(b);
        }
        final String body = sb.toString().trim();
               final String from = parts[0] == null || parts[0].getOriginatingAddress() == null ? "" : parts[0].getOriginatingAddress();
        if (!body.startsWith("AB1|")) return; // not a bridge message: leave it alone
        final Context app = context.getApplicationContext();
        final PendingResult pr = goAsync();
        new Thread(new Runnable() {
            @Override public void run() {
                try { handle(app, body, from); }
                catch (Throwable e) { EngineCore.note(app, "Bridge SMS error: " + e); }
                finally { pr.finish(); }
            }
        }).start();
    }

    private static String tag(String key, String data) throws Exception {
        Mac m = Mac.getInstance("HmacSHA256");
        m.init(new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        byte[] h = m.doFinal(data.getBytes(StandardCharsets.UTF_8));
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < 5; i++) b.append(String.format("%02x", h[i]));
        return b.toString();
    }

    private static void handle(Context c, String body, String from) throws Exception {
        String[] p = body.split("\\|");
        if (p.length != 5) return;
        String code = p[1].trim().toUpperCase();
        String amt = p[2].trim();
        String phone = p[3].trim();
        String got = p[4].trim();
        // Optional: with an empty list any sender passes and only the key check protects us
        if (AuthorizedSenders.any(c) && !AuthorizedSenders.has(c, from)) {
            EngineCore.note(c, "Bridge SMS ignored: " + code + " came from " + from + ", which is not on the Authorized senders list");
            return;
        }
        String key = LanClient.key(c);
        if (key.isEmpty()) { EngineCore.note(c, "Bridge SMS ignored: no Wi-Fi key saved on this phone"); return; }
        String want = tag(key, code + "|" + amt + "|" + phone);
        if (!MessageDigest.isEqual(want.getBytes(StandardCharsets.UTF_8), got.getBytes(StandardCharsets.UTF_8))) {
            EngineCore.note(c, "Bridge SMS ignored: wrong key for " + code);
            return;
        }
        if (code.isEmpty() || !phone.matches("0[17]\\d{8}")) return;
        double amount;
        try { amount = Double.parseDouble(amt); } catch (Exception e) { return; }
        if (amount <= 0) return;

        if (!CloudSync.paired(c) || "reader".equals(CloudSync.role(c)) || EngineCore.cloudBlocker(c) != null) {
            EngineCore.note(c, "Bridge SMS " + code + " not taken: this phone cannot dial right now");
            return;
        }
        String jobId = "sms:" + code;
        if (EngineCore.hasCloudJob(c, jobId)) return; // the same SMS twice
        String[] problem = EngineCore.ingestCloud(c, jobId, code, amount, phone);
        if (problem != null) EngineCore.note(c, "Bridge SMS " + code + " refused: " + problem[1]);
        else EngineCore.note(c, "Bridge SMS job " + code + " taken from the reader");
    }
}