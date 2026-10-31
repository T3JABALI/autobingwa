package com.autobingwa.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import android.util.Log;
import java.util.Locale;

public class SmsReceiver extends BroadcastReceiver {
    private static final String TAG = "AutoBingwa";

    @Override
    public void onReceive(Context context, Intent intent) {
        Log.d(TAG, "onReceive action=" + intent.getAction());
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;

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

        // Compare letters only, so "M-PESA", "MPESA" and "Mpesa " all match
        String letters = sender.toUpperCase(Locale.ROOT).replaceAll("[^A-Z]", "");
        boolean keep = letters.contains("MPESA") || letters.contains("SAFARICOM");
        Log.d(TAG, "SMS from '" + sender + "' keep=" + keep);
        if (!keep) return;

        SmsStore.add(context, sender, body.toString(), parts[0].getTimestampMillis());
        Log.d(TAG, "saved to queue");
        AutoBingwaPlugin.poke();
    }
}