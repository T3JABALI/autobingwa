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
import android.content.SharedPreferences;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

public class KeepAliveService extends Service {
    static volatile boolean active = false;
    static volatile long lastWakeAt = 0;
    private static final long WAKE_MS = 6L * 60 * 60 * 1000; // renewed every scan, so it can never leak
    private static final long FRESH_MS = 10L * 60 * 1000;    // only messages newer than this can wake the app
    private ScheduledExecutorService scanner;
        private ScheduledExecutorService pinger; // separate thread, so a slow network never delays the payment scan
    private PowerManager.WakeLock wake;
    private int ticks = 0; // counts scans, one every 10 seconds
    private String lastKey = "";
    private int wakeCount = 0;

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

    // Brings the app to the front so the web engine runs again. MainActivity sends it back afterwards.
    // Never during a USSD purchase: it would cover the phone's USSD window.
    static void wakeNow(Context ctx) {
        try {
            if (UssdFlow.busy) return;
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

    // The newest unprocessed message that arrived in the last 10 minutes, or null when none is waiting
    private String waitingKey() {
        try {
            JSONArray q = SmsStore.peek(getApplicationContext());
            long cutoff = System.currentTimeMillis() - FRESH_MS;
            long newest = 0;
            String key = null;
            for (int i = 0; i < q.length(); i++) {
                JSONObject o = q.optJSONObject(i);
                if (o == null) continue;
                long t = o.optLong("time", 0);
                if (t < cutoff || t < newest) continue;
                newest = t;
                key = o.optString("id", "");
            }
            return key;
        } catch (Exception e) {
            return null;
        }
    }
    // Tells the portal this phone is alive. Uses /device/ping, which never takes the portal's commands.
    private void pingPortal() {
        HttpURLConnection c = null;
        try {
            SharedPreferences sp = getSharedPreferences("autobingwa_prefs", Context.MODE_PRIVATE);
            String id = sp.getString("portal_id", "");
            String secret = sp.getString("portal_secret", "");
            if (id.isEmpty() || secret.isEmpty() || !sp.getBoolean("portal_on", false)) return;
            c = (HttpURLConnection) new URL("https://autobingwa-payments.onrender.com/device/ping").openConnection();
            c.setConnectTimeout(10000);
            c.setReadTimeout(10000);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("X-Connect-Id", id);
            c.setRequestProperty("X-Device-Secret", secret);
            OutputStream os = c.getOutputStream();
            os.write("{\"portalOn\":true}".getBytes("UTF-8"));
            os.close();
            int code = c.getResponseCode();
            if (code != 200) Log.w("AutoBingwa", "portal ping answered " + code);
        } catch (Exception e) {
            Log.w("AutoBingwa", "portal ping failed: " + e.getMessage());
        } finally {
            if (c != null) c.disconnect();
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
                        ticks++;
                        if (ticks % 3 == 0) ensureAccessibility();                       // every 30 s
                        if (ticks % 30 == 0) Notifier.motivate(getApplicationContext()); // every 5 min

                        long now = System.currentTimeMillis();
                        long silent = now - AutoBingwaPlugin.lastBeat;

                        // Inbox catch-up every 30 s
                        if (ticks % 3 == 0) {
                            int n = SmsCatchUp.scan(getApplicationContext());
                            if (n > 0) AutoBingwaPlugin.poke();
                        }
                        if (EngineCore.owns(getApplicationContext())) EngineCore.tick(getApplicationContext());
                        // Bring the app forward ONLY when a fresh message is waiting and the web engine is silent.
                        // Never in the middle of a purchase, and at most 3 times for the same message.
                        // While the background engine owns payments, the app is never woken for a waiting SMS
                        String key = EngineCore.owns(getApplicationContext()) ? null : waitingKey();
                        if (key == null) {
                            lastKey = "";
                            wakeCount = 0;
                        } else if (silent > 10000 && !UssdFlow.busy && now - lastWakeAt > 30000) {
                            if (key.equals(lastKey)) wakeCount++; else { lastKey = key; wakeCount = 1; }
                            if (wakeCount <= 3) {
                                Log.w("AutoBingwa", "message waiting, web engine silent " + silent + " ms, waking the app");
                                wakeApp();
                            }
                        }
                    } catch (Exception e) {
                        Log.e("AutoBingwa", "scan loop", e);
                    }
                }
              }, 5, 10, TimeUnit.SECONDS);
        }
        if (pinger == null) {
            pinger = Executors.newSingleThreadScheduledExecutor();
            pinger.scheduleWithFixedDelay(new Runnable() {
                @Override
                public void run() { pingPortal(); }
            }, 3, 15, TimeUnit.SECONDS);
        }
        return START_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        // The user swiped the app away. Leave it closed. A fresh payment can still bring it back to process it.
        Log.i("AutoBingwa", "task removed");
    }

    @Override
    public void onDestroy() {
        active = false;
        if (scanner != null) {
            scanner.shutdownNow();
            scanner = null;
        }
                if (pinger != null) {
            pinger.shutdownNow();
            pinger = null;
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