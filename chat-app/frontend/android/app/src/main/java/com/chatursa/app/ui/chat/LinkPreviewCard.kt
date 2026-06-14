package com.chatursa.app.ui.chat

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.chatursa.app.data.model.LinkPreview

@Composable
fun LinkPreviewCard(preview: LinkPreview, isOwn: Boolean) {
    val context = LocalContext.current
    val bgColor = if (isOwn) Color.White.copy(alpha = 0.15f) else Color.Black.copy(alpha = 0.1f)

    if (!preview.success && preview.title.isBlank()) return

    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .clickable {
                try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(preview.url))
                    context.startActivity(intent)
                } catch (_: Exception) {}
            },
        color = bgColor,
        shape = RoundedCornerShape(8.dp)
    ) {
        Column {
            if (!preview.image.isNullOrBlank()) {
                AsyncImage(
                    model = preview.image,
                    contentDescription = null,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 150.dp)
                        .clip(RoundedCornerShape(topStart = 8.dp, topEnd = 8.dp)),
                    contentScale = ContentScale.Crop
                )
            }
            Column(modifier = Modifier.padding(8.dp)) {
                if (preview.title.isNotBlank()) {
                    Text(
                        text = preview.title,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = Color.White,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                if (!preview.description.isNullOrBlank()) {
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(
                        text = preview.description,
                        style = MaterialTheme.typography.bodySmall,
                        color = Color.White.copy(alpha = 0.7f),
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                if (preview.title.isNotBlank() || !preview.description.isNullOrBlank()) {
                    Spacer(modifier = Modifier.height(2.dp))
                }
                Text(
                    text = try {
                        Uri.parse(preview.url).host ?: preview.url
                    } catch (_: Exception) { preview.url },
                    style = MaterialTheme.typography.labelSmall,
                    color = Color.White.copy(alpha = 0.5f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}
