package com.autobingwa.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

// Wi-Fi backup: asks the reader phone for jobs over the local network and reports each result back to it.
final class LanClient {
    private static final ExecutorService NET = Executors.newSingleThreadExecutor();
    private static final Object OUT = new Object();
 

    private LanClient() { }

    private static SharedPreferences sp(Context c) {
        return c.getSharedPreferences("autobingwa_prefs", Context.MODE_PRIVATE);
    }

    /** Saves the reader's address (like 192.168.43.1:8765) and Wi-Fi key shown on the reader's Wi-Fi backup page. */
    static void save(Context c, String addr, String key) {
        String a = addr == null ? "" : addr.trim().replace("http://", "");
        while (a.endsWith("/")) a = a.substring(0, a.length() - 1);
        if (!a.isEmpty() && a.indexOf(':') < 0) a = a + ":8765";
        String k = key == null ? "" : key.trim().toUpperCase(Locale.US);
        sp(c).edit().putString("lan_addr", a).putString("lan_key", k).apply();
    }

    static String addr(Context c) { return sp(c).getString("lan_addr", ""); }
    static String key(Context c) { return sp(c).getString("lan_key", ""); }
    static boolean configured(Context c) { return !addr(c).isEmpty() && !key(c).isEmpty(); }

    private static String enc(String s) {
        try { return URLEncoder.encode(s == null ? "" : s, "UTF-8"); } catch (Exception e) { return ""; }
    }

    private static String url(Context c, String path, String... kv) {
        StringBuilder b = new StringBuilder("http://").append(addr(c)).append(path)
            .append("?key=").append(enc(key(c)));
        for (int i = 0; i + 1 < kv.length; i += 2) b.append('&').append(kv[i]).append('=').append(enc(kv[i + 1]));
        return b.toString();
    }

    // Uses the Wi-Fi network directly, so it still works when mobile data is the phone's default connection
    private static String get(Context c, String u) throws Exception {
        return get(c, u, 4000);
    }

    private static String get(Context c, String u, int readMs) throws Exception {
        URL url = new URL(u);
        HttpURLConnection h = null;
        try {
            ConnectivityManager cm = (ConnectivityManager) c.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                for (Network n : cm.getAllNetworks()) {
                    NetworkCapabilities nc = cm.getNetworkCapabilities(n);
                    if (nc != null && nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                        h = (HttpURLConnection) n.openConnection(url);
                        break;
                    }
                }
            }
        } catch (Throwable ignored) { }
        if (h == null) h = (HttpURLConnection) url.openConnection();
        try {
            h.setConnectTimeout(2000);
            h.setReadTimeout(readMs);
            int code = h.getResponseCode();
            if (code != 200) throw new Exception("HTTP " + code);
            InputStream in = h.getInputStream();
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[2048];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            in.close();
            return bo.toString("UTF-8");
        } finally {
            h.disconnect();
        }
    }

    private static volatile boolean loopOn = false;

    /** Called on every beat. Starts the fast listener once; later calls do nothing while it runs. */
    static void poll(final Context ctx) {
        final Context c = ctx.getApplicationContext();
        if (loopOn) return;
        loopOn = true;
        Thread t = new Thread(new Runnable() {
            @Override public void run() {
                try { loop(c); } finally { loopOn = false; }
            }
        }, "ab-lan");
        t.setDaemon(true);
        t.start();
    }

    private static void loop(Context c) {
        for (;;) {
            try {
                if (!CloudSync.paired(c) || "reader".equals(CloudSync.role(c)) || !configured(c)
                        || EngineCore.cloudBlocker(c) != null) {
                    Thread.sleep(2000); // not set up, or this phone cannot dial right now
                    continue;
                }
                sendOutbox(c);
                String dialer = sp(c).getString("cloud_device_id", "");
                // The reader holds this request for up to 8 seconds and answers the moment a job exists
                JSONArray jobs = new JSONArray(get(c, url(c, "/jobs", "dialer", dialer, "wait", "8"), 12000));
                for (int i = 0; i < jobs.length(); i++) {
                    JSONObject j = jobs.optJSONObject(i);
                    if (j == null) continue;
                    String code = j.optString("code");
                    String jobId = "lan:" + code;
                    if (code.isEmpty() || EngineCore.hasCloudJob(c, jobId)) continue;
                    String[] problem = EngineCore.ingestCloud(c, jobId, code, j.optDouble("amount", 0), j.optString("phone"));
                    if (problem != null) report(c, code, false, problem[1]);
                    else EngineCore.note(c, "Wi-Fi backup job " + code + " taken from the reader");
                }
            } catch (InterruptedException e) {
                return;
            } catch (Throwable e) {
                try { Thread.sleep(3000); } catch (InterruptedException ie) { return; } // reader not reachable
            }
        }
    }

    /** Tells the reader how a job ended. Kept on the phone and retried until the reader answers. */
    static void report(final Context ctx, String code, boolean ok, String msg) {
        final Context c = ctx.getApplicationContext();
        synchronized (OUT) {
            try {
                JSONArray q = new JSONArray(sp(c).getString("lan_outbox", "[]"));
                q.put(new JSONObject().put("code", code).put("ok", ok).put("msg", msg == null ? "" : msg));
                JSONArray keep = new JSONArray();
                for (int i = Math.max(0, q.length() - 2000); i < q.length(); i++) keep.put(q.get(i));
                sp(c).edit().putString("lan_outbox", keep.toString()).apply();
            } catch (Exception ignored) { }
        }
        NET.execute(new Runnable() {
            @Override public void run() { try { sendOutbox(c); } catch (Throwable ignored) { } }
        });
    }

    private static void sendOutbox(Context c) {
        JSONArray q;
        synchronized (OUT) {
            try { q = new JSONArray(sp(c).getString("lan_outbox", "[]")); } catch (Exception e) { return; }
        }
        String dialer = sp(c).getString("cloud_device_id", "");
        for (int i = 0; i < q.length(); i++) {
            JSONObject it = q.optJSONObject(i);
            if (it == null) continue;
            String code = it.optString("code");
            boolean sent = false;
            try {
                get(c, url(c, "/done", "code", code, "dialer", dialer,
                    "ok", it.optBoolean("ok") ? "1" : "0", "msg", it.optString("msg")));
                sent = true;
            } catch (Exception e) {
                String m = e.getMessage();
                if (m != null && m.startsWith("HTTP")) sent = true; // the reader refused it: do not retry forever
                else return; // reader not reachable: try again on the next beat
            }
            if (sent) drop(c, code);
        }
    }

    private static void drop(Context c, String code) {
        synchronized (OUT) {
            try {
                JSONArray q = new JSONArray(sp(c).getString("lan_outbox", "[]"));
                JSONArray keep = new JSONArray();
                boolean removed = false;
                for (int i = 0; i < q.length(); i++) {
                    JSONObject o = q.optJSONObject(i);
                    if (!removed && o != null && code.equals(o.optString("code"))) { removed = true; continue; }
                    keep.put(q.get(i));
                }
                sp(c).edit().putString("lan_outbox", keep.toString()).apply();
            } catch (Exception ignored) { }
        }
    }
}