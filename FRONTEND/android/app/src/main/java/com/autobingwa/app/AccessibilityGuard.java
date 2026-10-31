package com.autobingwa.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.util.ArrayList;
import java.util.List;

// Lists the OTHER accessibility services that are switched on. They can click or close the USSD dialog.
public final class AccessibilityGuard {
    private AccessibilityGuard() {}

    // Each entry is { packageName, label }
    public static List<String[]> others(Context ctx) {
        List<String[]> out = new ArrayList<>();
        String raw = Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (raw == null || raw.isEmpty()) return out;
        PackageManager pm = ctx.getPackageManager();
        List<String> seen = new ArrayList<>();
        for (String item : raw.split(":")) {
            int slash = item.indexOf('/');
            String pkg = slash > 0 ? item.substring(0, slash) : item;
            if (pkg.isEmpty() || pkg.equals(ctx.getPackageName()) || seen.contains(pkg)) continue;
            seen.add(pkg);
            String label = pkg;
            try {
                label = String.valueOf(pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)));
            } catch (Exception e) {
                // Android may hide the app name, the package name is shown instead
            }
            out.add(new String[] { pkg, label });
        }
        return out;
    }

    public static boolean ourServiceEnabled(Context ctx) {
        String raw = Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        return raw != null && raw.contains(ctx.getPackageName() + "/");
    }

    public static JSObject toJson(Context ctx) {
        JSArray apps = new JSArray();
        for (String[] a : others(ctx)) {
            JSObject o = new JSObject();
            o.put("package", a[0]);
            o.put("label", a[1]);
            apps.put(o);
        }
        JSObject out = new JSObject();
        out.put("apps", apps);
        out.put("ours", ourServiceEnabled(ctx));
        return out;
    }

    public static void openSettings(Context ctx) {
        Intent i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(i);
    }
}