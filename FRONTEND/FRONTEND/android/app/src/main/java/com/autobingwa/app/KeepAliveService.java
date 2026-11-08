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
    private static final long WAKE_MS = 6L * 60 * 60 * 1000; // renewed every scan, so it can never leak
    private ScheduledExecutorService scanner;
    private PowerManager.WakeLock wake;
    private int ticks = 0; // counts scans, one every 30 seconds
    private long lastWake = 0;

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
    private void wakeApp() {
        try {
            Intent i = new Intent(this, MainActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            i.putExtra("restart", true);
            // Android 10+ only lets a background service open an activity with "Display over other apps"
            if (Build.VERSION.SDK_INT < 29 || Settings.canDrawOverlays(this)) {
                startActivity(i);
            }
        } catch (Exception e) {
            Log.e("AutoBingwa", "wakeApp", e);
        }
    }

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
                        ensureAccessibility();
                        if (++ticks % 10 == 0) Notifier.motivate(getApplicationContext()); // every 5 minutes

                        // Watchdog: no heartbeat from the web engine means it is frozen
                        long now = System.currentTimeMillis();
                        if (now - AutoBingwaPlugin.lastBeat > 90000 && now - lastWake > 120000) {
                            lastWake = now;
                            Log.w("AutoBingwa", "web engine stalled, waking the app");
                            wakeApp();
                        }

                        int n = SmsCatchUp.scan(getApplicationContext());
                        if (n > 0) AutoBingwaPlugin.poke();
                    } catch (Exception e) {
                        Log.e("AutoBingwa", "scan loop", e);
                    }
                }
            }, 5, 30, TimeUnit.SECONDS);
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