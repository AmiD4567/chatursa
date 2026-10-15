package com.chatursa.app.ui.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.chatursa.app.data.model.Chat
import com.chatursa.app.data.model.User
import com.chatursa.app.ui.ChatAvatar
import com.chatursa.app.ui.theme.Purple500
import com.chatursa.app.ui.theme.TextSecondary

@Composable
fun GroupInfoDialog(
    chat: Chat?,
    users: List<User>,
    currentUserId: String?,
    onDismiss: () -> Unit,
    onAvatarClick: (String) -> Unit
) {
    if (chat == null) return

    val members = chat.participants.map { name ->
        users.find { it.username.equals(name, ignoreCase = true) } ?: User(username = name)
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                ChatAvatar(
                    avatarUrl = chat.avatar,
                    name = chat.name,
                    size = 80.dp,
                    modifier = Modifier.clickable { chat.avatar?.let { onAvatarClick(it) } }
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(chat.name.ifBlank { "Группа" }, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text(
                    text = "Участников: ${members.size}",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextSecondary
                )
            }
        },
        text = {
            Column {
                if (chat.e2ee) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 4.dp)) {
                        Icon(Icons.Default.Lock, null, tint = Purple500, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Сквозное шифрование", style = MaterialTheme.typography.bodySmall, color = Purple500)
                    }
                }
                if (chat.restricted) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 4.dp)) {
                        Icon(Icons.Default.PushPin, null, tint = TextSecondary, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Писать могут только админы", style = MaterialTheme.typography.bodySmall, color = TextSecondary)
                    }
                }
                if (!chat.description.isNullOrBlank()) {
                    Text(chat.description, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(bottom = 8.dp))
                }
                if (!chat.announcement.isNullOrBlank()) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 4.dp)) {
                        Icon(Icons.Default.Campaign, null, tint = Purple500, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Объявление", style = MaterialTheme.typography.labelMedium, color = Purple500)
                    }
                    Text(chat.announcement, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(bottom = 8.dp))
                }

                HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))

                LazyColumn(modifier = Modifier.heightIn(max = 260.dp)) {
                    items(members, key = { it.id.ifBlank { it.username } }) { member ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            ChatAvatar(avatarUrl = member.avatar, name = member.username, size = 36.dp)
                            Spacer(modifier = Modifier.width(10.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(member.username.ifBlank { "Участник" }, style = MaterialTheme.typography.bodyMedium)
                                val sub = when {
                                    member.id == chat.createdBy -> "Владелец"
                                    member.id == currentUserId -> "Вы"
                                    member.statusText != null -> member.statusText
                                    else -> null
                                }
                                if (sub != null) {
                                    Text(sub, style = MaterialTheme.typography.bodySmall, color = TextSecondary)
                                }
                            }
                            if (member.status == "online") {
                                Text("в сети", style = MaterialTheme.typography.labelSmall, color = Purple500)
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("Закрыть") }
        },
        containerColor = MaterialTheme.colorScheme.surface,
        tonalElevation = 8.dp
    )
}
