package com.chatursa.app.ui.chat

import android.content.Context
import android.media.MediaPlayer
import android.util.Log
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.chatursa.app.ServerTls
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

@Composable
fun AudioPlayer(
    url: String,
    isOwn: Boolean,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    var isPlaying by remember { mutableStateOf(false) }
    var progress by remember { mutableFloatStateOf(0f) }
    var duration by remember { mutableIntStateOf(0) }
    var currentPosition by remember { mutableIntStateOf(0) }
    var localFile by remember(url) { mutableStateOf<File?>(null) }
    var player by remember(url) { mutableStateOf<MediaPlayer?>(null) }

    val bgColor = if (isOwn) Color.White.copy(alpha = 0.15f) else Color.Black.copy(alpha = 0.1f)
    val accentColor = if (isOwn) Color.White else Color(0xFF6C5CE7)
    val scope = rememberCoroutineScope()

    LaunchedEffect(url) {
        localFile = downloadToCache(context, url)
    }

    DisposableEffect(url) {
        onDispose {
            try { player?.release() } catch (_: Exception) {}
            player = null
        }
    }

    LaunchedEffect(isPlaying) {
        while (isPlaying) {
            try {
                val mp = player
                if (mp != null) {
                    currentPosition = mp.currentPosition
                    if (duration <= 0) duration = mp.duration
                    progress = if (duration > 0) currentPosition.toFloat() / duration else 0f
                }
            } catch (_: Exception) {}
            delay(200)
        }
    }

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp)),
        color = bgColor,
        shape = RoundedCornerShape(8.dp)
    ) {
        Row(
            modifier = Modifier
                .padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .background(accentColor.copy(alpha = 0.3f))
                    .clickable {
                        val mp = player
                        val currentlyPlaying = try { mp?.isPlaying == true } catch (_: Exception) { false }
                        when {
                            mp != null && currentlyPlaying -> {
                                try { mp.pause() } catch (_: Exception) {}
                                isPlaying = false
                            }
                            mp != null -> {
                                try {
                                    mp.start()
                                    isPlaying = true
                                } catch (_: Exception) {
                                    isPlaying = false
                                }
                            }
                            else -> scope.launch {
                                try {
                                    val file = localFile ?: downloadToCache(context, url) ?: return@launch
                                    localFile = file
                                    val newMp = MediaPlayer()
                                    newMp.setDataSource(file.absolutePath)
                                    newMp.prepare()
                                    duration = newMp.duration
                                    newMp.setOnCompletionListener { completed ->
                                        isPlaying = false
                                        progress = 0f
                                        currentPosition = 0
                                        try { completed.seekTo(0) } catch (_: Exception) {}
                                    }
                                    newMp.start()
                                    player = newMp
                                    isPlaying = true
                                } catch (e: Exception) {
                                    Log.e("AudioPlayer", "Play failed: $url", e)
                                    isPlaying = false
                                }
                            }
                        }
                    },
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                    contentDescription = if (isPlaying) "Пауза" else "Воспроизвести",
                    tint = accentColor,
                    modifier = Modifier.size(20.dp)
                )
            }

            Spacer(modifier = Modifier.width(8.dp))

            Column(modifier = Modifier.weight(1f)) {
                LinearProgressIndicator(
                    progress = { progress },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(4.dp)
                        .clip(RoundedCornerShape(2.dp)),
                    color = accentColor,
                    trackColor = Color.White.copy(alpha = 0.2f),
                )
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = formatDuration(if (isPlaying) currentPosition else duration),
                    style = MaterialTheme.typography.labelSmall,
                    color = accentColor.copy(alpha = 0.7f),
                    fontSize = 10.sp
                )
            }
        }
    }
}

private suspend fun downloadToCache(context: Context, url: String): File? =
    withContext(Dispatchers.IO) {
        try {
            val client = ServerTls.okHttpClient(context)
            val request = okhttp3.Request.Builder().url(url).build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@withContext null
                val body = response.body ?: return@withContext null
                val file = File(context.cacheDir, "audio_${url.hashCode()}.m4a")
                file.outputStream().use { body.byteStream().copyTo(it) }
                file
            }
        } catch (e: Exception) {
            Log.e("AudioPlayer", "Download failed: $url", e)
            null
        }
    }

private fun formatDuration(ms: Int): String {
    if (ms <= 0) return "0:00"
    val totalSec = ms / 1000
    val min = totalSec / 60
    val sec = totalSec % 60
    return "$min:${sec.toString().padStart(2, '0')}"
}
