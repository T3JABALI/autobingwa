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
        // Lets the app come up over the lock screen and light the screen when the service wakes it
        if (android.os.Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
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

    // After a wake, go back to the background, but never while a USSD purchase is running.
    // Checks every 500 ms and waits at most 2 minutes.
    private void backWhenIdle(final int tries) {
        if ((UssdFlow.busy || PortalQueue.peek(this).length() > 0) && tries < 240) {
            loop.postDelayed(new Runnable() {
                @Override public void run() { backWhenIdle(tries + 1); }
            }, 500);
            return;
        }
        moveTaskToBack(true);
    }

    @Override
    public void onResume() {
        super.onResume();
        loop.removeCallbacks(keep);
        Intent in = getIntent();
        if (in != null && in.getBooleanExtra("restart", false)) {
            in.removeExtra("restart");
            // let the web app load and resume automation, then go back to the background
            loop.postDelayed(new Runnable() {
                @Override public void run() { backWhenIdle(0); }
            }, 3500);
        }
    }
}