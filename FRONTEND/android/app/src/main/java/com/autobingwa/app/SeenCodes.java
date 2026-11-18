package com.autobingwa.app;

import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.util.Log;
import org.json.JSONArray;

// Remembers every M-Pesa payment code the phone has seen, so one payment can never become two transactions.
// It is a database, not a list: checking a code is instant and saving one writes a single row, however many there are.
final class SeenCodes extends SQLiteOpenHelper {
    private static final String NAME = "autobingwa_seen.db";
    // Codes older than this many days are forgotten. Set to 0 to remember them forever.
    private static final long KEEP_DAYS = 400;
    private static SeenCodes instance;
    private static boolean migrated = false;
    private static long lastPrune = 0;

    private SeenCodes(Context c) {
        super(c.getApplicationContext(), NAME, null, 1);
    }

    private static synchronized SeenCodes get(Context c) {
        if (instance == null) instance = new SeenCodes(c);
        return instance;
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE seen (code TEXT PRIMARY KEY, t INTEGER NOT NULL)");
        db.execSQL("CREATE INDEX seen_t ON seen (t)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { }

    // One-time: moves the old list (up to 1000 codes) from SharedPreferences into the database
    private static synchronized void migrate(Context c, SQLiteDatabase db) {
        if (migrated) return;
        migrated = true;
        try {
            SharedPreferences sp = c.getApplicationContext().getSharedPreferences("autobingwa_sms", Context.MODE_PRIVATE);
            String old = sp.getString("seen", null);
            if (old == null) return;
            JSONArray arr = new JSONArray(old);
            long now = System.currentTimeMillis();
            db.beginTransaction();
            try {
                for (int i = 0; i < arr.length(); i++) {
                    ContentValues v = new ContentValues();
                    v.put("code", arr.getString(i));
                    v.put("t", now);
                    db.insertWithOnConflict("seen", null, v, SQLiteDatabase.CONFLICT_IGNORE);
                }
                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }
            sp.edit().remove("seen").commit();
        } catch (Exception e) {
            Log.e("AutoBingwa", "seen codes migrate", e);
        }
    }

    // Forgets codes older than KEEP_DAYS (checked at most every 6 hours)
    private static void prune(SQLiteDatabase db) {
        if (KEEP_DAYS <= 0) return;
        long now = System.currentTimeMillis();
        if (now - lastPrune < 6L * 3600000L) return;
        lastPrune = now;
        db.delete("seen", "t < ?", new String[] { String.valueOf(now - KEEP_DAYS * 86400000L) });
    }

    // True when the code is new (and is now remembered). False when it was already there.
    static boolean markNew(Context c, String code) {
        try {
            SQLiteDatabase db = get(c).getWritableDatabase();
            migrate(c, db);
            prune(db);
            ContentValues v = new ContentValues();
            v.put("code", code);
            v.put("t", System.currentTimeMillis());
            return db.insertWithOnConflict("seen", null, v, SQLiteDatabase.CONFLICT_IGNORE) != -1;
        } catch (Exception e) {
            Log.e("AutoBingwa", "seen codes", e);
            return true; // if the database fails, a payment is never blocked
        }
    }

    static boolean has(Context c, String code) {
        try {
            SQLiteDatabase db = get(c).getWritableDatabase();
            migrate(c, db);
            Cursor cur = db.rawQuery("SELECT 1 FROM seen WHERE code = ? LIMIT 1", new String[] { code });
            try {
                return cur.moveToFirst();
            } finally {
                cur.close();
            }
        } catch (Exception e) {
            Log.e("AutoBingwa", "seen codes", e);
            return false;
        }
    }

    // Undo: used when the message could not be saved, so the payment is not lost
    static void forget(Context c, String code) {
        try {
            get(c).getWritableDatabase().delete("seen", "code = ?", new String[] { code });
        } catch (Exception e) {
            Log.e("AutoBingwa", "seen codes", e);
        }
    }
}