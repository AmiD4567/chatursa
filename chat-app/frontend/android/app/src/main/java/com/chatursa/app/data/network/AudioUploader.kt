package com.chatursa.app.data.network

import com.chatursa.app.AppConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

data class UploadResult(
    val filename: String,
    val url: String,
    val size: Long,
    val mimetype: String
)

class AudioUploader {

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    suspend fun upload(file: File): UploadResult? = withContext(Dispatchers.IO) {
        try {
            val body = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("file", file.name, file.asRequestBody("audio/mp4".toMediaTypeOrNull()))
                .build()

            val request = Request.Builder()
                .url("${AppConfig.SERVER_URL}/upload")
                .post(body)
                .build()

            val response = client.newCall(request).execute()
            if (!response.isSuccessful) return@withContext null

            val json = JSONObject(response.body?.string() ?: return@withContext null)
            UploadResult(
                filename = json.optString("filename", file.name),
                url = json.optString("url", ""),
                size = json.optLong("size", file.length()),
                mimetype = json.optString("mimetype", "audio/mp4")
            )
        } catch (e: Exception) {
            android.util.Log.e("AudioUploader", "Upload failed", e)
            null
        }
    }
}
