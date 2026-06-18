package com.chatursa.app.data.network

import com.chatursa.app.data.model.*
import okhttp3.MultipartBody
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.*

interface ApiService {

    @POST("api/login")
    suspend fun login(@Body request: LoginRequest): Response<LoginResponse>

    @POST("api/register")
    suspend fun register(@Body request: RegisterRequest): Response<LoginResponse>

    @GET("api/users")
    suspend fun getUsers(): Response<List<UserListResponse>>

    @GET("api/profile/{userId}")
    suspend fun getProfile(@Path("userId") userId: String): Response<ProfileResponse>

    @GET("api/messages/{chatId}")
    suspend fun getMessages(
        @Path("chatId") chatId: String,
        @Query("userId") userId: String
    ): Response<MessagesResponse>

    @POST("api/messages")
    suspend fun sendMessage(@Body body: Map<String, String>): Response<Map<String, Any>>

    @POST("api/upload-avatar")
    suspend fun uploadAvatar(@Part avatar: MultipartBody.Part): Response<Map<String, Any>>

    @GET("api/health")
    suspend fun healthCheck(): Response<HealthResponse>

    @PUT("api/profile")
    suspend fun updateProfile(@Body body: Map<String, String?>): Response<Map<String, Any>>

    @GET("api/link-preview")
    suspend fun getLinkPreview(@Query("url") url: String): Response<LinkPreview>

    @POST("api/push/fcm/register")
    suspend fun registerFcmToken(@Body body: Map<String, String>): Response<Map<String, Any>>
}
