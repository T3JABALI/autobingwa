package com.autobingwa.app;

import android.Manifest;
import android.content.ContentProviderOperation;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.ContactsContract;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.telephony.TelephonyManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
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

    // ---------- Contacts ----------
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

    // ---------- SIMs and USSD ----------
    // Lists the SIMs in the phone. slot 0 is SIM 1, slot 1 is SIM 2.
    @PluginMethod
    public void getSims(PluginCall call) {
        if (getPermissionState("phone") != PermissionState.GRANTED) {
            call.reject("Phone permission not granted");
            return;
        }
        try {
            SubscriptionManager sm = getContext().getSystemService(SubscriptionManager.class);
            List<SubscriptionInfo> list = sm.getActiveSubscriptionInfoList();
            JSArray arr = new JSArray();
            if (list != null) {
                for (SubscriptionInfo info : list) {
                    JSObject o = new JSObject();
                    o.put("slot", info.getSimSlotIndex());
                    o.put("subId", info.getSubscriptionId());
                    CharSequence carrier = info.getCarrierName();
                    o.put("carrier", carrier == null ? "" : carrier.toString());
                    arr.put(o);
                }
            }
            JSObject out = new JSObject();
            out.put("sims", arr);
            call.resolve(out);
        } catch (SecurityException e) {
            call.reject("Could not read SIMs: " + e.getMessage());
        }
    }

    // Runs a USSD code on one SIM without opening the dialer, and returns the reply text.
    @PluginMethod
    public void runUssd(final PluginCall call) {
        final String code = call.getString("code", "");
        final Integer slotArg = call.getInt("slot", 0);
        final int slot = slotArg == null ? 0 : slotArg;
        if (code == null || code.trim().isEmpty()) {
            call.reject("No USSD code given");
            return;
        }
        if (getPermissionState("phone") != PermissionState.GRANTED) {
            call.reject("Phone permission not granted");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.reject("This Android version cannot run USSD silently");
            return;
        }
        try {
            SubscriptionManager sm = getContext().getSystemService(SubscriptionManager.class);
            SubscriptionInfo info = sm.getActiveSubscriptionInfoForSimSlotIndex(slot);
            if (info == null) {
                call.reject("No SIM found in slot " + (slot + 1));
                return;
            }
            TelephonyManager base = (TelephonyManager) getContext().getSystemService(android.content.Context.TELEPHONY_SERVICE);
            TelephonyManager tm = base.createForSubscriptionId(info.getSubscriptionId());

            final AtomicBoolean done = new AtomicBoolean(false);
            final Handler handler = new Handler(Looper.getMainLooper());
            handler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (done.compareAndSet(false, true)) call.reject("The USSD request timed out");
                }
            }, 40000);

            tm.sendUssdRequest(code.trim(), new TelephonyManager.UssdResponseCallback() {
                @Override
                public void onReceiveUssdResponse(TelephonyManager t, String request, CharSequence response) {
                    if (!done.compareAndSet(false, true)) return;
                    JSObject out = new JSObject();
                    out.put("ok", true);
                    out.put("text", response == null ? "" : response.toString());
                    call.resolve(out);
                }

                @Override
                public void onReceiveUssdResponseFailed(TelephonyManager t, String request, int failureCode) {
                    if (!done.compareAndSet(false, true)) return;
                    call.reject("USSD failed, code " + failureCode);
                }
            }, handler);
        } catch (SecurityException e) {
            call.reject("Not allowed to run USSD: " + e.getMessage());
        } catch (Exception e) {
            call.reject("USSD error: " + e.getMessage());
        }
    }
}