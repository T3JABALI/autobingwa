package com.autobingwa.app;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

// Jobs that arrived by push and have not been handled yet
final class PushJobs {
    private static final String KEY = "push_jobs";
    private static final int MAX = 200;

    private PushJobs() { }

    private static SharedPreferences sp(Context c) {
        return c.getSharedPreferences("autobingwa_prefs", Context.MODE_PRIVATE);
    }

    static synchronized void add(Context c, String jobId, String code, String amount, String phone) {
        try {
            JSONArray cur = new JSONArray(sp(c).getString(KEY, "[]"));
            for (int i = 0; i < cur.length(); i++) {
                if (jobId.equals(cur.getJSONObject(i).optString("job_id"))) return; // already queued
            }
            JSONObject o = new JSONObject();
            o.put("job_id", jobId);
            o.put("transaction_code", code == null ? "" : code);
            o.put("amount", amount == null ? "" : amount);
            o.put("customer_phone", phone == null ? "" : phone);
            o.put("received_at", System.currentTimeMillis());
            cur.put(o);

            JSONArray out = cur;
            if (cur.length() > MAX) {
                out = new JSONArray();
                for (int i = cur.length() - MAX; i < cur.length(); i++) out.put(cur.get(i));
            }
            sp(c).edit().putString(KEY, out.toString()).apply();
        } catch (Exception ignored) { }
    }

    static synchronized JSONArray peek(Context c) {
        try {
            return new JSONArray(sp(c).getString(KEY, "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    static synchronized void ack(Context c, JSONArray ids) {
        try {
            JSONArray cur = new JSONArray(sp(c).getString(KEY, "[]"));
            JSONArray keep = new JSONArray();
            for (int i = 0; i < cur.length(); i++) {
                JSONObject o = cur.getJSONObject(i);
                boolean gone = false;
                for (int k = 0; k < ids.length(); k++) {
                    if (o.optString("job_id").equals(ids.optString(k))) { gone = true; break; }
                }
                if (!gone) keep.put(o);
            }
            sp(c).edit().putString(KEY, keep.toString()).apply();
        } catch (Exception ignored) { }
    }
}