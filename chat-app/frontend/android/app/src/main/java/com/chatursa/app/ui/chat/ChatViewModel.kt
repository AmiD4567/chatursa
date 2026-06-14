package com.chatursa.app.ui.chat

import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.chatursa.app.data.model.Chat
import com.chatursa.app.data.model.LinkPreview
import com.chatursa.app.data.model.Message
import com.chatursa.app.data.model.User
import com.chatursa.app.data.network.AudioRecorder
import com.chatursa.app.data.network.AudioUploader
import com.chatursa.app.data.network.FileUploader
import com.chatursa.app.data.network.RetrofitClient
import com.chatursa.app.data.network.SocketEvent
import com.chatursa.app.data.network.SocketManager
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject

data class ChatUiState(
    val chat: Chat? = null,
    val messages: List<Message> = emptyList(),
    val currentUser: User? = null,
    val isLoading: Boolean = true,
    val isConnected: Boolean = false,
    val error: String? = null,
    val typingText: String = "",
    val replyToMessage: Message? = null,
    val editingMessage: Message? = null,
    val showDeleteConfirm: Message? = null,
    val showForwardDialog: Boolean = false,
    val forwardMessage: Message? = null,
    val users: List<User> = emptyList(),
    val showContextMenu: Boolean = false,
    val contextMenuMessage: Message? = null,
    val isRecording: Boolean = false,
    val recordingDurationMs: Long = 0L,
    val pinnedMessage: Message? = null,
    val imageViewerUrl: String? = null,
    val linkPreviews: Map<String, LinkPreview> = emptyMap(),
    val searchQuery: String = "",
    val isSearching: Boolean = false
)

class ChatViewModel(application: Application) : AndroidViewModel(application) {

    private val socketManager = SocketManager()
    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    private var collectJob: Job? = null
    private var typingJob: Job? = null
    private var wasTyping = false
    private var pendingChatId: String? = null
    private val audioRecorder = AudioRecorder()
    private val audioUploader = AudioUploader()
    private var recordingTimerJob: Job? = null
    private val previewCache = mutableMapOf<String, LinkPreview>()
    private val fileUploader = FileUploader()

    companion object {
        private val URL_REGEX = Regex("https?://[\\w\\-._~:/?#\\[\\]@!$&'()*+,;=%]+")

        fun getUrlsFromText(text: String): List<String> {
            return URL_REGEX.findAll(text).map { it.value }.toList()
        }
    }

    fun connectToChat(chat: Chat, user: User) {
        if (collectJob != null) {
            collectJob?.cancel()
        }

        pendingChatId = chat.id
        _uiState.value = ChatUiState(
            chat = chat,
            currentUser = user,
            isLoading = true
        )

        socketManager.connect(user)
        startCollecting()
    }

    private fun startCollecting() {
        collectJob = viewModelScope.launch {
            socketManager.events.collect { event ->
                val chatId = _uiState.value.chat?.id

                when (event) {
                    is SocketEvent.Connected -> {
                        _uiState.value = _uiState.value.copy(isConnected = true)
                        // Now that we're connected, join the chat room
                        pendingChatId?.let { id ->
                            socketManager.joinChat(id)
                            pendingChatId = null
                        }
                    }
                    is SocketEvent.ChatHistory -> {
                        if (event.chatId == chatId) {
                            _uiState.value = _uiState.value.copy(
                                messages = event.messages,
                                chat = event.chat ?: _uiState.value.chat,
                                isLoading = false
                            )
                            markMessagesAsRead(event.messages)
                        }
                    }
                    is SocketEvent.NewMessage -> {
                        if (event.message.chatId == chatId) {
                            val msgs = _uiState.value.messages + event.message
                            _uiState.value = _uiState.value.copy(messages = msgs)
                            markMessagesAsRead(listOf(event.message))
                        }
                    }
                    is SocketEvent.UserTyping -> {
                        if (event.chatId == chatId && event.userId != _uiState.value.currentUser?.id) {
                            _uiState.value = _uiState.value.copy(
                                typingText = "${event.userName} печатает..."
                            )
                            viewModelScope.launch {
                                delay(4000)
                                _uiState.value = _uiState.value.copy(typingText = "")
                            }
                        }
                    }
                    is SocketEvent.MessageDeleted -> {
                        if (event.chatId == chatId) {
                            _uiState.value = _uiState.value.copy(
                                messages = _uiState.value.messages.filter { it.id != event.messageId }
                            )
                        }
                    }
                    is SocketEvent.MessageEdited -> {
                        if (event.chatId == chatId) {
                            _uiState.value = _uiState.value.copy(
                                messages = _uiState.value.messages.map {
                                    if (it.id == event.messageId) it.copy(text = event.text, edited = true)
                                    else it
                                }
                            )
                        }
                    }
                    is SocketEvent.ReactionAdded -> {
                        if (_uiState.value.messages.any { it.id == event.messageId }) {
                            updateReaction(event.messageId, event.userId, event.emoji, event.userName, add = true)
                        }
                    }
                    is SocketEvent.ReactionRemoved -> {
                        if (_uiState.value.messages.any { it.id == event.messageId }) {
                            updateReaction(event.messageId, event.userId, event.emoji, "", add = false)
                        }
                    }
                    is SocketEvent.MessagesRead -> {
                        if (event.chatId == chatId) {
                            _uiState.value = _uiState.value.copy(
                                messages = _uiState.value.messages.map { msg ->
                                    if (event.messageIds.contains(msg.id) && msg.readAt == null) {
                                        msg.copy(readAt = "read")
                                    } else msg
                                }
                            )
                        }
                    }
                    is SocketEvent.MessagePinned -> {
                        if (event.chatId == chatId) {
                            if (event.message != null) {
                                _uiState.value = _uiState.value.copy(pinnedMessage = event.message)
                            }
                            _uiState.value = _uiState.value.copy(
                                messages = _uiState.value.messages.map {
                                    if (it.id == event.messageId) it.copy(isPinned = true) else it
                                }
                            )
                        }
                    }
                    is SocketEvent.MessageUnpinned -> {
                        if (event.chatId == chatId) {
                            _uiState.value = _uiState.value.copy(
                                pinnedMessage = null,
                                messages = _uiState.value.messages.map {
                                    if (it.id == event.messageId) it.copy(isPinned = false) else it
                                }
                            )
                        }
                    }
                    is SocketEvent.UsersList -> {
                        _uiState.value = _uiState.value.copy(users = event.users)
                    }
                    is SocketEvent.Disconnected -> {
                        _uiState.value = _uiState.value.copy(isConnected = false)
                    }
                    is SocketEvent.Error -> {
                        _uiState.value = _uiState.value.copy(
                            error = event.message,
                            isLoading = false
                        )
                    }
                    else -> {}
                }
            }
        }
    }

    fun sendMessage(text: String, fileUrl: String? = null, fileMimetype: String? = null, filename: String? = null, fileSize: Long = 0) {
        val chat = _uiState.value.chat ?: return
        if (text.isBlank() && fileUrl == null) return

        val replyTo = _uiState.value.replyToMessage
        val file = if (fileUrl != null) {
            JSONObject().apply {
                put("filename", filename ?: "Голосовое сообщение")
                put("url", fileUrl)
                put("size", fileSize)
                put("mimetype", fileMimetype ?: "audio/mp4")
            }
        } else null
        socketManager.sendMessage(chat.id, text, replyTo?.id, file)
        _uiState.value = _uiState.value.copy(replyToMessage = null)
    }

    fun setPendingShare(text: String?, imageUri: String?) {
        pendingShareText = text
        pendingShareImageUri = imageUri
    }

    var pendingShareText: String? = null
    var pendingShareImageUri: String? = null

    fun startRecording(cacheDir: java.io.File) {
        try {
            audioRecorder.start(cacheDir)
            _uiState.value = _uiState.value.copy(isRecording = true, recordingDurationMs = 0L)
            recordingTimerJob?.cancel()
            recordingTimerJob = viewModelScope.launch {
                var elapsed = 0L
                while (audioRecorder.isRecording) {
                    delay(200)
                    elapsed += 200
                    _uiState.value = _uiState.value.copy(recordingDurationMs = elapsed)
                    if (elapsed > 60_000) {
                        stopRecordingAndSend()
                        break
                    }
                }
            }
        } catch (e: Exception) {
            _uiState.value = _uiState.value.copy(isRecording = false)
        }
    }

    fun stopRecordingAndSend() {
        recordingTimerJob?.cancel()
        val result = audioRecorder.stop() ?: return
        val (file, durationMs, _) = result
        val audioFile = file ?: return
        _uiState.value = _uiState.value.copy(isRecording = false, recordingDurationMs = 0L)

        viewModelScope.launch {
            val uploadResult = audioUploader.upload(audioFile)
            if (uploadResult != null) {
                sendMessage(text = "", fileUrl = uploadResult.url, fileMimetype = uploadResult.mimetype, filename = uploadResult.filename, fileSize = uploadResult.size)
            }
        }
    }

    fun cancelRecording() {
        recordingTimerJob?.cancel()
        audioRecorder.cancel()
        _uiState.value = _uiState.value.copy(isRecording = false, recordingDurationMs = 0L)
    }

    fun sendTyping(isTyping: Boolean) {
        val chat = _uiState.value.chat ?: return
        if (isTyping == wasTyping) return
        wasTyping = isTyping

        typingJob?.cancel()
        typingJob = viewModelScope.launch {
            socketManager.sendTyping(chat.id, isTyping)
            if (isTyping) {
                delay(3000)
                wasTyping = false
                socketManager.sendTyping(chat.id, false)
            }
        }
    }

    fun setReplyTo(message: Message?) {
        _uiState.value = _uiState.value.copy(replyToMessage = message, editingMessage = null)
    }

    fun setEditing(message: Message?) {
        _uiState.value = _uiState.value.copy(editingMessage = message, replyToMessage = null)
    }

    fun deleteMessage(message: Message) {
        _uiState.value = _uiState.value.copy(showDeleteConfirm = message, showContextMenu = false)
    }

    fun confirmDelete() {
        _uiState.value.showDeleteConfirm?.let { msg ->
            socketManager.deleteMessage(msg.id)
        }
        _uiState.value = _uiState.value.copy(showDeleteConfirm = null)
    }

    fun cancelDelete() {
        _uiState.value = _uiState.value.copy(showDeleteConfirm = null)
    }

    fun showForwardUI(message: Message) {
        _uiState.value = _uiState.value.copy(showForwardDialog = true, forwardMessage = message, showContextMenu = false)
        socketManager.getUsers()
    }

    fun cancelForward() {
        _uiState.value = _uiState.value.copy(showForwardDialog = false, forwardMessage = null)
    }

    fun forwardToUser(targetUserId: String) {
        _uiState.value.forwardMessage?.let { msg ->
            socketManager.forwardMessage(msg.id, targetUserId)
        }
        _uiState.value = _uiState.value.copy(showForwardDialog = false, forwardMessage = null)
    }

    fun pinMessage(message: Message) {
        if (message.isPinned) {
            socketManager.unpinMessage(message.id)
        } else {
            socketManager.pinMessage(message.id)
        }
        _uiState.value = _uiState.value.copy(showContextMenu = false, contextMenuMessage = null)
    }

    fun unpinCurrent() {
        _uiState.value.pinnedMessage?.let { msg ->
            socketManager.unpinMessage(msg.id)
        }
    }

    fun showImageViewer(url: String) {
        _uiState.value = _uiState.value.copy(imageViewerUrl = url)
    }

    fun hideImageViewer() {
        _uiState.value = _uiState.value.copy(imageViewerUrl = null)
    }

    fun uploadAndSendFile(context: android.content.Context, uri: android.net.Uri) {
        viewModelScope.launch {
            try {
                val mimeType = context.contentResolver.getType(uri) ?: "application/octet-stream"
                val result = fileUploader.upload(context, uri, mimeType)
                if (result != null) {
                    sendMessage(
                        text = "",
                        fileUrl = result.url,
                        fileMimetype = result.mimetype,
                        filename = result.filename,
                        fileSize = result.size
                    )
                }
            } catch (_: Exception) {}
        }
    }

    fun startSearch() {
        _uiState.value = _uiState.value.copy(isSearching = true, searchQuery = "")
    }

    fun stopSearch() {
        _uiState.value = _uiState.value.copy(isSearching = false, searchQuery = "")
    }

    fun setSearchQuery(query: String) {
        _uiState.value = _uiState.value.copy(searchQuery = query)
    }

    fun getFilteredMessages(): List<Message> {
        val q = _uiState.value.searchQuery.trim().lowercase()
        if (q.isEmpty() || !_uiState.value.isSearching) return _uiState.value.messages
        return _uiState.value.messages.filter { msg ->
            msg.text.lowercase().contains(q) ||
            msg.senderName.lowercase().contains(q) ||
            (msg.fileData?.name?.lowercase()?.contains(q) == true)
        }
    }

    fun fetchLinkPreview(url: String) {
        if (previewCache.containsKey(url)) return
        viewModelScope.launch {
            try {
                val api = RetrofitClient.apiService
                val response = api.getLinkPreview(url)
                if (response.isSuccessful) {
                    val preview = response.body() ?: return@launch
                    previewCache[url] = preview
                    _uiState.value = _uiState.value.copy(
                        linkPreviews = previewCache.toMap()
                    )
                }
            } catch (_: Exception) {}
        }
    }

    fun toggleReaction(messageId: String, emoji: String) {
        val msg = _uiState.value.messages.find { it.id == messageId } ?: return
        val userId = _uiState.value.currentUser?.id ?: return
        val hasReaction = msg.reactions.any { it.userId == userId && it.emoji == emoji }
        if (hasReaction) {
            removeReaction(messageId, emoji)
        } else {
            addReaction(messageId, emoji)
        }
        _uiState.value = _uiState.value.copy(showContextMenu = false, contextMenuMessage = null)
    }

    fun showContextMenu(message: Message) {
        _uiState.value = _uiState.value.copy(showContextMenu = true, contextMenuMessage = message)
    }

    fun hideContextMenu() {
        _uiState.value = _uiState.value.copy(showContextMenu = false, contextMenuMessage = null)
    }

    fun editSubmit(messageId: String, newText: String) {
        if (newText.isNotBlank()) {
            socketManager.editMessage(messageId, newText)
        }
        _uiState.value = _uiState.value.copy(editingMessage = null)
    }

    fun updateUsers(users: List<User>) {
        _uiState.value = _uiState.value.copy(users = users)
    }

    fun addReaction(messageId: String, emoji: String) {
        socketManager.addReaction(messageId, emoji)
    }

    fun removeReaction(messageId: String, emoji: String) {
        socketManager.removeReaction(messageId, emoji)
    }

    private val draftPrefs: SharedPreferences by lazy {
        getApplication<Application>().getSharedPreferences("chat_drafts", Context.MODE_PRIVATE)
    }

    fun loadDraft(chatId: String): String = draftPrefs.getString(chatId, "") ?: ""

    fun saveDraft(chatId: String, text: String) {
        if (text.isBlank()) draftPrefs.edit().remove(chatId).apply()
        else draftPrefs.edit().putString(chatId, text).apply()
    }

    fun disconnect() {
        collectJob?.cancel()
        socketManager.disconnect()
        pendingChatId = null
    }

    private fun markMessagesAsRead(messages: List<Message>) {
        val userId = _uiState.value.currentUser?.id ?: return
        val unreadIds = messages
            .filter { it.senderId != userId && it.readAt == null }
            .map { it.id }
        if (unreadIds.isNotEmpty()) {
            _uiState.value.chat?.let { chat ->
                socketManager.markRead(chat.id, unreadIds)
            }
        }
    }

    private fun updateReaction(messageId: String, userId: String, emoji: String, userName: String, add: Boolean) {
        _uiState.value = _uiState.value.copy(
            messages = _uiState.value.messages.map { msg ->
                if (msg.id == messageId) {
                    val reactions = msg.reactions.toMutableList()
                    if (add) {
                        val existingIndex = reactions.indexOfFirst { it.userId == userId && it.emoji == emoji }
                        if (existingIndex == -1) {
                            reactions.add(com.chatursa.app.data.model.Reaction(userId, emoji, userName))
                        }
                    } else {
                        reactions.removeAll { it.userId == userId && it.emoji == emoji }
                    }
                    msg.copy(reactions = reactions)
                } else msg
            }
        )
    }

    override fun onCleared() {
        super.onCleared()
        collectJob?.cancel()
        socketManager.disconnect()
    }
}
