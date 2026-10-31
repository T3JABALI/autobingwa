package com.autobingwa.app;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.provider.Telephony;
import android.util.Log;
import androidx.core.content.ContextCompat;

// Reads the SMS inbox for M-Pesa payments the live receiver missed.
// Payments only: confirmations and commissions are time-sensitive and are never replayed.
final class SmsCatchUp {
    private static final String TAG = "AutoBingwa";
    private static final String PREFS = "autobingwa_prefs";
    private static final String KEY_LAST = "lastScan";
    private static final long MAX_BACK_MS = 2L * 60 * 60 * 1000; // never look back further than 2 hours
    private static final long OVERLAP_MS = 2L * 60 * 1000;       // re-check the last 2 minutes each time
    private static final Object LOCK = new Object();

    private SmsCatchUp() {}

    // Returns how many new payments were queued
    static int scan(Context ctx) {
        synchronized (LOCK) {
            if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_SMS)
                    != PackageManager.PERMISSION_GRANTED) return 0;

            SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            long now = System.currentTimeMillis();
            long last = sp.getLong(KEY_LAST, 0L);
            if (last == 0L) { // first run: never turn old messages into purchases
                sp.edit().putLong(KEY_LAST, now).apply();
                return 0;
            }
            long since = Math.max(last - OVERLAP_MS, now - MAX_BACK_MS);

            int added = 0;
            Cursor c = null;
            try {
                c = ctx.getContentResolver().query(
                    Telephony.Sms.Inbox.CONTENT_URI,
                    new String[] { Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE },
                    Telephony.Sms.DATE + " > ?",
                    new String[] { String.valueOf(since) },
                    Telephony.Sms.DATE + " ASC");
                if (c == null) return 0;
                while (c.moveToNext()) {
                    String sender = c.getString(0) == null ? "" : c.getString(0);
                    String body = c.getString(1);
                    long date = c.getLong(2);
                    String code = SmsStore.codeOf(body);
                    if (code == null || SmsStore.seen(ctx, code)) continue;
                    SmsStore.add(ctx, sender, body, date);
                    added++;
                    Log.d(TAG, "catch-up queued payment " + code);
                }
            } catch (Exception e) {
                Log.e(TAG, "catch-up failed", e);
                return added; // the time mark stays put, so the next scan tries again
            } finally {
                if (c != null) c.close();
            }
            sp.edit().putLong(KEY_LAST, now).apply();
            return added;
        }
    }
}