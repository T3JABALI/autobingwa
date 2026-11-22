package com.autobingwa.app;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    // Repeats every 5 seconds while automation runs, so Android cannot freeze the web view's timers
    private final Handler loop = new Handler(Looper.getMainLooper());
    private final Runnable keep = new Runnable() {
        @Override public void run() {
            keepWebViewRunning();
            if (KeepAliveService.active || portalOn()) loop.postDelayed(this, 5000);
        }
    };

    // Kept across a screen restart, so a page that stays blank can never cause an endless loop
    private static long lastRestart = 0;
    private static int restartsInARow = 0;
    private boolean wasStopped = false;
    private boolean portalOn() {
        return getSharedPreferences("autobingwa_prefs", MODE_PRIVATE).getBoolean("portal_on", false);
    }
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AutoBingwaPlugin.class);
        super.onCreate(savedInstanceState);
        // Lets the app come up over the lock screen and light the screen when the service wakes it
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        keepRendererAlive();
        watchRenderer();
        // A page that is still blank 10 seconds after the app starts is stuck
        loop.postDelayed(healthCheck, 10000);
    }

    // Asks Android not to stop the web view's own process while the app is in the background.
    // Without this, a phone that is idle or short of memory can end it, and the app comes back black.
    private void keepRendererAlive() {
        try {
            if (Build.VERSION.SDK_INT >= 26 && getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
            }
        } catch (Throwable t) {
            // never block the app because of this
        }
    }

    // If the web view's process ends anyway, start the screen again instead of leaving it black
    private void watchRenderer() {
        try {
            if (getBridge() == null) return;
            getBridge().addWebViewListener(new WebViewListener() {
                @Override
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    boolean crashed = Build.VERSION.SDK_INT >= 26 && detail != null && detail.didCrash();
                    try {
                        EngineCore.note(MainActivity.this, "web view process ended ("
                            + (crashed ? "crashed" : "ended by Android, probably low memory") + ")");
                    } catch (Throwable ignored) { }
                    loop.post(new Runnable() {
                        @Override public void run() { restartScreen("web view process ended"); }
                    });
                    return true; // handled here, so the app itself does not close
                }
            });
        } catch (Throwable t) {
            // never block the app because of this
        }
    }

    // Builds the screen again. Saved data and settings are kept. Never more than once every 30 seconds, never more than 4 in a row.
    private void restartScreen(String why) {
        long now = System.currentTimeMillis();
        if (restartsInARow >= 4 || now - lastRestart < 30000) return;
        lastRestart = now;
        restartsInARow++;
        try { EngineCore.note(this, "screen restarted: " + why); } catch (Throwable ignored) { }
        try { recreate(); } catch (Exception e) { /* never block the app because of this */ }
    }

    // Checks that the page really shows something. A blank or silent page is started again.
    private final Runnable healthCheck = new Runnable() {
        @Override public void run() {
            try {
                if (getBridge() == null || getBridge().getWebView() == null) return;
                final boolean[] answered = { false };
                getBridge().getWebView().evaluateJavascript(
                    "(function(){var b=document.body;return b?b.innerText.length:-1;})()",
                    new ValueCallback<String>() {
                        @Override public void onReceiveValue(String v) {
                            answered[0] = true;
                            String t = v == null ? "" : v.trim();
                            if (t.isEmpty() || t.equals("null") || t.equals("0") || t.equals("-1")) restartScreen("blank page");
                            else restartsInARow = 0;
                        }
                    });
                // a dead page never answers at all
                loop.postDelayed(new Runnable() {
                    @Override public void run() { if (!answered[0]) restartScreen("web view not answering"); }
                }, 3000);
            } catch (Exception e) {
                // never block the app because of this
            }
        }
    };

    // While automation is running, do not let the web view's timers stay paused in the background
    private void keepWebViewRunning() {
        try {
            if ((KeepAliveService.active || portalOn()) && getBridge() != null && getBridge().getWebView() != null) {
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
        wasStopped = true;
        keepWebViewRunning();
                loop.removeCallbacks(keep);
        loop.postDelayed(keep, 5000);
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
        keepRendererAlive();
        // Coming back from the background (icon, recent apps or a wake): make sure the page is really there
        if (wasStopped) {
            wasStopped = false;
            loop.removeCallbacks(healthCheck);
            loop.postDelayed(healthCheck, 2000);
        }
        Intent in = getIntent();
        if (in != null && in.getBooleanExtra("restart", false)) {
            in.removeExtra("restart");
            // let the web app load and resume automation, check the page, then go back to the background
            loop.postDelayed(new Runnable() {
                @Override public void run() {
                    healthCheck.run();
                    backWhenIdle(0);
                }
            }, 3500);
        }
    }
}