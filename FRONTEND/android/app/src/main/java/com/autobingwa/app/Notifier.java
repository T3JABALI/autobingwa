package com.autobingwa.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import androidx.core.app.NotificationCompat;

public class Notifier {
    static final String CH_RUN = "ab_running";
    static final String CH_ALERT = "ab_alerts";
    static final String CH_POP = "ab_popups"; // silent heads-up: processing and motivation
    static final int ID_RUN = 1001;
    static final int ID_FAIL = 1002;
    static final int ID_PROC = 1003;
    static final int ID_MOTIVE = 1004;
    private static final String[] MOTIVE = { "Speed meets Automation", "AutoBingwa = Profits" };
    private static int motiveIdx = 0;

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel run = new NotificationChannel(CH_RUN, "Automation status", NotificationManager.IMPORTANCE_LOW);
        run.setShowBadge(false);
        run.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        NotificationChannel alert = new NotificationChannel(CH_ALERT, "Transaction alerts", NotificationManager.IMPORTANCE_HIGH);
        alert.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        NotificationChannel pop = new NotificationChannel(CH_POP, "Pop-ups", NotificationManager.IMPORTANCE_HIGH);
        pop.setSound(null, null);
        pop.enableVibration(false);
        pop.setShowBadge(false);
        nm.createNotificationChannel(run);
        nm.createNotificationChannel(alert);
        nm.createNotificationChannel(pop);
    }

    private static PendingIntent open(Context c) {
        Intent i = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        if (i == null) return null;
        return PendingIntent.getActivity(c, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static Bitmap logo(Context c) {
        try { return BitmapFactory.decodeResource(c.getResources(), c.getApplicationInfo().icon); }
        catch (Exception e) { return null; }
    }

    // Compact heads-up: logo on the left, one line of text, no expanded view
    private static Notification popup(Context c, String ch, String title, String text, long timeoutMs, int cat) {
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, ch)
            .setSmallIcon(c.getApplicationInfo().icon)
            .setContentTitle(title)
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setTimeoutAfter(timeoutMs)
            .setContentIntent(open(c));
        if (cat == 1) b.setCategory(NotificationCompat.CATEGORY_ERROR);
        Bitmap big = logo(c);
        if (big != null) b.setLargeIcon(big);
        return b.build();
    }

    // The ongoing notification that keeps the app alive
    static Notification running(Context c, String text) {
        return new NotificationCompat.Builder(c, CH_RUN)
            .setSmallIcon(c.getApplicationInfo().icon)
            .setContentTitle("AutoBingwa is running")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(open(c))
            .build();
    }

    // Motivation pop-up, called every 5 minutes by the keep-alive service
    static void motivate(Context c) {
        try {
            channels(c);
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            nm.notify(ID_MOTIVE, popup(c, CH_POP, "AutoBingwa", MOTIVE[motiveIdx++ % MOTIVE.length], 6000, 0));
        } catch (Exception e) {
            // notifications may be switched off
        }
    }

    // kind: processing | idle | failed
    static void alert(Context c, String kind, String title, String text) {
        try {
            channels(c);
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if ("failed".equals(kind)) {
                nm.cancel(ID_PROC);
                nm.notify(ID_FAIL, popup(c, CH_ALERT, title, text, 8000, 1)); // same id: replaces the last one
            } else if ("processing".equals(kind)) {
                nm.notify(ID_PROC, popup(c, CH_POP, (title == null || title.isEmpty()) ? "Processing" : title, text, 40000, 0));
                if (KeepAliveService.active) nm.notify(ID_RUN, running(c, text));
            } else {
                nm.cancel(ID_PROC); // idle: the transaction finished
                if (KeepAliveService.active) nm.notify(ID_RUN, running(c, "Waiting for payments"));
            }
        } catch (Exception e) {
            // notifications may be switched off; nothing to do
        }
    }
}