package com.autobingwa.app;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class SmsStore {
    private static final String FILE = "autobingwa_sms";
    private static final String KEY = "queue";
    private static final Object LOCK = new Object();

    private SmsStore() {}

    static void add(Context ctx, String sender, String body, long time) {
        synchronized (LOCK) {
            try {
                SharedPreferences sp = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE);
                JSONArray arr = new JSONArray(sp.getString(KEY, "[]"));
                JSONObject o = new JSONObject();
                o.put("id", sender + "|" + time + "|" + Integer.toHexString(body.hashCode()));
                o.put("sender", sender);
                o.put("body", body);
                o.put("time", time);
                arr.put(o);
                sp.edit().putString(KEY, arr.toString()).commit();
            } catch (JSONException e) {
                // nothing to do
            }
        }
    }

    static JSONArray peek(Context ctx) {
        synchronized (LOCK) {
            try {
                SharedPreferences sp = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE);
                return new JSONArray(sp.getString(KEY, "[]"));
            } catch (JSONException e) {
                return new JSONArray();
            }
        }
    }

    static void ack(Context ctx, JSONArray ids) {
        synchronized (LOCK) {
            try {
                SharedPreferences sp = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE);
                JSONArray arr = new JSONArray(sp.getString(KEY, "[]"));
                JSONArray keep = new JSONArray();
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject o = arr.getJSONObject(i);
                    boolean done = false;
                    for (int j = 0; j < ids.length(); j++) {
                        if (o.getString("id").equals(ids.getString(j))) {
                            done = true;
                            break;
                        }
                    }
                    if (!done) keep.put(o);
                }
                sp.edit().putString(KEY, keep.toString()).commit();
            } catch (JSONException e) {
                // nothing to do
            }
        }
    }
}