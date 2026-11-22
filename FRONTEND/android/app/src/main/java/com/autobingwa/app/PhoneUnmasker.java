package com.autobingwa.app;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.provider.ContactsContract;
import android.util.AtomicFile;
import android.util.Log;
import androidx.core.content.ContextCompat;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Locale;
import org.json.JSONArray;

// Finds the real number behind a hidden one such as 0714***999.
// A person counts only if the visible digits fit AND the name matches. Two different matches means no answer.
final class PhoneUnmasker {
    private static final String TAG = "AutoBingwa";

    static final class Result {
        String phone = "";
        String name = "";
        String reason = "";
    }

    private PhoneUnmasker() {}

    private static File knownFile(Context c) {
        return new File(c.getFilesDir(), "autobingwa_known.json");
    }

    // The app sends the customers it knows (saved contacts and people who bought before)
    static void saveKnown(Context c, String json) throws Exception {
        AtomicFile af = new AtomicFile(knownFile(c));
        FileOutputStream out = af.startWrite();
        try {
            out.write(json.getBytes(StandardCharsets.UTF_8));
            af.finishWrite(out);
        } catch (Exception e) {
            af.failWrite(out);
            throw e;
        }
    }

    private static void addKnown(Context c, ArrayList<String[]> into) {
        try {
            AtomicFile af = new AtomicFile(knownFile(c));
            if (!af.getBaseFile().exists()) return;
            JSONArray a = new JSONArray(new String(af.readFully(), StandardCharsets.UTF_8));
            for (int i = 0; i < a.length(); i++) {
                JSONArray r = a.optJSONArray(i);
                if (r != null) into.add(new String[] { r.optString(0), r.optString(1) });
            }
        } catch (Exception e) {
            Log.e(TAG, "known customers read", e);
        }
    }

    private static void addPhonebook(Context c, ArrayList<String[]> into) {
        if (ContextCompat.checkSelfPermission(c, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return;
        Cursor cur = null;
        try {
            cur = c.getContentResolver().query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                new String[] {
                    ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                    ContactsContract.CommonDataKinds.Phone.NUMBER },
                null, null, null);
            while (cur != null && cur.moveToNext()) {
                into.add(new String[] { cur.getString(0), cur.getString(1) });
            }
        } catch (Exception e) {
            Log.e(TAG, "phonebook read", e);
        } finally {
            if (cur != null) cur.close();
        }
    }

    private static HashSet<String> tokens(String text, HashSet<String> drop) {
        HashSet<String> out = new HashSet<>();
        String t = (text == null ? "" : text).toLowerCase(Locale.ROOT).replaceAll("[^a-z\\s]", " ");
        for (String w : t.split("\\s+")) {
            if (w.length() >= 2 && !drop.contains(w)) out.add(w);
        }
        return out;
    }

    private static boolean digitsFit(String masked, String phone) {
        if (masked.length() != phone.length()) return false;
        for (int i = 0; i < masked.length(); i++) {
            char m = masked.charAt(i);
            if (m != '*' && m != phone.charAt(i)) return false;
        }
        return true;
    }

    static Result resolve(Context c, String masked, String smsName, String suffix) {
        Result r = new Result();
        HashSet<String> none = new HashSet<>();
        HashSet<String> drop = tokens(suffix, none);
        HashSet<String> want = tokens(smsName, none);
        if (masked == null || masked.isEmpty()) { r.reason = "no hidden number was read"; return r; }
        if (want.isEmpty()) { r.reason = "the message has no name to match"; return r; }

        ArrayList<String[]> all = new ArrayList<>();
        addKnown(c, all);
        addPhonebook(c, all);

        LinkedHashMap<String, String> hits = new LinkedHashMap<>(); // real number -> saved name
        for (String[] row : all) {
            EngineRules.Phone n = EngineRules.normalizePhone(row[1]);
            if (n == null || n.masked || !digitsFit(masked, n.phone)) continue;
            HashSet<String> have = tokens(row[0], drop);
            if (have.isEmpty()) continue;
            int shared = 0;
            for (String w : have) if (want.contains(w)) shared++;
            int need = Math.min(2, Math.min(have.size(), want.size()));
            if (shared >= need && shared > 0 && !hits.containsKey(n.phone)) hits.put(n.phone, row[0]);
        }
        if (hits.size() == 1) {
            String phone = hits.keySet().iterator().next();
            r.phone = phone;
            r.name = hits.get(phone);
            return r;
        }
        r.reason = hits.isEmpty()
            ? "no saved contact fits the digits and the name"
            : hits.size() + " different contacts fit, so it was not guessed";
        return r;
    }
}