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
    private val chatActions = com.chatursa.app.data.network.ChatActionsRepository()

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
                            chats = event.chats.distinctBy { it.id }.sortedForList(),
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
                        updateChatWithNewMessage(event.message, event.chat)
                    }
                    is SocketEvent.ChatCreated -> {
                        val chats = (listOf(event.chat) + _uiState.value.chats).distinctBy { it.id }.sortedForList()
                        _uiState.value = _uiState.value.copy(chats = chats, createdChatId = event.chat.id)
                    }
                    is SocketEvent.ChatUpdated -> {
                        // Чат может быть незнаком: первое сообщение в direct-чате,
                        // созданном другим пользователем, — добавляем его в список
                        val exists = _uiState.value.chats.any { it.id == event.chat.id }
                        val updatedChats = if (!exists) {
                            (listOf(event.chat) + _uiState.value.chats).distinctBy { it.id }.sortedForList()
                        } else {
                            _uiState.value.chats.map { chat ->
                                if (chat.id == event.chat.id) {
                                    chat.copy(
                                        lastMessage = event.chat.lastMessage ?: chat.lastMessage,
                                        lastActivity = event.chat.lastMessage?.timestamp ?: chat.lastActivity,
                                        unreadCount = maxOf(chat.unreadCount, event.chat.unreadCount)
                                    )
                                } else chat
                            }
                        }
                        _uiState.value = _uiState.value.copy(chats = updatedChats)
                    }
                    is SocketEvent.UserStatusChanged -> {
                        val updatedChats = _uiState.value.chats.map { chat ->
                            if (chat.participants.contains(event.userId) || chat.createdBy == event.userId) {
                                chat.copy(
                                    isOnline = event.status == "online",
                                    lastSeen = if (event.status == "online") null
                                        else (event.lastSeen ?: chat.lastSeen)
                                )
                            } else chat
                        }
                        _uiState.value = _uiState.value.copy(chats = updatedChats)
                    }
                    is SocketEvent.UserTyping -> {
                        updateTypingUser(event.chatId, event.userName)
                    }
                    is SocketEvent.UsersList -> {
                        _uiState.value = _uiState.value.copy(users = event.users.distinctBy { it.id })
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
                    is SocketEvent.UserProfileUpdated -> {
                        _uiState.value = _uiState.value.copy(
                            users = _uiState.value.users.map { u ->
                                if (u.id == event.userId) u.copy(
                                    username = event.username.ifBlank { u.username },
                                    statusText = event.statusText.ifEmpty { null },
                                    fullName = event.fullName.ifEmpty { null },
                                    mobilePhone = event.mobilePhone.ifEmpty { null }
                                ) else u
                            }
                        )
                    }
                    is SocketEvent.UserAvatarUpdated -> {
                        val changedName = _uiState.value.users.find { it.id == event.userId }?.username
                        _uiState.value = _uiState.value.copy(
                            users = _uiState.value.users.map { u ->
                                if (u.id == event.userId) u.copy(avatar = event.avatar) else u
                            },
                            chats = _uiState.value.chats.map { c ->
                                if (c.type == "direct" && changedName != null &&
                                    c.participants.any { it.equals(changedName, ignoreCase = true) }
                                ) c.copy(avatar = event.avatar) else c
                            }
                        )
                    }
                    is SocketEvent.ChatAvatarUpdated -> {
                        _uiState.value = _uiState.value.copy(
                            chats = _uiState.value.chats.map { c ->
                                if (c.id == event.chatId) (event.chat ?: c.copy(avatar = event.avatar)) else c
                            }
                        )
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

    fun refreshUsers() {
        socketManager.getUsers()
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
        val userId = _uiState.value.currentUser?.id ?: return
        _uiState.value = _uiState.value.copy(chats = _uiState.value.chats.filter { it.id != chatId })
        viewModelScope.launch { chatActions.delete(chatId, userId) }
    }

    fun togglePin(chat: Chat) {
        val userId = _uiState.value.currentUser?.id ?: return
        val newValue = !chat.pinned
        _uiState.value = _uiState.value.copy(
            chats = _uiState.value.chats.map {
                if (it.id == chat.id) it.copy(pinned = newValue) else it
            }.sortedForList()
        )
        viewModelScope.launch { chatActions.setPinned(chat.id, userId, newValue) }
    }

    fun toggleMute(chat: Chat) {
        val userId = _uiState.value.currentUser?.id ?: return
        val newValue = !chat.muted
        _uiState.value = _uiState.value.copy(
            chats = _uiState.value.chats.map {
                if (it.id == chat.id) it.copy(muted = newValue) else it
            }
        )
        viewModelScope.launch { chatActions.setMuted(chat.id, userId, newValue) }
    }

    fun markUnread(chat: Chat) {
        val userId = _uiState.value.currentUser?.id ?: return
        _uiState.value = _uiState.value.copy(
            chats = _uiState.value.chats.map {
                if (it.id == chat.id) it.copy(unreadCount = maxOf(1, it.unreadCount)) else it
            }
        )
        viewModelScope.launch { chatActions.setUnread(chat.id, userId, true) }
    }

    fun clearChat(chat: Chat) {
        val userId = _uiState.value.currentUser?.id ?: return
        _uiState.value = _uiState.value.copy(
            chats = _uiState.value.chats.map {
                if (it.id == chat.id) it.copy(lastMessage = null, unreadCount = 0) else it
            }
        )
        viewModelScope.launch { chatActions.clear(chat.id, userId) }
    }

    fun leaveChat(chat: Chat) {
        val userId = _uiState.value.currentUser?.id ?: return
        _uiState.value = _uiState.value.copy(chats = _uiState.value.chats.filter { it.id != chat.id })
        viewModelScope.launch { chatActions.leave(chat.id, userId) }
    }

    fun resetUnread(chatId: String) {
        if (_uiState.value.chats.none { it.id == chatId && it.unreadCount > 0 }) return
        _uiState.value = _uiState.value.copy(
            chats = _uiState.value.chats.map {
                if (it.id == chatId) it.copy(unreadCount = 0) else it
            }
        )
    }

    fun cancelDeleteChat() {
        _uiState.value = _uiState.value.copy(pendingDeleteChat = null)
    }

    private fun List<Chat>.sortedForList(): List<Chat> = sortedWith(
        compareByDescending<Chat> { it.pinned }
            .thenByDescending { it.lastMessage?.timestamp ?: it.lastActivity ?: "" }
    )

    private fun updateChatWithNewMessage(message: Message, incomingChat: Chat? = null) {
        val myId = _uiState.value.currentUser?.id
        val exists = _uiState.value.chats.any { it.id == message.chatId }

        // Незнакомый чат (первое сообщение в direct-чате от другого пользователя) — добавляем
        if (!exists && incomingChat != null) {
            val chats = (listOf(incomingChat.copy(lastMessage = message, lastActivity = message.timestamp)) +
                _uiState.value.chats).distinctBy { it.id }
            _uiState.value = _uiState.value.copy(chats = chats)
            return
        }

        val updatedChats = _uiState.value.chats.map { chat ->
            if (chat.id == message.chatId) {
                chat.copy(
                    lastMessage = message,
                    lastActivity = message.timestamp,
                    unreadCount = if (message.senderId != myId)
                        chat.unreadCount + 1 else chat.unreadCount
                )
            } else chat
        }.sortedForList()

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
        val targetUser = _uiState.value.users.find { it.id == userId } ?: return
        val targetUsername = targetUser.username
        val existing = _uiState.value.chats.find { chat ->
            if (chat.type != "direct") return@find false
            when {
                chat.participantsDetails.isNotEmpty() -> {
                    val ids = chat.participantsDetails.map { it.id }
                    ids.contains(currentUser.id) && ids.contains(userId)
                }
                else -> chat.participants.contains(targetUsername) &&
                    chat.participants.contains(currentUser.username)
            }
        }
        if (existing != null) {
            _uiState.value = _uiState.value.copy(createdChatId = existing.id)
            return
        }
        socketManager.createChat(listOf(targetUsername), type)
    }

    fun resetCreatedChatId() {
        _uiState.value = _uiState.value.copy(createdChatId = null)
    }

    fun refresh() {
        val user = _uiState.value.currentUser ?: return
        disconnect()
        connect(user)
    }

    override fun onCleared() {
        super.onCleared()
        collectJob?.cancel()
        socketManager.disconnect()
    }
}
