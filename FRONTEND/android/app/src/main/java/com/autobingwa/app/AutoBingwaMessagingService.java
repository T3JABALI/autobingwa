package com.autobingwa.app;

import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public class AutoBingwaMessagingService extends FirebaseMessagingService {

    // Firebase gives this phone a new push address
    @Override
    public void onNewToken(String token) {
        getSharedPreferences("autobingwa_prefs", Context.MODE_PRIVATE)
            .edit().putString("fcm_token", token).apply();
        AutoBingwaPlugin.pokeToken();
    }

    // A job was assigned to this phone
    @Override
    public void onMessageReceived(RemoteMessage message) {
        Map<String, String> d = message.getData();
        if (!"job".equals(d.get("type"))) return;
        String jobId = d.get("job_id");
        if (jobId == null || jobId.isEmpty()) return;

        try {
            ContextCompat.startForegroundService(this, new Intent(this, KeepAliveService.class));
        } catch (Exception e) {
            // Android can refuse; the next heartbeat picks the job up
        }
        CloudSync.handleJob(this, jobId);
        AutoBingwaPlugin.pokeJob();
    }
}