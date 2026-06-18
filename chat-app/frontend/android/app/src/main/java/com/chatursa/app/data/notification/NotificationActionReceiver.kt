package com.chatursa.app.data.notification

import android.app.Activity
import android.app.RemoteInput
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.AsyncTask
import com.chatursa.app.AppConfig
import com.chatursa.app.data.model.User
import com.google.gson.Gson
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class NotificationActionReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_MARK_READ = "com.chatursa.app.MARK_READ"
        const val ACTION_REPLY = "com.chatursa.app.REPLY"
        const val EXTRA_CHAT_ID = "chatId"
        const val EXTRA_MESSAGE_ID = "messageId"
        const val EXTRA_SENDER_ID = "senderId"
        const val KEY_REPLY_TEXT = "reply_text"
        private const val TAG = "NotificationActionReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        val chatId = intent.getStringExtra(EXTRA_CHAT_ID)
        val messageId = intent.getStringExtra(EXTRA_MESSAGE_ID)
        val senderId = intent.getStringExtra(EXTRA_SENDER_ID)

        if (chatId == null) return

        when (action) {
            ACTION_MARK_READ -> {
                resultCode = Activity.RESULT_OK
                val pendingResult = goAsync()
                MarkReadTask(context, chatId, senderId, pendingResult).execute()
            }
            ACTION_REPLY -> {
                val results = RemoteInput.getResultsFromIntent(intent)
                val replyText = results?.getString(KEY_REPLY_TEXT)
                if (replyText.isNullOrBlank()) return

                resultCode = Activity.RESULT_OK
                val pendingResult = goAsync()
                ReplyTask(context, chatId, replyText, senderId, pendingResult).execute()
            }
        }
    }

    private class MarkReadTask(
        private val context: Context,
        private val chatId: String,
        private val senderId: String?,
        private val pendingResult: PendingResult
    ) : AsyncTask<Void, Void, Void>() {
        override fun doInBackground(vararg params: Void?): Void? {
            try {
                val prefs = context.getSharedPreferences("chat_ursa", Context.MODE_PRIVATE)
                val userJson = prefs.getString("user_data", null)
                val user = userJson?.let { Gson().fromJson(it, User::class.java) }

                if (user != null) {
                    val client = OkHttpClient.Builder()
                        .connectTimeout(10, TimeUnit.SECONDS)
                        .readTimeout(10, TimeUnit.SECONDS)
                        .build()

                    val json = JSONObject().apply {
                        put("chatId", chatId)
                        put("userId", user.id)
                    }

                    val body = json.toString().toRequestBody("application/json".toMediaType())
                    val request = Request.Builder()
                        .url("${AppConfig.SERVER_URL}/api/messages/read")
                        .post(body)
                        .build()

                    client.newCall(request).execute()
                }
            } catch (e: Exception) {
                android.util.Log.e(TAG, "Mark read failed", e)
            }
            pendingResult.finish()
            return null
        }
    }

    private class ReplyTask(
        private val context: Context,
        private val chatId: String,
        private val replyText: String,
        private val senderId: String?,
        private val pendingResult: PendingResult
    ) : AsyncTask<Void, Void, Void>() {
        override fun doInBackground(vararg params: Void?): Void? {
            try {
                val prefs = context.getSharedPreferences("chat_ursa", Context.MODE_PRIVATE)
                val userJson = prefs.getString("user_data", null)
                val user = userJson?.let { Gson().fromJson(it, User::class.java) }

                if (user != null) {
                    val client = OkHttpClient.Builder()
                        .connectTimeout(10, TimeUnit.SECONDS)
                        .readTimeout(10, TimeUnit.SECONDS)
                        .build()

                    val json = JSONObject().apply {
                        put("chatId", chatId)
                        put("senderId", user.id)
                        put("text", replyText)
                    }

                    val body = json.toString().toRequestBody("application/json".toMediaType())
                    val request = Request.Builder()
                        .url("${AppConfig.SERVER_URL}/api/messages")
                        .post(body)
                        .build()

                    client.newCall(request).execute()
                }
            } catch (e: Exception) {
                android.util.Log.e(TAG, "Reply failed", e)
            }
            pendingResult.finish()
            return null
        }
    }
}
