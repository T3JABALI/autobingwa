package com.autobingwa.app;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class SmsStore {
    private static final String FILE = "autobingwa_sms";
    private static final String KEY = "queue";
    private static final String SEEN = "seen";
    private static final int SEEN_MAX = 1000;
    private static final Object LOCK = new Object();
    private static final Pattern PAYMENT =
        Pattern.compile("^\\s*([A-Z0-9]{10})\\s+Confirmed", Pattern.CASE_INSENSITIVE);

    private SmsStore() {}

    // The M-Pesa code at the start of a payment message, or null
    static String codeOf(String body) {
        if (body == null) return null;
        Matcher m = PAYMENT.matcher(body);
        return m.find() ? m.group(1).toUpperCase(java.util.Locale.ROOT) : null;
    }

    private static boolean contains(JSONArray arr, String value) throws JSONException {
        for (int i = 0; i < arr.length(); i++) {
            if (value.equals(arr.getString(i))) return true;
        }
        return false;
    }

    // True when a payment with this M-Pesa code was already saved
    static boolean seen(Context ctx, String code) {
        synchronized (LOCK) {
            try {
                SharedPreferences sp = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE);
                return contains(new JSONArray(sp.getString(SEEN, "[]")), code);
            } catch (JSONException e) {
                return false;
            }
        }
    }

    static void add(Context ctx, String sender, String body, long time) {
        synchronized (LOCK) {
            try {
                SharedPreferences sp = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE);
                SharedPreferences.Editor ed = sp.edit();

                String code = codeOf(body);
                if (code != null) {
                    JSONArray seen = new JSONArray(sp.getString(SEEN, "[]"));
                    if (contains(seen, code)) return; // this payment is already saved
                    seen.put(code);
                    if (seen.length() > SEEN_MAX) {
                        JSONArray trimmed = new JSONArray();
                        for (int i = seen.length() - SEEN_MAX; i < seen.length(); i++) trimmed.put(seen.get(i));
                        seen = trimmed;
                    }
                    ed.putString(SEEN, seen.toString());
                }

                JSONArray arr = new JSONArray(sp.getString(KEY, "[]"));
                JSONObject o = new JSONObject();
                o.put("id", sender + "|" + time + "|" + Integer.toHexString(body.hashCode()));
                o.put("sender", sender);
                o.put("body", body);
                o.put("time", time);
                arr.put(o);
                ed.putString(KEY, arr.toString());
                ed.commit(); // the message and its "seen" mark are saved together
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