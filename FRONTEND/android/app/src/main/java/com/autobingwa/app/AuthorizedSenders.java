package com.autobingwa.app;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;

/** The numbers saved on Settings > Authorized senders. An empty list means the feature does nothing. */
final class AuthorizedSenders {
    private AuthorizedSenders() {}

    private static String last9(String s) {
        String d = s == null ? "" : s.replaceAll("\\D", "");
        return d.length() > 9 ? d.substring(d.length() - 9) : d;
    }

    private static JSONArray list(Context c) {
        try {
            JSONArray a = EngineStore.snapshot(c).optJSONArray("senders");
            return a == null ? new JSONArray() : a;
        } catch (Throwable e) {
            return new JSONArray();
        }
    }

    /** True when at least one valid number has been added. */
    static boolean any(Context c) {
        JSONArray a = list(c);
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o != null && last9(o.optString("number")).length() == 9) return true;
        }
        return false;
    }

    /** True when this sender address is one of the saved numbers (compared by the last 9 digits). */
    static boolean has(Context c, String address) {
        String k = last9(address);
        if (k.length() != 9) return false; // "MPESA" and other names have no digits
        JSONArray a = list(c);
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o != null && k.equals(last9(o.optString("number")))) return true;
        }
        return false;
    }
}