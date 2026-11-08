package com.autobingwa.app;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AutoBingwaPlugin.class);
        super.onCreate(savedInstanceState);
    }

    // While automation is running, do not let the web view's timers stay paused in the background
    private void keepWebViewRunning() {
        try {
            if (KeepAliveService.active && getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().resumeTimers();
            }
        } catch (Exception e) {
            // never block the app because of this
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        keepWebViewRunning();
    }

    @Override
    public void onStop() {
        super.onStop();
        keepWebViewRunning();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        Intent in = getIntent();
        if (in != null && in.getBooleanExtra("restart", false)) {
            in.removeExtra("restart");
            // let the web app load and resume automation, then go back to the background
            new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                @Override public void run() { moveTaskToBack(true); }
            }, 3500);
        }
    }
}