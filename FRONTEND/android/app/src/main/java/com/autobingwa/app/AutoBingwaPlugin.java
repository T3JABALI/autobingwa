package com.autobingwa.app;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import android.Manifest;
import android.content.ContentProviderOperation;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.ContactsContract;
import android.provider.Settings;
import android.telephony.SmsManager;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.telephony.TelephonyManager;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONException;
import org.json.JSONArray;
import org.json.JSONObject;
@CapacitorPlugin(
    name = "AutoBingwa",
    permissions = {
        @Permission(strings = { Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS, Manifest.permission.SEND_SMS }, alias = "sms"),
        @Permission(strings = { Manifest.permission.CALL_PHONE, Manifest.permission.READ_PHONE_STATE }, alias = "phone"),
        @Permission(strings = { Manifest.permission.READ_CONTACTS, Manifest.permission.WRITE_CONTACTS }, alias = "contacts"),
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
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
    // ---------- App updates ----------
    // Downloads the APK into the app's cache and checks its SHA-256 before it can be installed
    @PluginMethod
    public void downloadApk(final PluginCall call) {
        final String url = call.getString("url", "");
        final String sha = call.getString("sha256", "") == null ? "" : call.getString("sha256", "").toLowerCase();
        if (url == null || !url.startsWith("https://")) {
            call.reject("The update link must use https");
            return;
        }
        if (!sha.matches("[0-9a-f]{64}")) {
            call.reject("The update has no valid checksum");
            return;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection conn = null;
                InputStream in = null;
                FileOutputStream fos = null;
                File out = null;
                try {
                    File dir = new File(getContext().getCacheDir(), "updates");
                    if (!dir.exists()) dir.mkdirs();
                    File[] old = dir.listFiles();
                    if (old != null) for (File f : old) f.delete();
                    out = new File(dir, "update.apk");

                    conn = (HttpURLConnection) new URL(url).openConnection();
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(30000);
                    int code = conn.getResponseCode();
                    if (code != 200) throw new Exception("The server answered " + code);
                    long total = conn.getContentLengthLong();

                    MessageDigest md = MessageDigest.getInstance("SHA-256");
                    in = conn.getInputStream();
                    fos = new FileOutputStream(out);
                    byte[] buf = new byte[32768];
                    long done = 0;
                    int last = -1;
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        fos.write(buf, 0, n);
                        md.update(buf, 0, n);
                        done += n;
                        if (total > 0) {
                            int pct = (int) (done * 100 / total);
                            if (pct != last) {
                                last = pct;
                                JSObject p = new JSObject();
                                p.put("percent", pct);
                                notifyListeners("updateProgress", p);
                            }
                        }
                    }
                    fos.close();
                    fos = null;

                    StringBuilder hex = new StringBuilder();
                    for (byte b : md.digest()) hex.append(String.format("%02x", b));
                    if (!hex.toString().equals(sha)) {
                        out.delete();
                        throw new Exception("The download does not match its checksum, so it was discarded");
                    }
                    call.resolve();
                } catch (Exception e) {
                    if (out != null) out.delete();
                    call.reject("Download failed: " + e.getMessage());
                } finally {
                    try { if (fos != null) fos.close(); } catch (Exception ignored) { }
                    try { if (in != null) in.close(); } catch (Exception ignored) { }
                    if (conn != null) conn.disconnect();
                }
            }
        }).start();
    }

    // Opens the Android installer for the downloaded APK
    @PluginMethod
    public void installApk(PluginCall call) {
        try {
            File apk = new File(new File(getContext().getCacheDir(), "updates"), "update.apk");
            if (!apk.exists()) {
                call.reject("Download the update first");
                return;
            }
            if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
                Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
                s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(s);
                call.reject("needs_permission");
                return;
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not start the installer: " + e.getMessage());
        }
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
    // Every phone contact that has a number: [{ name, phone }]
    @PluginMethod
    public void listContacts(final PluginCall call) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            call.reject("Contacts permission not granted");
            return;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                Cursor c = null;
                try {
                    JSArray arr = new JSArray();
                    c = getContext().getContentResolver().query(
                        ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                        new String[] {
                            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                            ContactsContract.CommonDataKinds.Phone.NUMBER
                        },
                        null, null,
                        ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC");
                    if (c != null) {
                        while (c.moveToNext()) {
                            JSObject o = new JSObject();
                            String n = c.getString(0);
                            String p = c.getString(1);
                            o.put("name", n == null ? "" : n);
                            o.put("phone", p == null ? "" : p);
                            arr.put(o);
                        }
                    }
                    JSObject out = new JSObject();
                    out.put("contacts", arr);
                    call.resolve(out);
                } catch (Exception e) {
                    call.reject("Could not read contacts: " + e.getMessage());
                } finally {
                    if (c != null) c.close();
                }
            }
        }).start();
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

    // True when the accessibility service is switched on
    @PluginMethod
    public void ussdServiceStatus(PluginCall call) {
        JSObject out = new JSObject();
        out.put("enabled", UssdAccessibilityService.instance != null);
        call.resolve(out);
    }

    // Opens the Android screen where the user switches the service on
    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    // Runs a full multi-step USSD in the real dialer window, step by step, to the end.
    // With "sig", each menu option is found by what it says instead of its number.
    @PluginMethod
    public void runUssdFlow(final PluginCall call) {
        if (getPermissionState("phone") != PermissionState.GRANTED) {
            call.reject("Phone permission not granted");
            return;
        }
        final String first = call.getString("first", "");
        final JSArray stepArr = call.getArray("steps");
        final Integer slotArg = call.getInt("slot", 0);
        final int slot = slotArg == null ? 0 : slotArg;
        final long stepMs = call.getLong("stepTimeoutMs", 20000L);
        final long keyMs = call.getLong("keyDelayMs", 80L);
        final long totalMs = call.getLong("totalTimeoutMs", 90000L);
        Boolean exArg = call.getBoolean("express", true);
        final boolean useExpress = exArg == null || exArg;
        if (first == null || first.isEmpty()) {
            call.reject("No USSD code given");
            return;
        }

        // The signature arrives as { steps: [...], complete: true } (or just the steps array).
        // If one was sent but cannot be read, stop. Running without it could buy the wrong plan.
        JSONArray sigTmp = null;
        Object rawSig = call.getData().opt("sig");
        if (rawSig instanceof JSONArray) {
            sigTmp = (JSONArray) rawSig;
        } else if (rawSig instanceof JSONObject) {
            JSONObject so = (JSONObject) rawSig;
            if (so.optBoolean("complete", true)) sigTmp = so.optJSONArray("steps");
        }
        if (rawSig != null && rawSig != JSONObject.NULL && sigTmp == null) {
            call.reject("The saved signature could not be used. Nothing was sent. Learn it again.");
            return;
        }
        final JSONArray sigArr = sigTmp;

        final String[] steps;
        try {
            int n = stepArr == null ? 0 : stepArr.length();
            steps = new String[n];
            for (int i = 0; i < n; i++) steps[i] = String.valueOf(stepArr.get(i));
        } catch (JSONException e) {
            call.reject("Bad steps");
            return;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                call.resolve(UssdFlow.run(getContext(), slot, first, steps, stepMs, keyMs, totalMs, useExpress, sigArr));
            }
        }).start();
    }

    // The other accessibility apps that are switched on
    @PluginMethod
    public void accessibilityConflicts(PluginCall call) {
        call.resolve(AccessibilityGuard.toJson(getContext()));
    }

    // Reads the SMS inbox for payments the live receiver may have missed
    @PluginMethod
    public void scanInbox(final PluginCall call) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                int n = SmsCatchUp.scan(getContext());
                if (n > 0) poke();
                JSObject out = new JSObject();
                out.put("added", n);
                call.resolve(out);
            }
        }).start();
    }

    // Sends an SMS from one SIM (used for customer notifications). slot 0 is SIM 1, slot 1 is SIM 2.
    @PluginMethod
    public void sendSms(PluginCall call) {
        String to = call.getString("to", "");
        String text = call.getString("text", "");
        Integer slotArg = call.getInt("slot", 0);
        int slot = slotArg == null ? 0 : slotArg;
        if (to == null || to.trim().isEmpty() || text == null || text.trim().isEmpty()) {
            call.reject("Number and message are required");
            return;
        }
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.SEND_SMS)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            call.reject("SMS permission not granted");
            return;
        }
        try {
            SmsManager sm = null;
            try {
                SubscriptionManager subs = getContext().getSystemService(SubscriptionManager.class);
                SubscriptionInfo info = subs.getActiveSubscriptionInfoForSimSlotIndex(slot);
                if (info != null) sm = SmsManager.getSmsManagerForSubscriptionId(info.getSubscriptionId());
            } catch (SecurityException e) {
                // falls back to the default SIM
            }
            if (sm == null) sm = SmsManager.getDefault();
            ArrayList<String> parts = sm.divideMessage(text);
            sm.sendMultipartTextMessage(to.trim(), null, parts, null, null);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not send SMS: " + e.getMessage());
        }
    }

    // ---------- Setup helpers ----------
    // Opens this app's own "App info" page, where "Allow restricted settings" lives
    @PluginMethod
    public void openAppInfo(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    // Best guess whether Android is still blocking accessibility for this sideloaded app
    @PluginMethod
    public void restrictedStatus(PluginCall call) {
        boolean blocked = false;
        if (Build.VERSION.SDK_INT >= 33) {
            try {
                android.app.AppOpsManager ops = (android.app.AppOpsManager)
                    getContext().getSystemService(android.content.Context.APP_OPS_SERVICE);
                int mode = ops.unsafeCheckOpNoThrow("android:access_restricted_settings",
                    android.os.Process.myUid(), getContext().getPackageName());
                blocked = mode != android.app.AppOpsManager.MODE_ALLOWED;
            } catch (Exception e) {
                blocked = false;
            }
        }
        JSObject out = new JSObject();
        out.put("blocked", blocked);
        call.resolve(out);
    }

    // Asks Android to let the app run in the background without battery limits
    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception e) {
            // some phones do not offer this screen
        }
        call.resolve();
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve();
            return;
        }
        requestPermissionForAlias("notifications", call, "notifDone");
    }

    @PermissionCallback
    private void notifDone(PluginCall call) {
        call.resolve();
    }

    @PluginMethod
    public void startKeepAlive(PluginCall call) {
        getContext().getSharedPreferences("autobingwa_prefs", android.content.Context.MODE_PRIVATE)
            .edit().putBoolean("keepalive", true).apply();
        ContextCompat.startForegroundService(getContext(), new Intent(getContext(), KeepAliveService.class));
        call.resolve();
    }

    @PluginMethod
    public void stopKeepAlive(PluginCall call) {
        getContext().getSharedPreferences("autobingwa_prefs", android.content.Context.MODE_PRIVATE)
            .edit().putBoolean("keepalive", false).apply();
        getContext().stopService(new Intent(getContext(), KeepAliveService.class));
        call.resolve();
    }

    @PluginMethod
    public void phoneAlert(PluginCall call) {
        Notifier.alert(getContext(), call.getString("kind", ""), call.getString("title", ""), call.getString("text", ""));
        call.resolve();
    }
}