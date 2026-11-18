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

    // True when a payment with this M-Pesa code was already saved
    static boolean seen(Context ctx, String code) {
        return SeenCodes.has(ctx, code);
    }

    static void add(Context ctx, String sender, String body, long time) {
        String savedId = null;
        synchronized (LOCK) {
            String code = codeOf(body);
            boolean marked = false;
            try {
                if (code != null) {
                    if (!SeenCodes.markNew(ctx, code)) return; // this payment is already saved
                    marked = true;
                }

                SharedPreferences sp = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE);
                JSONArray arr = new JSONArray(sp.getString(KEY, "[]"));
                JSONObject o = new JSONObject();
                String id = sender + "|" + time + "|" + Integer.toHexString(body.hashCode());
                o.put("id", id);
                o.put("sender", sender);
                o.put("body", body);
                o.put("time", time);
                arr.put(o);
                if (sp.edit().putString(KEY, arr.toString()).commit()) {
                    savedId = id;
                } else if (marked) {
                    SeenCodes.forget(ctx, code); // not saved, so do not remember it as handled
                }
            } catch (JSONException e) {
                if (marked) SeenCodes.forget(ctx, code);
            }
        }
        // Outside the lock. Does nothing unless the native engine is switched on, and can never break saving.
        if (savedId != null) {
            try {
                EngineCore.onSms(ctx, savedId, sender, body, time);
            } catch (Throwable t) {
                android.util.Log.e("AutoBingwa", "native hook", t);
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