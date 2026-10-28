package com.autobingwa.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AutoBingwaPlugin.class);
        super.onCreate(savedInstanceState);
    }
}