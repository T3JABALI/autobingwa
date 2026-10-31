package com.autobingwa.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

// Automation is manual only: it never starts by itself after a reboot.
// This clears the saved keep-alive flag so nothing else can start the service behind your back.
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String a = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(a) && !"android.intent.action.QUICKBOOT_POWERON".equals(a)) return;
        context.getSharedPreferences("autobingwa_prefs", Context.MODE_PRIVATE)
            .edit().putBoolean("keepalive", false).apply();
    }
}