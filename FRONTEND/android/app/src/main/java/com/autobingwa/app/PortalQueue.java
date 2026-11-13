package com.autobingwa.app;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

final class PortalQueue {
    private static final String KEY = "portal_cmds";
    private PortalQueue() {}

    private static SharedPreferences sp(Context c) {
        return c.getSharedPreferences("autobingwa_prefs", Context.MODE_PRIVATE);
    }

    // All commands waiting to be run
    static synchronized JSONArray peek(Context c) {
        try { return new JSONArray(sp(c).getString(KEY, "[]")); }
        catch (Exception e) { return new JSONArray(); }
    }

    // Adds new commands, skipping any id that is already queued. Returns true if something was added.
    static synchronized boolean add(Context c, JSONArray incoming) {
        boolean added = false;
        try {
            JSONArray cur = peek(c);
            for (int i = 0; i < incoming.length(); i++) {
                JSONObject o = incoming.optJSONObject(i);
                if (o == null) continue;
                String id = String.valueOf(o.opt("id"));
                boolean dup = false;
                for (int j = 0; j < cur.length(); j++) {
                    if (String.valueOf(cur.getJSONObject(j).opt("id")).equals(id)) { dup = true; break; }
                }
                if (!dup) { cur.put(o); added = true; }
            }
            sp(c).edit().putString(KEY, cur.toString()).apply();
        } catch (Exception ignored) { }
        return added;
    }

    // Removes commands whose ids JS has confirmed
    static synchronized void ack(Context c, JSONArray ids) {
        try {
            JSONArray cur = peek(c), keep = new JSONArray();
            for (int i = 0; i < cur.length(); i++) {
                JSONObject o = cur.getJSONObject(i);
                boolean gone = false;
                for (int j = 0; j < ids.length(); j++) {
                    if (String.valueOf(o.opt("id")).equals(String.valueOf(ids.get(j)))) { gone = true; break; }
                }
                if (!gone) keep.put(o);
            }
            sp(c).edit().putString(KEY, keep.toString()).apply();
        } catch (Exception ignored) { }
    }
}