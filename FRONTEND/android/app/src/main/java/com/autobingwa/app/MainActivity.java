package com.autobingwa.app;

import android.os.Bundle;
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
}