package com.chatursa.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.chatursa.app.avatarUrl

private val avatarColors = listOf(
    0xFF6C5CE7, 0xFF00B894, 0xFFE17055, 0xFF0984E3,
    0xFFFDCB6E, 0xFFE84393, 0xFF00CEC9, 0xFFD63031,
    0xFF636E72, 0xFFA29BFE, 0xFF55EFC4, 0xFFFD79A8
)

private fun colorForName(name: String?): Color {
    val n = name?.trim()?.ifBlank { null } ?: "?"
    val idx = kotlin.math.abs(n.hashCode()) % avatarColors.size
    return Color(avatarColors[idx])
}

private fun initials(name: String?): String {
    val n = name?.trim()?.ifBlank { null } ?: return "?"
    val parts = n.split(" ").filter { it.isNotBlank() }
    return when {
        parts.size >= 2 -> "${parts[0].first().uppercaseChar()}${parts[1].first().uppercaseChar()}"
        else -> n.take(2).uppercase()
    }
}

@Composable
fun ChatAvatar(
    avatarUrl: String?,
    name: String?,
    size: Dp,
    modifier: Modifier = Modifier
) {
    val bgColor = remember(name) { colorForName(name) }
    val initialsText = remember(name) { initials(name) }

    Box(
        modifier = modifier
            .size(size)
            .clip(CircleShape)
            .background(bgColor),
        contentAlignment = Alignment.Center
    ) {
        if (!avatarUrl.isNullOrBlank()) {
            AsyncImage(
                model = avatarUrl,
                contentDescription = name,
                modifier = Modifier
                    .size(size)
                    .clip(CircleShape),
                contentScale = ContentScale.Crop
            )
        } else {
            Text(
                text = initialsText,
                color = Color.White,
                fontSize = (size.value * 0.4).sp,
                fontWeight = FontWeight.Bold
            )
        }
    }
}

fun chatAvatarUrl(
    chatAvatar: String?,
    chatName: String?,
    size: Int = 128
): String {
    return chatAvatar ?: avatarUrl(chatName ?: "?", size)
}
