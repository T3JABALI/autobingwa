package com.autobingwa.app;

import android.app.Service;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public class KeepAliveService extends Service {
    static volatile boolean active = false;
    static volatile long lastWakeAt = 0;
    private static final long WAKE_MS = 6L * 60 * 60 * 1000; // renewed every scan, so it can never leak
    private ScheduledExecutorService scanner;
    private PowerManager.WakeLock wake;
    private int ticks = 0; // counts scans, one every 10 seconds

    // Switches the USSD accessibility service back on if Android turned it off
    private void ensureAccessibility() {
        try {
            if (UssdAccessibilityService.instance != null) return;
            if (checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") != PackageManager.PERMISSION_GRANTED) return;
            String me = getPackageName() + "/" + UssdAccessibilityService.class.getName();
            ContentResolver r = getContentResolver();
            String cur = Settings.Secure.getString(r, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            if (cur == null) cur = "";
            // remove then add, so Android restarts the service even if it was listed but stuck
            cur = cur.replace(me, "").replace("::", ":");
            if (cur.startsWith(":")) cur = cur.substring(1);
            if (cur.endsWith(":")) cur = cur.substring(0, cur.length() - 1);
            Settings.Secure.putString(r, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, cur.isEmpty() ? me : cur + ":" + me);
            Settings.Secure.putInt(r, Settings.Secure.ACCESSIBILITY_ENABLED, 1);
            Log.i("AutoBingwa", "accessibility service re-enabled");
        } catch (Exception e) {
            Log.e("AutoBingwa", "ensureAccessibility", e);
        }
    }

    // Keeps the CPU awake while automation is running, so the queue keeps going with the screen off
    private void holdCpu() {
        try {
            if (wake == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AutoBingwa:keepalive");
                wake.setReferenceCounted(false);
            }
            if (!wake.isHeld()) wake.acquire(WAKE_MS);
        } catch (Exception e) {
            Log.e("AutoBingwa", "wake lock", e);
        }
    }

    // Brings the app to the front for a moment. MainActivity sends it back to the background.
    // Static, so the SMS receiver can call it too.
    static void wakeNow(Context ctx) {
        try {
            lastWakeAt = System.currentTimeMillis();
            Intent i = new Intent(ctx, MainActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            i.putExtra("restart", true);
            // Android 10+ only lets a background service open an activity with "Display over other apps"
            if (Build.VERSION.SDK_INT < 29 || Settings.canDrawOverlays(ctx)) {
                ctx.startActivity(i);
            }
        } catch (Exception e) {
            Log.e("AutoBingwa", "wakeNow", e);
        }
    }

    private void wakeApp() { wakeNow(this); }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notifier.channels(this);
        startForeground(Notifier.ID_RUN, Notifier.running(this, "Waiting for payments"));
        active = true;
        ensureAccessibility();
        AutoBingwaPlugin.lastBeat = System.currentTimeMillis(); // grace period after a start
        holdCpu();
        if (scanner == null) {
            scanner = Executors.newSingleThreadScheduledExecutor();
            scanner.scheduleWithFixedDelay(new Runnable() {
                @Override
                public void run() {
                    try {
                        holdCpu();
                        ticks++;
                        if (ticks % 3 == 0) ensureAccessibility();                          // every 30 s
                        if (ticks % 30 == 0) Notifier.motivate(getApplicationContext());    // every 5 min

                        long now = System.currentTimeMillis();
                        long silent = now - AutoBingwaPlugin.lastBeat;

                        // Inbox catch-up every 30 s
                        if (ticks % 3 == 0) {
                            int n = SmsCatchUp.scan(getApplicationContext());
                            if (n > 0) AutoBingwaPlugin.poke();
                        }

                        // A payment is waiting and the web engine is not beating: bring the app forward now
                        boolean waiting = SmsStore.peek(getApplicationContext()).length() > 0;
                        if (waiting && silent > 10000 && now - lastWakeAt > 30000) {
                            Log.w("AutoBingwa", "payment waiting, web engine silent " + silent + " ms, waking the app");
                            wakeApp();
                        }

                        // General watchdog, much faster than before
                        if (silent > 45000 && now - lastWakeAt > 60000) {
                            Log.w("AutoBingwa", "web engine stalled, waking the app");
                            wakeApp();
                        }
                    } catch (Exception e) {
                        Log.e("AutoBingwa", "scan loop", e);
                    }
                }
            }, 5, 10, TimeUnit.SECONDS);
        }
        return START_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        Log.i("AutoBingwa", "task removed, relaunching");
        wakeApp();
    }

    @Override
    public void onDestroy() {
        active = false;
        if (scanner != null) {
            scanner.shutdownNow();
            scanner = null;
        }
        try {
            if (wake != null && wake.isHeld()) wake.release();
        } catch (Exception e) {
            Log.e("AutoBingwa", "wake release", e);
        }
        wake = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}