package com.autobingwa.app;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public class KeepAliveService extends Service {
    static volatile boolean active = false;
    private static final long WAKE_MS = 6L * 60 * 60 * 1000; // renewed every scan, so it can never leak
    private ScheduledExecutorService scanner;
    private PowerManager.WakeLock wake;

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

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notifier.channels(this);
        startForeground(Notifier.ID_RUN, Notifier.running(this, "Waiting for payments"));
        active = true;
        holdCpu();
        if (scanner == null) {
            scanner = Executors.newSingleThreadScheduledExecutor();
            scanner.scheduleWithFixedDelay(new Runnable() {
                @Override
                public void run() {
                    try {
                        holdCpu();
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