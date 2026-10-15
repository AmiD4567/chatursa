package com.chatursa.app.data.network

import android.util.Log

class ChatActionsRepository {

    private val api get() = RetrofitClient.apiService

    suspend fun setPinned(chatId: String, userId: String, pinned: Boolean): Boolean =
        run(chatId) { api.pinChat(chatId, mapOf("userId" to userId, "pinned" to pinned)).isSuccessful }

    suspend fun setMuted(chatId: String, userId: String, muted: Boolean): Boolean =
        run(chatId) { api.muteChat(chatId, mapOf("userId" to userId, "muted" to muted)).isSuccessful }

    suspend fun setUnread(chatId: String, userId: String, forceUnread: Boolean): Boolean =
        run(chatId) { api.markChatUnread(chatId, mapOf("userId" to userId, "forceUnread" to forceUnread)).isSuccessful }

    suspend fun clear(chatId: String, userId: String): Boolean =
        run(chatId) { api.clearChat(chatId, mapOf("userId" to userId)).isSuccessful }

    suspend fun hide(chatId: String, userId: String): Boolean =
        run(chatId) { api.hideChat(chatId, mapOf("userId" to userId)).isSuccessful }

    suspend fun delete(chatId: String, userId: String): Boolean =
        run(chatId) { api.deleteChat(chatId, userId).isSuccessful }

    suspend fun leave(chatId: String, userId: String): Boolean =
        run(chatId) { api.leaveChat(chatId, mapOf("userId" to userId)).isSuccessful }

    private inline fun run(chatId: String, block: () -> Boolean): Boolean =
        try {
            block()
        } catch (e: Exception) {
            Log.e("ChatActions", "Action failed for chat $chatId", e)
            false
        }
}
