package com.chatursa.app.data.model

data class User(
    val id: String = "",
    val username: String = "",
    val email: String = "",
    val avatar: String? = null,
    val fullName: String? = null,
    val statusText: String? = null,
    val status: String = "offline",
    val isAdmin: Boolean = false,
    val mobilePhone: String? = null,
    val about: String? = null,
    val lastSeen: String? = null
)

data class ChatParticipant(
    val id: String = "",
    val username: String = "",
    val avatar: String? = null,
    val status: String = "offline",
    val statusText: String? = null,
    val fullName: String? = null,
    val lastSeen: String? = null,
    val role: String = "member"
)

data class Chat(
    val id: String = "",
    val type: String = "direct",
    val name: String = "",
    val avatar: String? = null,
    val lastMessage: Message? = null,
    val unreadCount: Int = 0,
    val participants: List<String> = emptyList(),
    val participantNames: Map<String, String> = emptyMap(),
    val participantsDetails: List<ChatParticipant> = emptyList(),
    val lastActivity: String? = null,
    val isOnline: Boolean = false,
    val createdBy: String? = null,
    val lastSeen: String? = null,
    val pinned: Boolean = false,
    val muted: Boolean = false,
    val forceUnread: Boolean = false,
    val restricted: Boolean = false,
    val description: String? = null,
    val announcement: String? = null,
    val e2ee: Boolean = false
)

data class Message(
    val id: String = "",
    val chatId: String = "",
    val senderId: String = "",
    val senderName: String = "",
    val senderAvatar: String? = null,
    val text: String = "",
    val fileData: FileData? = null,
    val replyTo: ReplyTo? = null,
    val forwardedFrom: ForwardedFrom? = null,
    val timestamp: String = "",
    val readAt: String? = null,
    val edited: Boolean = false,
    val reactions: List<Reaction> = emptyList(),
    val isPinned: Boolean = false,
    val isSystem: Boolean = false,
    val expiresAt: String? = null,
    val replyCount: Int = 0,
    val localId: String? = null,
    val status: String = "sent"
)

data class FileData(
    val name: String = "",
    val url: String = "",
    val size: Long = 0,
    val mimetype: String = ""
)

data class ReplyTo(
    val messageId: String = "",
    val text: String = "",
    val senderName: String = ""
)

data class ForwardedFrom(
    val senderId: String = "",
    val senderName: String = "",
    val messageId: String = ""
)

data class Reaction(
    val userId: String = "",
    val emoji: String = "",
    val userName: String = ""
)
