package com.autobingwa.app;

import android.Manifest;
import android.content.ContentProviderOperation;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;
import androidx.core.content.ContextCompat;
import java.util.ArrayList;

// Saves a customer to the phone's contacts. It needs no web view, so it also works while the app is closed.
final class ContactSaver {
    private ContactSaver() {}

    private static boolean exists(Context c, String phone) {
        Uri uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(phone));
        Cursor cur = null;
        try {
            cur = c.getContentResolver().query(uri, new String[] { ContactsContract.PhoneLookup._ID }, null, null, null);
            return cur != null && cur.moveToFirst();
        } finally {
            if (cur != null) cur.close();
        }
    }

    // Returns "saved", "exists", or the reason it could not be saved
    static String save(Context c, String name, String phone) {
        try {
            if (ContextCompat.checkSelfPermission(c, Manifest.permission.WRITE_CONTACTS) != PackageManager.PERMISSION_GRANTED
                    || ContextCompat.checkSelfPermission(c, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
                return "contacts permission not granted";
            }
            if (exists(c, phone)) return "exists";
            ArrayList<ContentProviderOperation> ops = new ArrayList<>();
            ops.add(ContentProviderOperation.newInsert(ContactsContract.RawContacts.CONTENT_URI)
                .withValue(ContactsContract.RawContacts.ACCOUNT_TYPE, null)
                .withValue(ContactsContract.RawContacts.ACCOUNT_NAME, null)
                .build());
            ops.add(ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI)
                .withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID, 0)
                .withValue(ContactsContract.Data.MIMETYPE,
                    ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE)
                .withValue(ContactsContract.CommonDataKinds.StructuredName.DISPLAY_NAME, name.trim())
                .build());
            ops.add(ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI)
                .withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID, 0)
                .withValue(ContactsContract.Data.MIMETYPE,
                    ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE)
                .withValue(ContactsContract.CommonDataKinds.Phone.NUMBER, phone.trim())
                .withValue(ContactsContract.CommonDataKinds.Phone.TYPE,
                    ContactsContract.CommonDataKinds.Phone.TYPE_MOBILE)
                .build());
            c.getContentResolver().applyBatch(ContactsContract.AUTHORITY, ops);
            return "saved";
        } catch (Exception e) {
            return "could not save: " + e.getMessage();
        }
    }
}