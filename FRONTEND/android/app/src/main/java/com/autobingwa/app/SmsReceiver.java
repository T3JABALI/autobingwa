package com.autobingwa.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import android.util.Log;
import java.util.Locale;
import java.util.regex.Pattern;

public class SmsReceiver extends BroadcastReceiver {
    private static final String TAG = "AutoBingwa";
    // "UJ12ABC345 Confirmed. You have received ..." from any sender
    private static final Pattern PAYMENT =
        Pattern.compile("^\\s*[A-Z0-9]{10}\\s+Confirmed", Pattern.CASE_INSENSITIVE);

    @Override
    public void onReceive(Context context, Intent intent) {
        Log.d(TAG, "onReceive action=" + intent.getAction());
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;

        final PendingResult pending = goAsync();
        try {
            handle(context, intent);
        } catch (Exception e) {
            Log.e(TAG, "SmsReceiver failed", e);
        } finally {
            if (pending != null) pending.finish();
        }
    }

    private void handle(Context context, Intent intent) {
        SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (parts == null || parts.length == 0) {
            Log.d(TAG, "no message parts");
            return;
        }

        String sender = parts[0].getOriginatingAddress();
        if (sender == null) sender = "";

        StringBuilder body = new StringBuilder();
        for (SmsMessage p : parts) {
            String piece = p.getMessageBody();
            if (piece != null) body.append(piece);
        }
        String text = body.toString();

        // Compare letters only, so "M-PESA", "MPESA" and "Mpesa " all match
        String letters = sender.toUpperCase(Locale.ROOT).replaceAll("[^A-Z]", "");
        boolean fromSender = letters.contains("MPESA") || letters.contains("SAFARICOM");
        boolean payment = PAYMENT.matcher(text).find();
        // Bingwa commission messages are kept whoever sends them
        String lower = text.toLowerCase(Locale.ROOT);
        boolean commission = lower.contains("total commission this week")
                || lower.contains("thank you for choosing safaricom")
                || lower.contains("recommendation failed")
                || lower.contains("submitted successfully")
                || lower.contains("already been recommended");
        boolean keep = fromSender || payment || commission;
        Log.d(TAG, "SMS from '" + sender + "' keep=" + keep + " payment=" + payment + " commission=" + commission);
        if (!keep) return;

        SmsStore.add(context, sender, text, parts[0].getTimestampMillis());
        Log.d(TAG, "saved to queue");
        AutoBingwaPlugin.poke();
                int extra = SmsCatchUp.scan(context);
        if (extra > 0) AutoBingwaPlugin.poke();
    }
}