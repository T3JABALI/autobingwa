package com.autobingwa.app;

import android.app.Service;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;
import android.content.IntentFilter;
import android.os.BatteryManager;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
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
    // When the web view is asleep, the service syncs the portal itself using the last snapshot JS saved
    private void syncPortal() {
        long silent = System.currentTimeMillis() - AutoBingwaPlugin.lastPortalBeat;
        if (silent < 20000) { pingPortal(); return; } // web view is alive and syncing itself
        // Commands are still waiting and the web view is still asleep: try the wake again (at most every 30 s)
        if (PortalQueue.peek(getApplicationContext()).length() > 0
                && System.currentTimeMillis() - lastWakeAt > 30000) {
            wakeApp();
        }
        HttpURLConnection c = null;
        try {
            SharedPreferences sp = getSharedPreferences("autobingwa_prefs", Context.MODE_PRIVATE);
            String id = sp.getString("portal_id", "");
            String secret = sp.getString("portal_secret", "");
            if (id.isEmpty() || secret.isEmpty() || !sp.getBoolean("portal_on", false)) return;

            JSONObject body = new JSONObject();
            body.put("portalOn", true);
            String snapStr = sp.getString("portal_snapshot", "");
            if (!snapStr.isEmpty()) {
                JSONObject s = new JSONObject(snapStr);
                Intent b = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
                if (b != null) {
                    int lvl = b.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                    int scale = b.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
                    int st = b.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
                    if (lvl >= 0) s.put("battery", lvl * 100 / scale);
                    s.put("charging", st == BatteryManager.BATTERY_STATUS_CHARGING || st == BatteryManager.BATTERY_STATUS_FULL);
                }
                                overlayNative(s);
                body.put("snapshot", s);
                body.put("snapshot", s);
            }

            c = (HttpURLConnection) new URL("https://autobingwa-payments.onrender.com/device/sync").openConnection();
            c.setConnectTimeout(10000);
            c.setReadTimeout(15000);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("X-Connect-Id", id);
            c.setRequestProperty("X-Device-Secret", secret);
            OutputStream os = c.getOutputStream();
            os.write(body.toString().getBytes("UTF-8"));
            os.close();

            int code = c.getResponseCode();
            if (code != 200) { Log.w("AutoBingwa", "native sync answered " + code); return; }
            InputStream in = c.getInputStream();
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            in.close();
            JSONArray cmds = new JSONObject(bo.toString("UTF-8")).optJSONArray("commands");
            if (cmds != null && cmds.length() > 0 && PortalQueue.add(getApplicationContext(), cmds)) {
                AutoBingwaPlugin.pokeCommands();
                wakeApp(); // commands need the web engine to run them
            }
        } catch (Exception e) {
            Log.w("AutoBingwa", "native sync failed: " + e.getMessage());
        } finally {
            if (c != null) c.disconnect();
        }
    }
        // While the native engine owns payments, its results never reach the saved JS snapshot.
    // This puts them in before the service posts it.
    private void overlayNative(JSONObject s) {
        try {
            Context ctx = getApplicationContext();
            if (!EngineCore.owns(ctx)) return;
            JSONArray nat = EngineCore.recent(ctx);

            java.util.HashMap<String, JSONObject> byId = new java.util.HashMap<>();
            java.util.HashSet<String> jsIds = new java.util.HashSet<>();
            JSONArray old = s.optJSONArray("recent");
            for (int i = 0; old != null && i < old.length(); i++) {
                JSONObject o = old.optJSONObject(i);
                if (o == null) continue;
                byId.put(o.optString("id"), o);
                jsIds.add(o.optString("id"));
            }

            // an original that has a fallback is hidden, same rule as the Home screen
            java.util.HashSet<String> hide = new java.util.HashSet<>();
            for (int i = 0; i < nat.length(); i++) {
                JSONObject t = nat.optJSONObject(i);
                if (t == null || !t.optBoolean("isFallback", false)) continue;
                String from = t.optString("fallbackFromId", "");
                if (!from.isEmpty() && !"Skipped".equals(t.optString("status"))) hide.add(from);
            }

            java.util.Calendar cal = java.util.Calendar.getInstance();
            cal.set(java.util.Calendar.HOUR_OF_DAY, 0);
            cal.set(java.util.Calendar.MINUTE, 0);
            cal.set(java.util.Calendar.SECOND, 0);
            cal.set(java.util.Calendar.MILLISECOND, 0);
            long todayStart = cal.getTimeInMillis();
            int ok = s.optInt("ok", 0), failed = s.optInt("failed", 0);

            java.text.SimpleDateFormat iso = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
            iso.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));

            for (int i = 0; i < nat.length(); i++) {
                JSONObject t = nat.optJSONObject(i);
                if (t == null) continue;
                String id = t.optString("id");
                if (hide.contains(id)) { byId.remove(id); continue; }

                if (!jsIds.contains(id) && t.optLong("createdAt", 0) >= todayStart) {
                    String st = t.optString("status");
                    if ("Completed".equals(st)) ok++;
                    else if ("Failed".equals(st)) failed++;
                }

                StringBuilder resp = new StringBuilder();
                JSONArray rs = t.optJSONArray("responses");
                for (int k = 0; rs != null && k < rs.length(); k++) {
                    JSONObject r = rs.optJSONObject(k);
                    if (r == null) continue;
                    if (resp.length() > 0) resp.append("\n\n");
                    resp.append("--- Screen ").append(k + 1).append(" (input: ").append(r.optString("input")).append(") ---\n")
                        .append(r.optString("text"));
                }
                JSONObject e = new JSONObject();
                String phone = t.optString("phone", "");
                String name = t.optString("name", "");
                e.put("id", id);
                e.put("name", name.isEmpty() ? phone : name);
                e.put("phone", phone);
                e.put("amt", t.optDouble("amount", 0));
                e.put("offer", t.optString("offerName", ""));
                e.put("st", t.optString("status"));
                e.put("ts", iso.format(new java.util.Date(t.optLong("createdAt", 0))));
                e.put("msg", t.optString("rawMessage", ""));
                e.put("ussd", t.optString("ussd", ""));
                e.put("resp", resp.length() == 0 ? "No response recorded yet." : resp.toString());
                byId.put(id, e); // the native copy is newer than the saved JS copy
            }

            java.util.ArrayList<JSONObject> list = new java.util.ArrayList<>(byId.values());
            java.util.Collections.sort(list, new java.util.Comparator<JSONObject>() {
                @Override public int compare(JSONObject a, JSONObject b) {
                    return b.optString("ts").compareTo(a.optString("ts"));
                }
            });
            JSONArray out = new JSONArray();
            for (int i = 0; i < list.size() && i < 20; i++) out.put(list.get(i));

            JSONArray hidden = s.optJSONArray("hidden");
            if (hidden == null) hidden = new JSONArray();
            for (String h : hide) hidden.put(h);

            s.put("recent", out);
            s.put("hidden", hidden);
            s.put("ok", ok);
            s.put("failed", failed);
            s.put("tokens", EngineCore.unitsLeft(ctx));
            s.put("running", EngineCore.running(ctx));
        } catch (Exception e) {
            Log.w("AutoBingwa", "overlayNative failed: " + e.getMessage());
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
                        boolean auto = getSharedPreferences("autobingwa_prefs", Context.MODE_PRIVATE).getBoolean("keepalive", false);
                        if (ticks % 3 == 0) ensureAccessibility();                       // every 30 s
if (auto && ticks % 30 == 0) Notifier.motivate(getApplicationContext()); // every 5 min

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
String key = (!auto || EngineCore.owns(getApplicationContext())) ? null : waitingKey();
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
                public void run() { syncPortal(); }
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