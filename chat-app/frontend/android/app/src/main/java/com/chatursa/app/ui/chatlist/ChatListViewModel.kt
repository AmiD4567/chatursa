package com.chatursa.app.ui.chatlist

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.chatursa.app.AppConfig
import com.chatursa.app.data.model.Chat
import com.chatursa.app.data.model.Message
import com.chatursa.app.data.model.User
import com.chatursa.app.data.network.SocketEvent
import com.chatursa.app.data.network.SocketManager
import com.chatursa.app.data.notification.NotificationHelper
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

data class ChatListUiState(
    val chats: List<Chat> = emptyList(),
    val users: List<User> = emptyList(),
    val currentUser: User? = null,
    val isConnected: Boolean = false,
    val isConnecting: Boolean = false,
    val error: String? = null,
    val searchQuery: String = "",
    val typingUsers: Map<String, List<String>> = emptyMap(),
    val createdChatId: String? = null,
    val pendingDeleteChat: Chat? = null
)

class ChatListViewModel(application: Application) : AndroidViewModel(application) {

    private val socketManager = SocketManager()

    private val _uiState = MutableStateFlow(ChatListUiState())
    val uiState: StateFlow<ChatListUiState> = _uiState.asStateFlow()

    private var collectJob: Job? = null
    private var isConnecting = false
    var pendingDeleteChat: Chat?
        get() = _uiState.value.pendingDeleteChat
        set(value) { _uiState.value = _uiState.value.copy(pendingDeleteChat = value) }

    fun connect(user: User) {
        if (isConnecting || _uiState.value.isConnected) {
            if (_uiState.value.currentUser?.id == user.id) return
        }

        isConnecting = true
        _uiState.value = ChatListUiState(
            currentUser = user,
            isConnecting = true
        )

        socketManager.connect(user)
        startCollecting()

        viewModelScope.launch {
            delay(20000)
            if (isConnecting && !_uiState.value.isConnected) {
                isConnecting = false
                _uiState.value = _uiState.value.copy(
                    isConnecting = false,
                    error = "Таймаут подключения к ${com.chatursa.app.AppConfig.SERVER_URL}\n" +
                            "Проверьте:\n" +
                            "• Сервер запущен на этом IP\n" +
                            "• Телефон в той же WiFi сети\n" +
                            "• Нет блокировки антивирусом/файрволом",
                    isConnected = false
                )
            }
        }
    }

    private fun startCollecting() {
        collectJob?.cancel()
        collectJob = viewModelScope.launch {
            socketManager.events.collect { event ->
                when (event) {
                    is SocketEvent.Connected -> {
                        isConnecting = false
                        _uiState.value = _uiState.value.copy(
                            currentUser = event.user,
                            chats = event.chats,
                            isConnected = true,
                            isConnecting = false
                        )
                        socketManager.getUsers()
                    }
                    is SocketEvent.Error -> {
                        isConnecting = false
                        _uiState.value = _uiState.value.copy(
                            error = event.message,
                            isConnecting = false,
                            isConnected = false
                        )
                    }
                    is SocketEvent.NewMessage -> {
                        val currentUser = _uiState.value.currentUser
                        if (event.message.senderId != currentUser?.id) {
                            NotificationHelper.playNotificationSound(getApplication())
                        }
                        updateChatWithNewMessage(event.message)
                    }
                    is SocketEvent.ChatCreated -> {
                        val chats = listOf(event.chat) + _uiState.value.chats
                        _uiState.value = _uiState.value.copy(chats = chats, createdChatId = event.chat.id)
                    }
                    is SocketEvent.UserStatusChanged -> {
                        val updatedChats = _uiState.value.chats.map { chat ->
                            if (chat.participants.contains(event.userId) || chat.createdBy == event.userId) {
                                chat.copy(isOnline = event.status == "online")
                            } else chat
                        }
                        _uiState.value = _uiState.value.copy(chats = updatedChats)
                    }
                    is SocketEvent.UserTyping -> {
                        updateTypingUser(event.chatId, event.userName)
                    }
                    is SocketEvent.UsersList -> {
                        _uiState.value = _uiState.value.copy(users = event.users)
                    }
                    is SocketEvent.MessageDeleted -> {
                        val updatedChats = _uiState.value.chats.map { chat ->
                            if (chat.id == event.chatId && chat.lastMessage?.id == event.messageId) {
                                chat.copy(lastMessage = null)
                            } else chat
                        }
                        _uiState.value = _uiState.value.copy(chats = updatedChats)
                    }
                    is SocketEvent.MessageEdited -> {
                        val updatedChats = _uiState.value.chats.map { chat ->
                            if (chat.id == event.chatId && chat.lastMessage?.id == event.messageId) {
                                chat.copy(lastMessage = chat.lastMessage?.copy(
                                    text = event.text, edited = true
                                ))
                            } else chat
                        }
                        _uiState.value = _uiState.value.copy(chats = updatedChats)
                    }
                    is SocketEvent.Disconnected -> {
                        _uiState.value = _uiState.value.copy(isConnected = false)
                    }
                    else -> {}
                }
            }
        }
    }

    fun disconnect() {
        collectJob?.cancel()
        socketManager.disconnect()
        isConnecting = false
        _uiState.value = ChatListUiState()
    }

    fun joinChat(chatId: String) {
        socketManager.joinChat(chatId)
    }

    fun searchChats(query: String) {
        _uiState.value = _uiState.value.copy(searchQuery = query)
    }

    fun getFilteredChats(): List<Chat> {
        val query = _uiState.value.searchQuery.lowercase().trim()
        if (query.isEmpty()) return _uiState.value.chats

        return _uiState.value.chats.filter { chat ->
            chat.name.lowercase().contains(query) ||
            chat.lastMessage?.text?.lowercase()?.contains(query) == true
        }
    }

    fun deleteChat(chatId: String) {
        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                try {
                    val client = OkHttpClient.Builder()
                        .connectTimeout(10, TimeUnit.SECONDS)
                        .readTimeout(10, TimeUnit.SECONDS)
                        .build()

                    val request = Request.Builder()
                        .url("${AppConfig.SERVER_URL}/api/chats/$chatId")
                        .delete()
                        .build()

                    client.newCall(request).execute()
                } catch (e: Exception) {
                    android.util.Log.e("ChatListVM", "Delete chat failed", e)
                }
            }
            _uiState.value = _uiState.value.copy(
                chats = _uiState.value.chats.filter { it.id != chatId }
            )
        }
    }

    fun cancelDeleteChat() {
        _uiState.value = _uiState.value.copy(pendingDeleteChat = null)
    }

    private fun updateChatWithNewMessage(message: Message) {
        val myId = _uiState.value.currentUser?.id
        val updatedChats = _uiState.value.chats.map { chat ->
            if (chat.id == message.chatId) {
                chat.copy(
                    lastMessage = message,
                    lastActivity = message.timestamp,
                    unreadCount = if (message.senderId != myId)
                        chat.unreadCount + 1 else chat.unreadCount
                )
            } else chat
        }.sortedByDescending { it.lastMessage?.timestamp ?: "" }

        _uiState.value = _uiState.value.copy(chats = updatedChats)
    }

    private fun updateTypingUser(chatId: String, userName: String) {
        val current = _uiState.value.typingUsers.toMutableMap()
        val list = current.getOrDefault(chatId, emptyList()).toMutableList()
        if (!list.contains(userName)) {
            list.add(userName)
            current[chatId] = list
            _uiState.value = _uiState.value.copy(typingUsers = current)
            viewModelScope.launch {
                delay(3000)
                val updated = _uiState.value.typingUsers.toMutableMap()
                updated[chatId] = updated[chatId]?.filter { it != userName } ?: emptyList()
                _uiState.value = _uiState.value.copy(typingUsers = updated)
            }
        }
    }

    fun createChat(userId: String, type: String = "direct") {
        val currentUser = _uiState.value.currentUser ?: return
        val existing = _uiState.value.chats.find { chat ->
            chat.type == "direct" &&
            chat.participants.contains(userId) &&
            chat.participants.contains(currentUser.id)
        }
        if (existing != null) {
            _uiState.value = _uiState.value.copy(createdChatId = existing.id)
            return
        }
        socketManager.createChat(listOf(userId, currentUser.id), type)
    }

    fun resetCreatedChatId() {
        _uiState.value = _uiState.value.copy(createdChatId = null)
    }

    override fun onCleared() {
        super.onCleared()
        collectJob?.cancel()
        socketManager.disconnect()
    }
}
