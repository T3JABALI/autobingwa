package com.autobingwa.app;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // Repeats every 5 seconds while automation runs, so Android cannot freeze the web view's timers
    private final Handler loop = new Handler(Looper.getMainLooper());
    private final Runnable keep = new Runnable() {
        @Override public void run() {
            keepWebViewRunning();
            if (KeepAliveService.active) loop.postDelayed(this, 5000);
        }
    };

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
        loop.removeCallbacks(keep);
        loop.postDelayed(keep, 5000);
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
        loop.removeCallbacks(keep);
        Intent in = getIntent();
        if (in != null && in.getBooleanExtra("restart", false)) {
            in.removeExtra("restart");
            // let the web app load and resume automation, then go back to the background
            new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                @Override public void run() { moveTaskToBack(true); }
            }, 25000);
        }
    }
}