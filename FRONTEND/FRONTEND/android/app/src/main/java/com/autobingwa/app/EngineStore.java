public class EngineStore {
    
}
package com.autobingwa.app;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

// The service's own copy of what the app knows: offers, settings, blacklist, tokens, fallback plans.
final class EngineStore {
    private static final String FILE = "autobingwa_engine";
    private static final String KEY = "snapshot";
    private static final String KEY_AT = "syncedAt";
    private static final Object LOCK = new Object();

    private EngineStore() {}

    // Saves the app's copy. Throws if it is not valid, so a broken copy never replaces a good one.
    static void save(Context ctx, String json) throws Exception {
        JSONObject check = new JSONObject(json);
        if (!(check.opt("offers") instanceof JSONArray)) throw new Exception("the copy has no offers list");
        synchronized (LOCK) {
            ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
                .putString(KEY, json)
                .putLong(KEY_AT, System.currentTimeMillis())
                .commit();
        }
    }

    static JSONObject snapshot(Context ctx) {
        synchronized (LOCK) {
            try {
                SharedPreferences sp = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE);
                return new JSONObject(sp.getString(KEY, "{}"));
            } catch (Exception e) {
                return new JSONObject();
            }
        }
    }

    // A short summary of the copy, for the status line in Settings
    static JSONObject status(Context ctx) throws Exception {
        SharedPreferences sp = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE);
        JSONObject snap = snapshot(ctx);
        JSONObject out = new JSONObject();

        JSONArray offers = snap.optJSONArray("offers");
        int total = offers == null ? 0 : offers.length();
        int on = 0;
        for (int i = 0; i < total; i++) {
            JSONObject o = offers.optJSONObject(i);
            if (o != null && o.optBoolean("enabled", false)) on++;
        }

        JSONObject wallet = snap.optJSONObject("wallet");
        long units = wallet == null ? 0 : wallet.optLong("units", 0);
        long until = wallet == null ? 0 : wallet.optLong("unlimitedUntil", 0);

        JSONArray black = snap.optJSONArray("blacklist");
        JSONObject fb = snap.optJSONObject("fallback");
        JSONArray maps = fb == null ? null : fb.optJSONArray("mappings");
        JSONObject cfg = snap.optJSONObject("config");

        out.put("synced", sp.contains(KEY));
        out.put("syncedAt", sp.getLong(KEY_AT, 0));
        out.put("offers", total);
        out.put("offersEnabled", on);
        out.put("units", units);
        out.put("unlimitedUntil", until);
        out.put("blacklist", black == null ? 0 : black.length());
        out.put("fallbackMappings", maps == null ? 0 : maps.length());
        out.put("mode", cfg == null ? "" : cfg.optString("mode", ""));
        return out;
    }
}