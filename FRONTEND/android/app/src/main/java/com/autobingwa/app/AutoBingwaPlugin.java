package com.autobingwa.app;

import android.Manifest;
import android.content.ContentProviderOperation;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.util.ArrayList;
import org.json.JSONException;

@CapacitorPlugin(
    name = "AutoBingwa",
    permissions = {
        @Permission(strings = { Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS }, alias = "sms"),
        @Permission(strings = { Manifest.permission.CALL_PHONE, Manifest.permission.READ_PHONE_STATE }, alias = "phone"),
        @Permission(strings = { Manifest.permission.READ_CONTACTS, Manifest.permission.WRITE_CONTACTS }, alias = "contacts")
    }
)
public class AutoBingwaPlugin extends Plugin {
    private static AutoBingwaPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    // Called by the SMS receiver when a new message has been saved
    static void poke() {
        AutoBingwaPlugin p = instance;
        if (p != null) p.notifyListeners("smsStored", new JSObject());
    }

    @PluginMethod
    public void peekSms(PluginCall call) {
        JSObject out = new JSObject();
        try {
            out.put("items", new JSArray(SmsStore.peek(getContext()).toString()));
        } catch (JSONException e) {
            out.put("items", new JSArray());
        }
        call.resolve(out);
    }

    @PluginMethod
    public void ackSms(PluginCall call) {
        JSArray ids = call.getArray("ids");
        if (ids != null) SmsStore.ack(getContext(), ids);
        call.resolve();
    }

    private boolean contactExists(String phone) {
        Uri uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(phone));
        Cursor c = null;
        try {
            c = getContext().getContentResolver().query(
                uri, new String[] { ContactsContract.PhoneLookup._ID }, null, null, null);
            return c != null && c.moveToFirst();
        } finally {
            if (c != null) c.close();
        }
    }

    // Saves a customer to the phone's contacts. A number that is already saved is left alone.
    @PluginMethod
    public void saveContact(PluginCall call) {
        String name = call.getString("name", "");
        String phone = call.getString("phone", "");
        if (name == null || name.trim().isEmpty() || phone == null || phone.trim().isEmpty()) {
            call.reject("Name and phone are required");
            return;
        }
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            call.reject("Contacts permission not granted");
            return;
        }
        try {
            JSObject out = new JSObject();
            if (contactExists(phone)) {
                out.put("saved", false);
                out.put("reason", "exists");
                call.resolve(out);
                return;
            }
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
            getContext().getContentResolver().applyBatch(ContactsContract.AUTHORITY, ops);
            out.put("saved", true);
            call.resolve(out);
        } catch (Exception e) {
            call.reject("Could not save contact: " + e.getMessage());
        }
    }
}