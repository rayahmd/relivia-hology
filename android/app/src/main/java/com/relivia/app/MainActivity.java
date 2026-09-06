package com.relivia.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // MUST be called BEFORE super.onCreate: the bridge is created inside
        // BridgeActivity.onCreate() from the builder's plugin list, so any
        // registerPlugin() call after super.onCreate() never takes effect
        // and no ReliviaHealth method would ever resolve.
        registerPlugin(ReliviaHealthPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
