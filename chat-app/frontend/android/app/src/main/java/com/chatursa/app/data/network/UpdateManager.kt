package com.chatursa.app.data.network

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

data class UpdateInfo(
    val hasUpdate: Boolean,
    val latestVersion: String = "",
    val downloadUrl: String = "",
    val releaseUrl: String = "",
    val releaseNotes: String = ""
)

class UpdateManager(private val context: Context) {

    companion object {
        private const val TAG = "UpdateManager"
        private const val APK_MIME = "application/vnd.android.package-archive"
        private const val FILE_PROVIDER_AUTHORITY = "com.chatursa.app.fileprovider"
    }

    suspend fun checkForUpdates(): UpdateInfo = withContext(Dispatchers.IO) {
        try {
            val url = URL("https://api.github.com/repos/${com.chatursa.app.AppConfig.GITHUB_REPO_OWNER}/${com.chatursa.app.AppConfig.GITHUB_REPO_NAME}/releases?per_page=10")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.setRequestProperty("Accept", "application/vnd.github.v3+json")
            conn.connectTimeout = 10000
            conn.readTimeout = 10000

            val response = conn.inputStream.bufferedReader().readText()
            conn.disconnect()

            val arr = org.json.JSONArray(response)
            val currentVersion = com.chatursa.app.AppConfig.APP_VERSION

            var latestTag = ""
            var downloadUrl = ""
            var releaseUrl = ""
            var notes = ""

            for (i in 0 until arr.length()) {
                val release = arr.getJSONObject(i)
                val tag = release.optString("tag_name", "").removePrefix("v")
                if (compareVersions(tag, currentVersion) <= 0) continue
                if (compareVersions(tag, latestTag) <= 0) continue

                // Found a newer version, check for APK asset
                val assets = release.optJSONArray("assets")
                var assetUrl = ""
                if (assets != null) {
                    for (j in 0 until assets.length()) {
                        val asset = assets.getJSONObject(j)
                        if (asset.optString("name", "").endsWith(".apk")) {
                            assetUrl = asset.optString("browser_download_url", "")
                            break
                        }
                    }
                }
                if (assetUrl.isBlank()) continue

                latestTag = tag
                downloadUrl = assetUrl
                releaseUrl = release.optString("html_url", "")
                notes = release.optString("body", "")
            }

            // Fallback: construct URL from tag
            if (downloadUrl.isBlank() && latestTag.isNotBlank()) {
                downloadUrl = "https://github.com/${com.chatursa.app.AppConfig.GITHUB_REPO_OWNER}/${com.chatursa.app.AppConfig.GITHUB_REPO_NAME}/releases/download/v$latestTag/chatursa-$latestTag-debug.apk"
            }

            val hasUpdate = latestTag.isNotBlank()

            UpdateInfo(
                hasUpdate = hasUpdate,
                latestVersion = latestTag,
                downloadUrl = downloadUrl,
                releaseUrl = releaseUrl,
                releaseNotes = notes
            )
        } catch (e: Exception) {
            android.util.Log.e(TAG, "Check update failed", e)
            UpdateInfo(hasUpdate = false)
        }
    }

    fun downloadAndInstall(updateInfo: UpdateInfo) {
        try {
            val apkFile = File(context.cacheDir, "update-${updateInfo.latestVersion}.apk")
            if (apkFile.exists()) apkFile.delete()

            val downloadManager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val uri = Uri.parse(updateInfo.downloadUrl)
            val request = DownloadManager.Request(uri).apply {
                setTitle("ChatUrsa v${updateInfo.latestVersion}")
                setDescription("Загрузка обновления...")
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                setDestinationInExternalFilesDir(context, null, "ChatUrsa-update.apk")
                setMimeType(APK_MIME)
            }
            downloadManager.enqueue(request)

            // Also download directly for immediate install
            Thread {
                try {
                    val conn = URL(updateInfo.downloadUrl).openConnection()
                    val inputStream = conn.getInputStream()
                    val outputStream = apkFile.outputStream()
                    inputStream.copyTo(outputStream)
                    inputStream.close()
                    outputStream.close()

                    // Install
                    val uri = FileProvider.getUriForFile(context, FILE_PROVIDER_AUTHORITY, apkFile)
                    val intent = Intent(Intent.ACTION_VIEW).apply {
                        setDataAndType(uri, APK_MIME)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    context.startActivity(intent)
                } catch (e: Exception) {
                    android.util.Log.e(TAG, "Direct download failed", e)
                }
            }.start()
        } catch (e: Exception) {
            android.util.Log.e(TAG, "Download failed", e)
            // Fallback: open browser
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(updateInfo.downloadUrl)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        }
    }

    private fun compareVersions(v1: String, v2: String): Int {
        val parts1 = v1.split(".").map { it.toIntOrNull() ?: 0 }
        val parts2 = v2.split(".").map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(parts1.size, parts2.size)) {
            val a = parts1.getOrElse(i) { 0 }
            val b = parts2.getOrElse(i) { 0 }
            if (a != b) return a - b
        }
        return 0
    }
}