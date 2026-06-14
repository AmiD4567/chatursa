package com.chatursa.app.data.model

import com.google.gson.annotations.SerializedName

data class LoginRequest(
    val email: String,
    val password: String
)

data class RegisterRequest(
    val username: String,
    val email: String,
    val password: String,
    @SerializedName("confirmPassword") val confirmPassword: String,
    @SerializedName("birthDate") val birthDate: String
)

data class LoginResponse(
    val user: User? = null,
    val error: String? = null
)

data class ProfileResponse(
    val id: String = "",
    val username: String = "",
    val email: String = "",
    val avatar: String? = null,
    val full_name: String? = null,
    val status_text: String? = null,
    val is_admin: Boolean = false,
    val mobile_phone: String? = null,
    val about: String? = null,
    val status: String = "offline"
)

data class UserListResponse(
    val id: String = "",
    val username: String = "",
    val avatar: String? = null
)

data class MessagesResponse(
    val messages: List<Message> = emptyList()
)

data class HealthResponse(
    val status: String = "",
    val uptime: Double = 0.0
)

data class SocketJoinedResponse(
    val user: User? = null,
    val chats: List<Chat>? = null,
    val error: String? = null
)

data class CreateChatData(
    val type: String,
    val name: String?,
    val participants: List<String>
)

data class LinkPreview(
    val success: Boolean = false,
    val title: String = "",
    val description: String? = null,
    val image: String? = null,
    val url: String = ""
)
