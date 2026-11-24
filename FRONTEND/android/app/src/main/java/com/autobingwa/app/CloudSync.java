package com.autobingwa.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

// Talks to the Connect backend. Every call uses only this phone's device id and secret.
final class CloudSync {
    private static final String TAG = "AutoBingwa";
    private static final String BASE = "https://smoukalewmuorpowfiqr.supabase.co/rest/v1/rpc/";
    private static final String KEY = "sb_publishable_fpzaTJK1WYibPlbBEfmh9Q_QTzEDgDf"; // publishable: safe inside an app
    private static final Object OUT = new Object();
    // One thread for everything, so two signals for the same job can never claim it twice
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();
    private static String lastNote = "";
    private static volatile String lastErr = "";


    private CloudSync() { }

    private static final class HttpFail extends Exception {
        final int code;
        HttpFail(int code, String body) { super("HTTP " + code + " " + body); this.code = code; }
    }

    private static SharedPreferences sp(Context c) {
        return c.getSharedPreferences("autobingwa_prefs", Context.MODE_PRIVATE);
    }

    static boolean paired(Context c) {
        return !sp(c).getString("cloud_device_id", "").isEmpty() && !sp(c).getString("cloud_secret", "").isEmpty();
    }

       static void saveDevice(Context c, String deviceId, String secret, String role) {
        sp(c).edit().putString("cloud_device_id", deviceId).putString("cloud_secret", secret)
            .putString("cloud_role", "reader".equals(role) ? "reader" : "dialer")
            .remove("cloud_amounts_sent").remove("cloud_offers_sent").apply();
    }

    static String role(Context c) {
        return sp(c).getString("cloud_role", "dialer");
    }

    static int outboxSize(Context c) {
        synchronized (OUT) { return readOut(c).length(); }
    }

    private static JSONObject creds(Context c) throws Exception {
        return new JSONObject()
            .put("p_device", sp(c).getString("cloud_device_id", ""))
            .put("p_secret", sp(c).getString("cloud_secret", ""));
    }

    private static String read(InputStream in) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        in.close();
        return bo.toString("UTF-8");
    }

    private static String rpc(String fn, JSONObject args) throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(BASE + fn).openConnection();
        try {
            h.setConnectTimeout(10000);
            h.setReadTimeout(15000);
            h.setRequestMethod("POST");
            h.setDoOutput(true);
            h.setRequestProperty("Content-Type", "application/json");
            h.setRequestProperty("apikey", KEY);
            h.setRequestProperty("Content-Profile", "connect");
            OutputStream os = h.getOutputStream();
            os.write(args.toString().getBytes("UTF-8"));
            os.close();
            int code = h.getResponseCode();
            InputStream in = (code >= 200 && code < 300) ? h.getInputStream() : h.getErrorStream();
            String body = in == null ? "" : read(in);
            if (code < 200 || code >= 300) throw new HttpFail(code, body);
            return body;
        } finally {
            h.disconnect();
        }
    }

    // ---------- outbox: results waiting to be sent, kept on the phone until they get through ----------
    private static JSONArray readOut(Context c) {
        try { return new JSONArray(sp(c).getString("cloud_outbox", "[]")); } catch (Exception e) { return new JSONArray(); }
    }

    private static void writeOut(Context c, JSONArray q) {
        sp(c).edit().putString("cloud_outbox", q.toString()).apply();
    }

    private static JSONObject firstOut(Context c) {
        synchronized (OUT) { return readOut(c).optJSONObject(0); }
    }

    private static void dropFirst(Context c) {
        synchronized (OUT) {
            JSONArray q = readOut(c);
            JSONArray rest = new JSONArray();
            for (int i = 1; i < q.length(); i++) rest.put(q.opt(i));
            writeOut(c, rest);
        }
    }

    private static void bumpFirst(Context c) {
        synchronized (OUT) {
            try {
                JSONArray q = readOut(c);
                JSONObject f = q.optJSONObject(0);
                if (f == null) return;
                int tries = f.optInt("tries", 0) + 1;
                if (tries >= 5) { dropFirst(c); return; } // a permanent refusal must not block the rest
                f.put("tries", tries);
                writeOut(c, q);
            } catch (Exception ignored) { }
        }
    }

    private static void queue(Context ctx, String job, String kind, String msg) {
        final Context c = ctx.getApplicationContext();
        // A job that came over Wi-Fi is reported to the reader, not to the cloud
        if (job != null && job.startsWith("lan:")) {
            if (!"start".equals(kind)) LanClient.report(c, job.substring(4), "done".equals(kind), msg);
            return;
        }
        synchronized (OUT) {
            try {
                JSONArray q = readOut(c);
                q.put(new JSONObject().put("job", job).put("kind", kind).put("msg", msg == null ? "" : msg).put("tries", 0));
                writeOut(c, q);
            } catch (Exception e) {
                Log.w(TAG, "cloud queue: " + e.getMessage());
            }
        }
        IO.execute(new Runnable() { @Override public void run() { flush(c); } });
    }

      private static void flush(Context c) {
        if (!paired(c)) return;
        for (;;) {
            JSONObject item = firstOut(c);
            if (item == null) return;
            try {
                String kind = item.optString("kind");
                if ("ingest".equals(kind)) {
                    JSONObject a = new JSONObject()
                        .put("p_reader", sp(c).getString("cloud_device_id", ""))
                        .put("p_secret", sp(c).getString("cloud_secret", ""))
                        .put("p_code", item.optString("code"))
                        .put("p_amount", item.optDouble("amount", 0))
                        .put("p_phone", item.optString("phone", ""))
                        .put("p_name", item.optString("name", ""))
                        .put("p_paid_at", item.optString("paid_at"))
                        .put("p_raw", item.optString("raw", ""));
                    rpc("ingest_payment", a);
                } else {
                    JSONObject a = creds(c).put("p_job", item.optString("job"));
                    if ("start".equals(kind)) {
                        rpc("start_dial", a);
                    } else {
                        a.put("p_result", kind);
                        String m = item.optString("msg", "");
                        if (!m.isEmpty()) a.put("p_message", m);
                        rpc("report_job", a);
                    }
                }
                dropFirst(c);
            } catch (HttpFail e) {
                Log.w(TAG, "cloud report refused: " + e.getMessage());
                bumpFirst(c);
                return;
            } catch (Exception e) {
                return; // no network: try again at the next heartbeat
            }
        }
    }

    // ---------- called by the engine while it holds its lock: only queues, never touches the network ----------
    static void onTx(Context c, JSONObject tx) {
        try {
            String job = tx.optString("cloudJobId", "");
            if (job.isEmpty()) return;
            String st = tx.optString("status");
            if ("Processing".equals(st) && !tx.optBoolean("cloudStarted", false)) {
                tx.put("cloudStarted", true);
                queue(c, job, "start", "");
            } else if ("Completed".equals(st) && !tx.optBoolean("cloudReported", false)) {
                tx.put("cloudReported", true);
                queue(c, job, "done", lastText(tx));
            } else if ("Failed".equals(st) && !tx.optBoolean("cloudReported", false) && !tx.optBoolean("hasFallback", false)) {
                tx.put("cloudReported", true); // a failure with a backup offer is reported by the backup
                queue(c, job, "pending".equals(tx.optString("outcome", "")) ? "unclear" : "failed", lastText(tx));
            }
        } catch (Exception ignored) { }
    }

    private static String lastText(JSONObject tx) {
        JSONArray rs = tx.optJSONArray("responses");
        for (int i = (rs == null ? -1 : rs.length() - 1); i >= 0; i--) {
            JSONObject r = rs.optJSONObject(i);
            if (r != null && !r.optString("text", "").isEmpty()) {
                String t = r.optString("text");
                return t.length() > 300 ? t.substring(0, 300) : t;
            }
        }
        return "";
    }
    // ---------- the amounts this phone can sell ----------
    // Called when the app saves its data. Runs on the same single thread as everything else.
    static void syncAmounts(final Context ctx) {
        final Context c = ctx.getApplicationContext();
        if (!paired(c)) return;
        IO.execute(new Runnable() { @Override public void run() { syncAmountsNow(c); } });
    }

    // The offer's category in the server's lowercase form (the app writes DATA, MINUTES, SMS, TUNUKIWA)
    private static String catOf(JSONObject o) {
        String c = o.optString("category", "").toUpperCase(java.util.Locale.ROOT);
        if (c.equals("DATA") || c.equals("MINUTES") || c.equals("SMS") || c.equals("TUNUKIWA")) {
            return c.toLowerCase(java.util.Locale.ROOT);
        }
        String s = (o.optString("name", "") + " " + o.optString("category", "")).toLowerCase(java.util.Locale.ROOT);
        if (s.contains("sms")) return "sms";
        if (s.contains("minutes") || s.matches(".*\\bmins?(\\s|$).*")) return "minutes";
        if (s.contains("tunukiwa")) return "tunukiwa";
        return "data";
    }

    private static void syncAmountsNow(Context c) {
        try {
            if (!paired(c) || "reader".equals(role(c))) return;
            JSONArray offers = EngineStore.snapshot(c).optJSONArray("offers");
            if (offers == null) {
                String m = "cloud sync skipped: the app has not saved its offers to the service yet";
                if (!m.equals(lastNote)) { lastNote = m; EngineCore.note(c, m); }
                return;
            }

            // 1) every offer with its name and category, sent only when something changed
            java.util.TreeMap<Double, JSONObject> byPrice = new java.util.TreeMap<>();
            for (int i = 0; i < offers.length(); i++) {
                JSONObject o = offers.optJSONObject(i);
                if (o == null) continue;
                double price = o.optDouble("price", -1);
                String name = o.optString("name", "").trim();
                if (price <= 0 || name.isEmpty() || byPrice.containsKey(price)) continue;
                byPrice.put(price, new JSONObject().put("amount", price).put("name", name).put("category", catOf(o)));
            }
            JSONArray all = new JSONArray();
            for (JSONObject x : byPrice.values()) all.put(x);
            String offerKey = all.toString();
            if (all.length() > 0 && !offerKey.equals(sp(c).getString("cloud_offers_sent", ""))) {
                try {
                    rpc("device_sync_offers", creds(c).put("p_offers", all));
                    sp(c).edit().putString("cloud_offers_sent", offerKey).apply();
                    EngineCore.note(c, "cloud offers synced: " + all.length());
                } catch (Exception e) {
                    Log.w(TAG, "cloud offers: " + e.getMessage());
                    String m = "cloud offers failed: " + e.getMessage();
                    if (!m.equals(lastNote)) { lastNote = m; EngineCore.note(c, m); }
                }
            }

            // 2) the prices this phone can dial right now (enabled offers only)
            java.util.TreeSet<Double> prices = new java.util.TreeSet<>();
            for (int i = 0; i < offers.length(); i++) {
                JSONObject o = offers.optJSONObject(i);
                if (o != null && o.optBoolean("enabled", false) && o.optDouble("price", -1) > 0) {
                    prices.add(o.optDouble("price"));
                }
            }
            JSONArray list = new JSONArray();
            for (double d : prices) {
                if (d == Math.floor(d)) list.put((long) d); else list.put(d);
            }
            String key = list.toString();
            long now = System.currentTimeMillis();
            if (key.equals(sp(c).getString("cloud_amounts_sent", ""))
                    && now - sp(c).getLong("cloud_amounts_at", 0) < 30 * 60 * 1000L) return;
            rpc("set_device_amounts", creds(c).put("p_amounts", list));
            sp(c).edit().putString("cloud_amounts_sent", key).putLong("cloud_amounts_at", now).apply();
            EngineCore.note(c, "cloud amounts sent: " + key + " (offers=" + offers.length() + ", enabled=" + prices.size() + ")");
        } catch (Exception e) {
            Log.w(TAG, "cloud amounts: " + e.getMessage());
            String m = "cloud amounts failed: " + e.getMessage();
            if (!m.equals(lastNote)) { lastNote = m; EngineCore.note(c, m); }
        }
    }
        // ---------- reader: a payment SMS was saved on this phone ----------
    static void onSms(Context ctx, String body, long time) {
        final Context c = ctx.getApplicationContext();
        if (!paired(c) || !"reader".equals(role(c))) return;
        EngineRules.Mpesa p = EngineRules.parseMpesa(body);
        if (!p.ok || p.code.isEmpty() || p.amount <= 0) return;
        java.text.SimpleDateFormat f = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US);
        f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        synchronized (OUT) {
            try {
                JSONArray q = readOut(c);
                for (int i = 0; i < q.length(); i++) { // already waiting in the outbox
                    JSONObject x = q.optJSONObject(i);
                    if (x != null && "ingest".equals(x.optString("kind")) && p.code.equals(x.optString("code"))) return;
                }
                q.put(new JSONObject().put("kind", "ingest").put("code", p.code).put("amount", p.amount)
                    .put("phone", p.phone).put("name", p.name).put("paid_at", f.format(new java.util.Date(time)))
                    .put("raw", p.raw).put("tries", 0));
                writeOut(c, q);
            } catch (Exception e) {
                Log.w(TAG, "cloud ingest queue: " + e.getMessage());
                return;
            }
        }
        EngineCore.note(c, "reader: payment " + p.code + " queued for the cloud");
        IO.execute(new Runnable() { @Override public void run() { flush(c); } });
    }
    // ---------- heartbeat and jobs ----------
    private static void ensureToken(final Context c) {
        try {
            if (!sp(c).getString("fcm_token", "").isEmpty()) return;
            com.google.firebase.messaging.FirebaseMessaging.getInstance().getToken()
                .addOnSuccessListener(t -> {
                    if (t != null && !t.isEmpty()) sp(c).edit().putString("fcm_token", t).apply();
                });
        } catch (Throwable ignored) { }
    }

        private static String version(Context c) {
        String v = "";
        try {
            v = c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName;
        } catch (Exception e) { }
        String le = lastErr;
        return v + " b7" + (le.isEmpty() ? "" : " | " + le);
    }
   

      private static final java.util.concurrent.atomic.AtomicBoolean beating = new java.util.concurrent.atomic.AtomicBoolean(false);

    static void beat(final Context ctx) {
        final Context c = ctx.getApplicationContext();
        if (!paired(c)) return;
        LanClient.poll(c);
        if (!beating.compareAndSet(false, true)) return;
        IO.execute(new Runnable() {
            @Override public void run() {
                try {
                    try {
                        ensureToken(c);
                        JSONObject a = creds(c);
                        a.put("p_accessibility", UssdAccessibilityService.instance != null);
                        String t = sp(c).getString("fcm_token", "");
                        if (!t.isEmpty()) a.put("p_fcm", t);
                        String v = version(c);
                        if (!v.isEmpty()) a.put("p_version", v);
                        JSONArray jobs = new JSONObject(rpc("heartbeat", a)).optJSONArray("jobs");
                        if (jobs != null && jobs.length() > 0) {
                            String m = "heartbeat: " + jobs.length() + " job(s) waiting";
                            if (!m.equals(lastNote)) { lastNote = m; EngineCore.note(c, m); }
                        }
                        for (int i = 0; jobs != null && i < jobs.length(); i++) {
                            takeJob(c, jobs.getJSONObject(i).optString("job_id"));
                        }
                    } catch (Exception e) {
                        Log.w(TAG, "cloud heartbeat: " + e.getMessage());
                        trace(c, "heartbeat failed: " + e.getMessage());
                    }
                    syncAmountsNow(c);
                    flush(c);
                } finally {
                    beating.set(false);
                }
            }
        });
    }
    private static java.util.concurrent.ScheduledExecutorService loop = null;

    // Beats every 2 seconds from inside the app, whatever else is or is not running
    static synchronized void startLoop(final Context ctx) {
        if (loop != null) return;
        final Context c = ctx.getApplicationContext();
        loop = java.util.concurrent.Executors.newSingleThreadScheduledExecutor();
        loop.scheduleWithFixedDelay(new Runnable() {
            @Override public void run() {
                try { beat(c); } catch (Throwable t) { Log.w(TAG, "beat loop: " + t.getMessage()); }
            }
        }, 1, 2, java.util.concurrent.TimeUnit.SECONDS);
    }
      // A push arrived with a job id
    static void handleJob(Context ctx, final String jobId) {
        final Context c = ctx.getApplicationContext();
        if (!paired(c)) return;
        IO.execute(new Runnable() { @Override public void run() { takeJob(c, jobId); } });
    }

    private static final java.util.HashMap<String, Long> traced = new java.util.HashMap<>();

    // Writes a note to the in-app log AND to the cloud. Same note: at most once a minute.
    private static void trace(Context c, String m) {
        long now = System.currentTimeMillis();
        synchronized (traced) {
            Long t = traced.get(m);
            if (t != null && now - t < 60_000) return;
            if (traced.size() > 50) traced.clear();
            traced.put(m, now);
        }
        EngineCore.note(c, m);
        try { rpc("device_note", creds(c).put("p_note", m)); } catch (Exception ignored) { }
    }

    private static void takeJob(Context c, String jobId) {
        try {
            if (jobId == null || jobId.isEmpty()) return;
            lastErr = "takeJob saw " + jobId.substring(0, 8);
            if (EngineCore.hasCloudJob(c, jobId)) {
                lastErr = "hasCloudJob=true for " + jobId.substring(0, 8);
                return;
            }
            String body = rpc("claim_job", creds(c).put("p_job", jobId)).trim();
            if (body.isEmpty() || "null".equals(body)) {
                lastErr = "claim returned nothing";
                return;
            }
            JSONObject p = new JSONObject(body);
            String id = p.optString("job_id", "");
            if (id.isEmpty()) return;

            String why = EngineCore.cloudBlocker(c);
            if (why != null) {
                lastErr = "not taken: " + why;
                queue(c, id, "rejected", why);
                return;
            }
            String[] problem = EngineCore.ingestCloud(c, id, p.optString("transaction_code"),
                p.optDouble("amount", 0), p.optString("customer_phone"));
            if (problem != null) {
                lastErr = "ingestCloud: " + problem[0] + " - " + problem[1];
                queue(c, id, problem[0], problem[1]);
            } else {
                lastErr = "accepted " + id.substring(0, 8);
            }
        } catch (Exception e) {
            String s = "takeJob error: " + e.getMessage();
            lastErr = s.length() > 150 ? s.substring(0, 150) : s;
        }
    }
}