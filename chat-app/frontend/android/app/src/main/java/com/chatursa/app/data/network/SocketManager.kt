package com.chatursa.app.data.network

import android.util.Log
import com.chatursa.app.AppConfig
import com.chatursa.app.data.model.Chat
import com.chatursa.app.data.model.FileData
import com.chatursa.app.data.model.ForwardedFrom
import com.chatursa.app.data.model.Message
import com.chatursa.app.data.model.Reaction
import com.chatursa.app.data.model.ReplyTo
import com.chatursa.app.data.model.User
import io.socket.client.IO
import io.socket.client.Socket
import io.socket.engineio.client.transports.WebSocket
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

sealed class SocketEvent {
    data class Connected(val user: User, val chats: List<Chat>) : SocketEvent()
    data class NewMessage(val message: Message, val chat: Chat? = null) : SocketEvent()
    data class ChatHistory(val chatId: String, val messages: List<Message>, val chat: Chat? = null) : SocketEvent()
    data class ChatCreated(val chat: Chat) : SocketEvent()
    data class ChatUpdated(val chat: Chat) : SocketEvent()
    data class UserStatusChanged(val userId: String, val status: String, val lastSeen: String? = null) : SocketEvent()
    data class UserTyping(val chatId: String, val userId: String, val userName: String) : SocketEvent()
    data class UsersList(val users: List<User>) : SocketEvent()
    data class MessageDeleted(val chatId: String, val messageId: String) : SocketEvent()
    data class MessageEdited(val chatId: String, val messageId: String, val text: String) : SocketEvent()
    data class ReactionAdded(val messageId: String, val userId: String, val emoji: String, val userName: String) : SocketEvent()
    data class ReactionRemoved(val messageId: String, val userId: String, val emoji: String) : SocketEvent()
    data class MessagesRead(val chatId: String, val userId: String, val messageIds: List<String>) : SocketEvent()
    data class UserProfileUpdated(val userId: String, val username: String, val statusText: String, val fullName: String, val mobilePhone: String, val workPhone: String) : SocketEvent()
    data class MessagePinned(val chatId: String, val messageId: String, val message: Message? = null) : SocketEvent()
    data class MessageUnpinned(val chatId: String, val messageId: String) : SocketEvent()
    data class Error(val message: String) : SocketEvent()
    object Disconnected : SocketEvent()
}

class SocketManager {

    companion object {
        private const val TAG = "SocketManager"
    }

    private var socket: Socket? = null
    private val _events = Channel<SocketEvent>(Channel.BUFFERED)
    val events: Flow<SocketEvent> = _events.receiveAsFlow()

    private var currentUserId: String? = null
    private var currentUsername: String? = null
    private var activeUser: User? = null

    fun connect(user: User) {
        disconnect()

        currentUserId = user.id
        currentUsername = user.username
        activeUser = user

        try {
            val options = IO.Options.builder()
                .setForceNew(true)
                .setReconnection(true)
                .setReconnectionAttempts(Int.MAX_VALUE)
                .setReconnectionDelay(1000)
                .setReconnectionDelayMax(5000)
                .setTimeout(30000)
                .setTransports(arrayOf(WebSocket.NAME))
                .build()

            Log.d(TAG, "Connecting to ${AppConfig.SOCKET_URL}")
            socket = IO.socket(AppConfig.SOCKET_URL, options)

            socket?.on(Socket.EVENT_CONNECT) {
                Log.d(TAG, "EVENT_CONNECT fired")
                val u = activeUser ?: return@on
                socket?.emit("user_joined", JSONObject().apply {
                    put("userId", u.id)
                    put("email", u.email)
                    put("username", u.username)
                    put("avatar", u.avatar ?: JSONObject.NULL)
                })
            }

            socket?.on(Socket.EVENT_DISCONNECT) {
                Log.d(TAG, "EVENT_DISCONNECT fired")
                _events.trySend(SocketEvent.Disconnected)
            }

            socket?.on("reconnect_attempt") { args ->
                val attempt = if (args.isNotEmpty()) args[0].toString() else "?"
                Log.d(TAG, "reconnect_attempt: $attempt")
            }

            socket?.on("reconnect") {
                Log.d(TAG, "reconnect fired")
                val u = activeUser ?: return@on
                socket?.emit("user_joined", JSONObject().apply {
                    put("userId", u.id)
                    put("email", u.email)
                    put("username", u.username)
                    put("avatar", u.avatar ?: JSONObject.NULL)
                })
            }

            socket?.on("reconnect_error") { args ->
                val err = if (args.isNotEmpty()) args[0].toString() else "Unknown"
                Log.e(TAG, "reconnect_error: $err")
            }

            socket?.on(Socket.EVENT_CONNECT_ERROR) { args ->
                val err = if (args.isNotEmpty()) args[0].toString() else "Unknown"
                Log.e(TAG, "EVENT_CONNECT_ERROR: $err")
                _events.trySend(SocketEvent.Error("$err"))
            }

            socket?.on("user_joined_success") { args ->
                try {
                    Log.d(TAG, "user_joined_success received")
                    if (args.isNotEmpty()) {
                        val data = args[0] as JSONObject
                        val userJson = data.getJSONObject("user")
                        val pUser = parseUser(userJson)
                        val chats = if (data.has("chats") && !data.isNull("chats")) {
                            parseChats(data.getJSONArray("chats"), currentUsername)
                        } else emptyList()
                        Log.d(TAG, "Loaded ${chats.size} chats")
                        _events.trySend(SocketEvent.Connected(pUser, chats))
                        socket?.emit("get_users")
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "user_joined_success parse error", e)
                    _events.trySend(SocketEvent.Error("Ошибка данных: ${e.message}"))
                }
            }

            socket?.on("new_message") { args ->
                try {
                    if (args.isNotEmpty()) {
                        val data = args[0] as JSONObject
                        val msgJson = if (data.has("message")) data.getJSONObject("message") else data
                        // Чат может быть незнакомым (первое сообщение в direct-чате,
                        // созданном другим пользователем) — передаём его для upsert
                        val chatJson = if (data.has("chat") && !data.isNull("chat"))
                            data.getJSONObject("chat") else null
                        _events.trySend(SocketEvent.NewMessage(
                            parseMessage(msgJson),
                            chatJson?.let { parseChat(it, currentUsername) }
                        ))
                    }
                } catch (e: Exception) { Log.e(TAG, "new_message parse error", e) }
            }

            socket?.on("chat_history") { args ->
                try {
                    if (args.isNotEmpty()) {
                        val data = args[0] as JSONObject
                        val chatId = data.getString("chatId")
                        val msgs = if (data.has("messages") && !data.isNull("messages")) {
                            val arr = data.getJSONArray("messages")
                            (0 until arr.length()).map { parseMessage(arr.getJSONObject(it)) }
                        } else emptyList()
                        val chatObj = if (data.has("chat") && !data.isNull("chat")) {
                            parseChat(data.getJSONObject("chat"), currentUsername)
                        } else null
                        _events.trySend(SocketEvent.ChatHistory(chatId, msgs, chatObj))
                    }
                } catch (e: Exception) { Log.e(TAG, "chat_history parse error", e) }
            }

            socket?.on("chat_created") { args ->
                try {
                    if (args.isNotEmpty()) {
                        val data = args[0] as JSONObject
                        val chatJson = if (data.has("chat")) data.getJSONObject("chat") else data
                        _events.trySend(SocketEvent.ChatCreated(parseChat(chatJson, currentUsername)))
                    }
                } catch (e: Exception) { Log.e(TAG, "chat_created parse error", e) }
            }

            socket?.on("chat_updated") { args ->
                try {
                    if (args.isNotEmpty()) {
                        val data = args[0] as JSONObject
                        val chatJson = if (data.has("chat")) data.getJSONObject("chat") else data
                        _events.trySend(SocketEvent.ChatUpdated(parseChat(chatJson, currentUsername)))
                    }
                } catch (e: Exception) { Log.e(TAG, "chat_updated parse error", e) }
            }

            socket?.on("user_status_changed") { args ->
                try {
                    if (args.isNotEmpty()) {
                        val data = args[0] as JSONObject
                        _events.trySend(SocketEvent.UserStatusChanged(
                            data.getString("userId"),
                            data.optString("status", "offline"),
                            data.optString("last_seen", null)?.ifEmpty { null }
                        ))
                    }
                } catch (e: Exception) { Log.e(TAG, "user_status_changed parse error", e) }
            }

            socket?.on("user_typing") { args ->
                try {
                    if (args.isNotEmpty()) {
                        val data = args[0] as JSONObject
                        _events.trySend(SocketEvent.UserTyping(
                            data.getString("chatId"), data.getString("userId"),
                            data.optString("userName", "")
                        ))
                    }
                } catch (e: Exception) { Log.e(TAG, "user_typing parse error", e) }
            }

            socket?.on("users_list") { args ->
                try {
                    if (args.isNotEmpty()) {
                        val arr = args[0] as JSONArray
                        val users = (0 until arr.length()).map { parseUserListUser(arr.getJSONObject(it)) }
                        _events.trySend(SocketEvent.UsersList(users))
                    }
                } catch (e: Exception) { Log.e(TAG, "users_list parse error", e) }
            }

            socket?.on("message_deleted") { args ->
                try {
                    if (args.isNotEmpty()) {
                        val data = args[0] as JSONObject
                        _events.trySend(SocketEvent.MessageDeleted(
                            data.getString("chatId"), data.getString("messageId")
                        ))
                    }
                } catch (e: Exception) { Log.e(TAG, "message_deleted parse error", e) }
            }

            socket?.on("message_edited") { args ->
                try {
                    if (args.isNotEmpty()) {
                        val data = args[0] as JSONObject
                        _events.trySend(SocketEvent.MessageEdited(
                            data.getString("chatId"), data.getString("messageId"), data.optString("newText", "")
                        ))
                    }
                } catch (e: Exception) { Log.e(TAG, "message_edited parse error", e) }
            }

            socket?.on("user_profile_updated") { args ->
                try {
                    if (args.isNotEmpty()) {
                        val data = args[0] as JSONObject
                        _events.trySend(SocketEvent.UserProfileUpdated(
                            data.getString("userId"),
                            data.optString("username", ""),
                            data.optString("status_text", ""),
                            data.optString("full_name", ""),
                            data.optString("mobile_phone", ""),
                            data.optString("work_phone", "")
                        ))
                    }
                } catch (e: Exception) { Log.e(TAG, "user_profile_updated parse error", e) }
            }

            socket?.on("reaction_added") { args ->
                try {
                    if (args.isNotEmpty()) {
                        val data = args[0] as JSONObject
                        _events.trySend(SocketEvent.ReactionAdded(
                            data.getString("messageId"), data.getString("userId"),
                            data.getString("emoji"), data.optString("userName", "")
                        ))
                    }
                } catch (e: Exception) { Log.e(TAG, "reaction_added parse error", e) }
            }

            socket?.on("reaction_removed") { args ->
                try {
                    if (args.isNotEmpty()) {
                        val data = args[0] as JSONObject
                        _events.trySend(SocketEvent.ReactionRemoved(
                            data.getString("messageId"), data.getString("userId"), data.getString("emoji")
                        ))
                    }
                } catch (e: Exception) { Log.e(TAG, "reaction_removed parse error", e) }
            }

            socket?.on("messages_read") { args ->
                try {
                    if (args.isNotEmpty()) {
                        val data = args[0] as JSONObject
                        val ids = if (data.has("messageIds")) {
                            val arr = data.getJSONArray("messageIds")
                            (0 until arr.length()).map { arr.getString(it) }
                        } else emptyList()
                        _events.trySend(SocketEvent.MessagesRead(
                            data.getString("chatId"), data.getString("userId"), ids
                        ))
                    }
                } catch (e: Exception) { Log.e(TAG, "messages_read parse error", e) }
            }

            socket?.on("message_pinned") { args ->
                try {
                    if (args.isNotEmpty()) {
                        val data = args[0] as JSONObject
                        val chatId = data.optString("chatId", "")
                        val messageId = data.optString("messageId", "")
                        val msg = if (data.has("message") && !data.isNull("message"))
                            parseMessage(data.getJSONObject("message")) else null
                        _events.trySend(SocketEvent.MessagePinned(chatId, messageId, msg))
                    }
                } catch (e: Exception) { Log.e(TAG, "message_pinned parse error", e) }
            }

            socket?.on("message_unpinned") { args ->
                try {
                    if (args.isNotEmpty()) {
                        val data = args[0] as JSONObject
                        _events.trySend(SocketEvent.MessageUnpinned(
                            data.optString("chatId", ""), data.optString("messageId", "")
                        ))
                    }
                } catch (e: Exception) { Log.e(TAG, "message_unpinned parse error", e) }
            }

            socket?.connect()
            Log.d(TAG, "Socket connect() called")
        } catch (e: Exception) {
            Log.e(TAG, "Error creating socket", e)
            _events.trySend(SocketEvent.Error("Ошибка: ${e.message}"))
        }
    }

    fun disconnect() {
        socket?.off()
        socket?.disconnect()
        socket = null
        currentUserId = null
        currentUsername = null
        activeUser = null
    }

    fun joinChat(chatId: String) {
        socket?.emit("join_chat", chatId)
    }

    fun sendMessage(chatId: String, text: String, replyTo: String? = null, file: JSONObject? = null) {
        socket?.emit("send_message", JSONObject().apply {
            put("chatId", chatId)
            put("senderId", currentUserId)
            put("text", text)
            if (replyTo != null) put("replyTo", replyTo)
            if (file != null) put("file", file)
        })
    }

    fun markRead(chatId: String, messageIds: List<String>) {
        socket?.emit("mark_read", JSONObject().apply {
            put("chatId", chatId)
            put("userId", currentUserId)
            put("messageIds", JSONArray(messageIds))
        })
    }

    fun sendTyping(chatId: String, isTyping: Boolean) {
        socket?.emit("typing", JSONObject().apply {
            put("chatId", chatId)
            put("userId", currentUserId)
            put("isTyping", isTyping)
        })
    }

    fun createChat(participants: List<String>, type: String = "direct", name: String? = null) {
        socket?.emit("create_chat", JSONObject().apply {
            put("type", type)
            put("participants", JSONArray(participants))
            if (name != null) put("name", name)
        })
    }

    fun addReaction(messageId: String, emoji: String) {
        socket?.emit("add_reaction", JSONObject().apply {
            put("messageId", messageId)
            put("userId", currentUserId)
            put("emoji", emoji)
        })
    }

    fun removeReaction(messageId: String, emoji: String) {
        socket?.emit("remove_reaction", JSONObject().apply {
            put("messageId", messageId)
            put("userId", currentUserId)
            put("emoji", emoji)
        })
    }

    fun editMessage(messageId: String, newText: String) {
        socket?.emit("edit_message", JSONObject().apply {
            put("messageId", messageId)
            put("newText", newText)
        })
    }

    fun deleteMessage(messageId: String) {
        socket?.emit("delete_message", JSONObject().apply {
            put("messageId", messageId)
        })
    }

    fun forwardMessage(messageId: String, targetUserId: String) {
        socket?.emit("forward_message", JSONObject().apply {
            put("messageId", messageId)
            put("targetUserId", targetUserId)
        })
    }

    fun pinMessage(messageId: String) {
        socket?.emit("pin_message", JSONObject().apply {
            put("messageId", messageId)
        })
    }

    fun unpinMessage(messageId: String) {
        socket?.emit("unpin_message", JSONObject().apply {
            put("messageId", messageId)
        })
    }

    fun getUsers() {
        socket?.emit("get_users")
    }

    private fun parseUser(json: JSONObject) = User(
        id = json.getString("id"),
        username = json.getString("username"),
        email = json.optString("email", ""),
        avatar = json.optString("avatar", null)?.ifEmpty { null },
        status = json.optString("status", "offline")
    )

    private fun parseUserListUser(json: JSONObject) = User(
        id = json.getString("id"),
        username = json.getString("username"),
        avatar = json.optString("avatar", null)?.ifEmpty { null },
        email = json.optString("email", ""),
        fullName = json.optString("full_name", null)?.ifEmpty { null },
        statusText = json.optString("status_text", null)?.ifEmpty { null },
        status = json.optString("status", "offline"),
        mobilePhone = json.optString("mobile_phone", null)?.ifEmpty { null },
        about = json.optString("about", null)?.ifEmpty { null },
        lastSeen = json.optString("last_seen", null)?.ifEmpty { null }
    )

    private fun parseChat(json: JSONObject, opUsername: String? = null): Chat {
        val participants = if (json.has("participants") && !json.isNull("participants")) {
            val arr = json.getJSONArray("participants")
            (0 until arr.length()).map { arr.getString(it) }
        } else emptyList()

        val pNames = if (json.has("participantNames") && !json.isNull("participantNames")) {
            val obj = json.getJSONObject("participantNames")
            val keys = obj.keys()
            val m = mutableMapOf<String, String>()
            while (keys.hasNext()) { val k = keys.next() as String; m[k] = obj.getString(k) }
            m
        } else emptyMap()

        val type = json.optString("type", "direct")
        var name = json.optString("name", "")
        var avatar = json.optString("avatar", null)?.ifEmpty { null }

        var otherStatus: String? = null
        var lastSeen: String? = null

        // For direct chats, find the other participant and use their data
        if (type == "direct" && json.has("participantsDetails") && !json.isNull("participantsDetails")) {
            val arr = json.getJSONArray("participantsDetails")
            val uname = opUsername ?: currentUsername ?: ""
            var other: JSONObject? = null
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                if (!o.optString("username", "").equals(uname, ignoreCase = true)) {
                    other = o
                    break
                }
            }
            if (other != null) {
                val otherName = other.optString("username", "")
                val otherAvatar = other.optString("avatar", null)?.ifEmpty { null }
                if (name.isBlank()) name = otherName
                if (avatar.isNullOrBlank()) avatar = otherAvatar
                otherStatus = other.optString("status", null)?.ifEmpty { null }
                lastSeen = other.optString("last_seen", null)?.ifEmpty { null }
            } else {
                // Fallback: use first non-self participant name from participant list
                val selfIdx = participants.indexOfFirst { it.equals(uname, ignoreCase = true) }
                if (name.isBlank() && participants.size > 1) {
                    name = if (selfIdx == 0) participants[1] else participants.firstOrNull() ?: ""
                }
            }
        }

        return Chat(
            id = json.getString("id"),
            type = type,
            name = name,
            avatar = avatar,
            lastMessage = if (json.has("lastMessage") && !json.isNull("lastMessage"))
                parseMessage(json.getJSONObject("lastMessage")) else null,
            unreadCount = json.optInt("unreadCount", 0),
            participants = participants,
            participantNames = pNames,
            lastActivity = json.optString("lastActivity", null),
            createdBy = json.optString("createdBy", null),
            isOnline = otherStatus == "online",
            lastSeen = lastSeen
        )
    }

    private fun parseChats(arr: JSONArray, opUsername: String? = null) =
        (0 until arr.length()).map { parseChat(arr.getJSONObject(it), opUsername) }

    private fun parseMessage(json: JSONObject): Message {
        val reactions: List<Reaction> = if (json.has("reactions") && !json.isNull("reactions")) {
            val raw = json.get("reactions")
            val list = mutableListOf<Reaction>()
            if (raw is JSONObject) {
                val keys = raw.keys()
                while (keys.hasNext()) {
                    val emoji = keys.next() as String
                    val users = raw.getJSONArray(emoji)
                    for (i in 0 until users.length()) {
                        val u = users.getJSONObject(i)
                        list.add(Reaction(u.getString("userId"), emoji, u.optString("username", "")))
                    }
                }
            } else if (raw is JSONArray) {
                for (i in 0 until raw.length()) {
                    val r = raw.getJSONObject(i)
                    list.add(Reaction(r.getString("userId"), r.getString("emoji"), r.optString("userName", "")))
                }
            }
            list
        } else emptyList()

        // Parse file field (server sends "file", not "fileData")
        val fileData: FileData? = if (json.has("file") && !json.isNull("file")) {
            val f = json.getJSONObject("file")
            FileData(
                name = f.optString("name", f.optString("filename", "")),
                url = f.optString("url", ""),
                size = f.optLong("size", 0),
                mimetype = f.optString("mimetype", f.optString("mime_type", ""))
            )
        } else null

        // Parse reply_to
        val replyTo: ReplyTo? = if (json.has("reply_to") && !json.isNull("reply_to")) {
            try {
                val r = json.getJSONObject("reply_to")
                ReplyTo(
                    messageId = r.optString("messageId", r.optString("id", "")),
                    text = r.optString("text", ""),
                    senderName = r.optString("senderName", r.optString("sender_name", ""))
                )
            } catch (e: Exception) { null }
        } else null

        // Parse forwarded_from
        val forwardedFrom: ForwardedFrom? = if (json.has("forwarded_from") && !json.isNull("forwarded_from")) {
            try {
                val f = json.getJSONObject("forwarded_from")
                ForwardedFrom(
                    senderId = f.optString("senderId", f.optString("sender_id", "")),
                    senderName = f.optString("senderName", f.optString("sender_name", "")),
                    messageId = f.optString("messageId", f.optString("id", ""))
                )
            } catch (e: Exception) { null }
        } else null

        return Message(
            id = json.optString("id", ""),
            chatId = json.optString("chatId", ""),
            senderId = json.optString("senderId", ""),
            senderName = json.optString("senderName", ""),
            senderAvatar = json.optString("senderAvatar", null)?.ifEmpty { null },
            text = json.optString("text", ""),
            fileData = fileData,
            replyTo = replyTo,
            forwardedFrom = forwardedFrom,
            timestamp = json.optString("timestamp", ""),
            readAt = json.optString("readAt", json.optString("read_at", null)),
            edited = json.optBoolean("edited", false),
            reactions = reactions,
            isPinned = json.optBoolean("isPinned", false)
        )
    }
}
