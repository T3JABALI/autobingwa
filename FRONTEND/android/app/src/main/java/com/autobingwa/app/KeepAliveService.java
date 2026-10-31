package com.autobingwa.app;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import android.util.Log;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public class KeepAliveService extends Service {
    static volatile boolean active = false;
    private ScheduledExecutorService scanner;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notifier.channels(this);
        startForeground(Notifier.ID_RUN, Notifier.running(this, "Waiting for payments"));
        active = true;
        if (scanner == null) {
            scanner = Executors.newSingleThreadScheduledExecutor();
            scanner.scheduleWithFixedDelay(new Runnable() {
                @Override
                public void run() {
                    try {
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
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}