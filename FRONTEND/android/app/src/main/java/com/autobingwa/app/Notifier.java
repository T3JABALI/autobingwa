package com.autobingwa.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;

public class Notifier {
    static final String CH_RUN = "ab_running";
    static final String CH_ALERT = "ab_alerts";
    static final int ID_RUN = 1001;
    static final int ID_FAIL = 1002;

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel run = new NotificationChannel(CH_RUN, "Automation status", NotificationManager.IMPORTANCE_LOW);
        run.setShowBadge(false);
        NotificationChannel alert = new NotificationChannel(CH_ALERT, "Transaction alerts", NotificationManager.IMPORTANCE_HIGH);
        nm.createNotificationChannel(run);
        nm.createNotificationChannel(alert);
    }

    private static PendingIntent open(Context c) {
        Intent i = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        if (i == null) return null;
        return PendingIntent.getActivity(c, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    // The ongoing notification that keeps the app alive
    static Notification running(Context c, String text) {
        return new NotificationCompat.Builder(c, CH_RUN)
            .setSmallIcon(c.getApplicationInfo().icon)
            .setContentTitle("AutoBingwa is running")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(open(c))
            .build();
    }

    // kind: processing | idle (update the ongoing notification) | failed (one heads-up that replaces the last)
    static void alert(Context c, String kind, String title, String text) {
        try {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if ("failed".equals(kind)) {
                Notification n = new NotificationCompat.Builder(c, CH_ALERT)
                    .setSmallIcon(c.getApplicationInfo().icon)
                    .setContentTitle(title)
                    .setContentText(text)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setAutoCancel(true)
                    .setContentIntent(open(c))
                    .build();
                nm.notify(ID_FAIL, n); // same id: a new failure replaces the old one, never a flood
            } else if (KeepAliveService.active) {
                nm.notify(ID_RUN, running(c, "processing".equals(kind) ? text : "Waiting for payments"));
            }
        } catch (Exception e) {
            // notifications may be switched off; nothing to do
        }
    }
}