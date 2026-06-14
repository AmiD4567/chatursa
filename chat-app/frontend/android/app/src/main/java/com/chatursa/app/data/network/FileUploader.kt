package com.chatursa.app.data.network

import android.content.Context
import android.net.Uri
import com.chatursa.app.AppConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class FileUploader {

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    suspend fun upload(context: Context, uri: Uri, mimeType: String): UploadResult? = withContext(Dispatchers.IO) {
        try {
            val inputStream = context.contentResolver.openInputStream(uri) ?: return@withContext null
            val bytes = inputStream.readBytes().also { inputStream.close() }
            val fileName = getFileName(context, uri, mimeType)

            val body = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("file", fileName, bytes.toRequestBody(mimeType.toMediaTypeOrNull()))
                .build()

            val request = Request.Builder()
                .url("${AppConfig.SERVER_URL}/upload")
                .post(body)
                .build()

            val response = client.newCall(request).execute()
            if (!response.isSuccessful) return@withContext null

            val json = JSONObject(response.body?.string() ?: return@withContext null)
            UploadResult(
                filename = json.optString("filename", fileName),
                url = json.optString("url", ""),
                size = json.optLong("size", bytes.size.toLong()),
                mimetype = json.optString("mimetype", mimeType)
            )
        } catch (e: Exception) {
            android.util.Log.e("FileUploader", "Upload failed", e)
            null
        }
    }

    private fun getFileName(context: Context, uri: Uri, mimeType: String): String {
        var name = "file"
        try {
            val cursor = context.contentResolver.query(uri, null, null, null, null)
            cursor?.use {
                if (it.moveToFirst()) {
                    val idx = it.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0) name = it.getString(idx)
                }
            }
        } catch (_: Exception) {}
        if (name == "file") {
            val ext = when {
                mimeType.startsWith("image/") -> ".jpg"
                mimeType.startsWith("video/") -> ".mp4"
                mimeType.startsWith("audio/") -> ".m4a"
                mimeType.contains("pdf") -> ".pdf"
                else -> ""
            }
            name = "file$ext"
        }
        return name
    }
}
