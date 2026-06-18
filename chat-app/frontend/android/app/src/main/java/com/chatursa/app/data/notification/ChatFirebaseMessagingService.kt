package com.chatursa.app.data.notification

import android.app.PendingIntent
import android.content.Intent
import android.graphics.BitmapFactory
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import com.chatursa.app.MainActivity
import com.chatursa.app.R
import com.chatursa.app.data.network.RetrofitClient
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class ChatFirebaseMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        saveFcmToken(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val notification = message.notification
        val data = message.data

        val title = notification?.title ?: data["title"] ?: "Чат УРСА"
        val body = notification?.body ?: data["body"] ?: ""
        val chatId = data["chatId"]
        val messageId = data["messageId"]
        val senderId = data["senderId"]

        showNotification(title, body, chatId, messageId, senderId)
    }

    private fun showNotification(title: String, body: String, chatId: String?, messageId: String?, senderId: String?) {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            chatId?.let { putExtra("chatId", it) }
            messageId?.let { putExtra("messageId", it) }
        }

        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notificationBuilder = NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)

        // Mark Read action
        if (chatId != null) {
            val markReadIntent = Intent(this, NotificationActionReceiver::class.java).apply {
                action = NotificationActionReceiver.ACTION_MARK_READ
                putExtra(NotificationActionReceiver.EXTRA_CHAT_ID, chatId)
                putExtra(NotificationActionReceiver.EXTRA_MESSAGE_ID, messageId)
                putExtra(NotificationActionReceiver.EXTRA_SENDER_ID, senderId)
            }

            val markReadPendingIntent = PendingIntent.getBroadcast(
                this, chatId.hashCode(), markReadIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            notificationBuilder.addAction(
                0, "Прочитано", markReadPendingIntent
            )
        }

        // Reply action with RemoteInput
        if (chatId != null) {
            val replyIntent = Intent(this, NotificationActionReceiver::class.java).apply {
                action = NotificationActionReceiver.ACTION_REPLY
                putExtra(NotificationActionReceiver.EXTRA_CHAT_ID, chatId)
                putExtra(NotificationActionReceiver.EXTRA_MESSAGE_ID, messageId)
                putExtra(NotificationActionReceiver.EXTRA_SENDER_ID, senderId)
            }

            val replyPendingIntent = PendingIntent.getBroadcast(
                this, chatId.hashCode() + 1, replyIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val remoteInput = RemoteInput.Builder(NotificationActionReceiver.KEY_REPLY_TEXT)
                .setLabel("Ответить")
                .build()

            val replyAction = NotificationCompat.Action.Builder(
                0, "Ответить", replyPendingIntent
            )
                .addRemoteInput(remoteInput)
                .build()

            notificationBuilder.addAction(replyAction)
        }

        val notificationId = chatId?.hashCode() ?: System.currentTimeMillis().toInt()
        NotificationManagerCompat.from(this).notify(notificationId, notificationBuilder.build())
    }

    private fun saveFcmToken(token: String) {
        val prefs = getSharedPreferences("chat_prefs", MODE_PRIVATE)
        prefs.edit().putString("fcm_token", token).apply()

        val userId = prefs.getString("user_id", null)
        if (userId != null) {
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    RetrofitClient.apiService.registerFcmToken(mapOf("userId" to userId, "token" to token))
                } catch (_: Exception) {}
            }
        }
    }

    companion object {
        const val NOTIFICATION_CHANNEL_ID = "chat_messages"
    }
}
