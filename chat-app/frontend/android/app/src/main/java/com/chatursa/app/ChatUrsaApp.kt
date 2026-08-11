package com.chatursa.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.util.Log
import androidx.lifecycle.ProcessLifecycleOwner
import coil.Coil
import coil.ImageLoader
import coil.disk.DiskCache
import coil.memory.MemoryCache
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter

class ChatUrsaApp : Application() {
    override fun onCreate() {
        super.onCreate()
        installCrashHandler()
        createNotificationChannels()
        setupImageLoader()
        ProcessLifecycleOwner.get().lifecycle.addObserver(AppLifecycleObserver)
    }

    private fun installCrashHandler() {
        val defaultHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                val sw = StringWriter()
                throwable.printStackTrace(PrintWriter(sw))
                val text = buildString {
                    appendLine("Time: ${System.currentTimeMillis()}")
                    appendLine("Thread: ${thread.name}")
                    appendLine(sw.toString())
                }
                writeCrashLog(text)
            } catch (_: Exception) {
            }
            defaultHandler?.uncaughtException(thread, throwable)
                ?: throwable.printStackTrace()
        }
    }

    private fun writeCrashLog(text: String) {
        val externalDir = getExternalFilesDir(null)
        if (externalDir != null) {
            writeFile(File(externalDir, "crash_log.txt"), text)
        }
        writeFile(File(cacheDir, "crash_log.txt"), text)
    }

    private fun writeFile(file: File, text: String) {
        try {
            file.writeText(text)
        } catch (e: Exception) {
            Log.e("ChatUrsaApp", "Failed to write crash log to ${file.absolutePath}", e)
        }
    }

    private fun setupImageLoader() {
        val imageLoader = ImageLoader.Builder(this)
            .memoryCache {
                MemoryCache.Builder(this)
                    .maxSizePercent(0.25)
                    .build()
            }
            .diskCache {
                DiskCache.Builder()
                    .directory(cacheDir.resolve("coil_cache"))
                    .maxSizeBytes(100L * 1024 * 1024)
                    .build()
            }
            .crossfade(true)
            .build()
        Coil.setImageLoader(imageLoader)
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "Сообщения чата",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Уведомления о новых сообщениях"
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    companion object {
        const val NOTIFICATION_CHANNEL_ID = "chat_messages"
    }
}
