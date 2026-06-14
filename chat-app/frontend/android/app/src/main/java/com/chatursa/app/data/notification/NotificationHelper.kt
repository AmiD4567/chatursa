package com.chatursa.app.data.notification

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri

object NotificationHelper {
    private var lastPlayedMs = 0L
    private const val DEBOUNCE_MS = 2000L

    fun playNotificationSound(context: Context) {
        val now = System.currentTimeMillis()
        if (now - lastPlayedMs < DEBOUNCE_MS) return
        lastPlayedMs = now

        try {
            val uri: Uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            val mediaPlayer = MediaPlayer().apply {
                setAudioAttributes(AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build())
                setDataSource(context, uri)
                setOnCompletionListener { it.release() }
                setOnErrorListener { _, _, _ -> release(); true }
                prepare()
                start()
            }
        } catch (_: Exception) {}
    }
}
