package com.chatursa.app.ui.chatlist

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.chatursa.app.AppConfig
import com.chatursa.app.avatarUrl
import com.chatursa.app.data.model.Chat
import com.chatursa.app.data.sticker.StickerManager
import com.chatursa.app.ui.ChatAvatar
import com.chatursa.app.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatListScreen(
    viewModel: ChatListViewModel,
    onChatClick: (Chat) -> Unit,
    onLogout: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    var showSearch by remember { mutableStateOf(false) }
    var searchText by remember { mutableStateOf("") }
    var showUsersDialog by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize()) {
        TopAppBar(
            title = {
                if (showSearch) {
                    OutlinedTextField(
                        value = searchText,
                        onValueChange = {
                            searchText = it
                            viewModel.searchChats(it)
                        },
                        placeholder = { Text("Поиск...") },
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Color.Transparent,
                            unfocusedBorderColor = Color.Transparent,
                            focusedContainerColor = Color.Transparent,
                            unfocusedContainerColor = Color.Transparent
                        ),
                        modifier = Modifier.fillMaxWidth()
                    )
                } else {
                    Text("Чаты", fontWeight = FontWeight.Bold)
                }
            },
            actions = {
                if (showSearch) {
                    IconButton(onClick = {
                        showSearch = false
                        searchText = ""
                        viewModel.searchChats("")
                    }) {
                        Icon(Icons.Default.Close, "Закрыть поиск")
                    }
                } else {
                    IconButton(onClick = { showSearch = true }) {
                        Icon(Icons.Default.Search, "Поиск")
                    }
                    IconButton(onClick = { showUsersDialog = true }) {
                        Icon(Icons.Default.Create, "Новый чат")
                    }
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = MaterialTheme.colorScheme.surface,
                titleContentColor = MaterialTheme.colorScheme.onSurface
            )
        )

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
        ) {
            if (uiState.isConnecting) {
                Column(
                    modifier = Modifier.align(Alignment.Center),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    CircularProgressIndicator(color = Purple500)
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(
                        "Подключение...",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    if (uiState.error != null) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = uiState.error!!,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                }
            } else if (!uiState.isConnected) {
                Column(
                    modifier = Modifier.align(Alignment.Center),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Icon(
                        Icons.Default.CloudOff,
                        contentDescription = null,
                        modifier = Modifier.size(64.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(
                        if (uiState.error != null) "Ошибка: ${uiState.error}"
                        else "Нет подключения к серверу",
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (uiState.error != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Button(
                        onClick = {
                            viewModel.disconnect()
                            uiState.currentUser?.let { viewModel.connect(it) }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Purple500)
                    ) {
                        Text("Переподключиться")
                    }
                }
            } else {
                val filteredChats = viewModel.getFilteredChats()

                if (filteredChats.isEmpty()) {
                    Column(
                        modifier = Modifier.align(Alignment.Center),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(
                            Icons.Default.Chat,
                            contentDescription = null,
                            modifier = Modifier.size(64.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            if (searchText.isNotEmpty()) "Ничего не найдено"
                            else "Нет чатов. Начните общение!",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                } else {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize()
                    ) {
                        items(filteredChats, key = { it.id }) { chat ->
                            val dismissState = rememberSwipeToDismissBoxState(
                                confirmValueChange = { dismissValue ->
                                    if (dismissValue == SwipeToDismissBoxValue.EndToStart) {
                                        viewModel.pendingDeleteChat = chat
                                        false
                                    } else false
                                }
                            )
                            SwipeToDismissBox(
                                state = dismissState,
                                backgroundContent = {
                                    val color by animateColorAsState(
                                        targetValue = when (dismissState.currentValue) {
                                            SwipeToDismissBoxValue.EndToStart -> ErrorRed
                                            else -> Color.Transparent
                                        },
                                        label = "swipe_bg"
                                    )
                                    Box(
                                        modifier = Modifier
                                            .fillMaxSize()
                                            .background(color)
                                            .padding(horizontal = 24.dp),
                                        contentAlignment = Alignment.CenterEnd
                                    ) {
                                        Icon(
                                            Icons.Default.Delete,
                                            contentDescription = "Удалить",
                                            tint = Color.White,
                                            modifier = Modifier.size(28.dp)
                                        )
                                    }
                                },
                                enableDismissFromStartToEnd = false,
                                enableDismissFromEndToStart = true
                            ) {
                                ChatListItem(
                                    chat = chat,
                                    isTyping = uiState.typingUsers[chat.id]?.isNotEmpty() == true,
                                    typingText = uiState.typingUsers[chat.id]?.let {
                                        "${it.joinToString(", ")} печатает..."
                                    },
                                    onClick = { onChatClick(chat) }
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    if (showUsersDialog) {
        NewChatDialog(
            users = uiState.users.filter { it.id != uiState.currentUser?.id },
            onUserClick = { user ->
                viewModel.createChat(user.id)
                showUsersDialog = false
            },
            onDismiss = { showUsersDialog = false }
        )
    }

    if (uiState.pendingDeleteChat != null) {
        AlertDialog(
            onDismissRequest = { viewModel.cancelDeleteChat() },
            title = { Text("Удалить чат") },
            text = {
                Text("Удалить чат «${uiState.pendingDeleteChat?.name}»? Сообщения будут удалены безвозвратно.")
            },
            confirmButton = {
                TextButton(onClick = {
                    uiState.pendingDeleteChat?.let { chat ->
                        viewModel.deleteChat(chat.id)
                    }
                    viewModel.cancelDeleteChat()
                }) {
                    Text("Удалить", color = ErrorRed)
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.cancelDeleteChat() }) {
                    Text("Отмена")
                }
            },
            containerColor = MaterialTheme.colorScheme.surface
        )
    }
}

@Composable
fun ChatListItem(
    chat: Chat,
    isTyping: Boolean,
    typingText: String?,
    onClick: () -> Unit
) {
    Surface(
        onClick = onClick,
        color = Color.Transparent,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box {
                ChatAvatar(
                    avatarUrl = chat.avatar,
                    name = chat.name,
                    size = 56.dp
                )
                if (chat.isOnline) {
                    Box(
                        modifier = Modifier
                            .size(14.dp)
                            .clip(CircleShape)
                            .background(OnlineGreen)
                            .align(Alignment.BottomEnd)
                    )
                }
            }

            Spacer(modifier = Modifier.width(12.dp))

            Column(modifier = Modifier.weight(1f)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = chat.name.ifBlank { "Чат" },
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    if (chat.lastMessage != null) {
                        Text(
                            text = formatTimestamp(chat.lastMessage.timestamp),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                Spacer(modifier = Modifier.height(4.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (chat.unreadCount > 0) {
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(10.dp))
                                .background(UnreadBadge)
                                .padding(horizontal = 6.dp, vertical = 2.dp)
                        ) {
                            Text(
                                text = if (chat.unreadCount > 99) "99+" else chat.unreadCount.toString(),
                                color = Color.White,
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.Bold
                            )
                        }
                        Spacer(modifier = Modifier.width(6.dp))
                    }

                    Text(
                        text = when {
                            isTyping && typingText != null -> typingText
                            chat.lastMessage != null -> StickerManager.stripStickerMarkers(chat.lastMessage.text).ifBlank {
                                if (chat.lastMessage.fileData != null) "📎 Файл"
                                else ""
                            }
                            else -> "Нет сообщений"
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (isTyping) Purple500 else MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        }
    }
}

@Composable
fun NewChatDialog(
    users: List<com.chatursa.app.data.model.User>,
    onUserClick: (com.chatursa.app.data.model.User) -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Новый чат") },
        text = {
            if (users.isEmpty()) {
                Text("Нет пользователей для чата", color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                LazyColumn {
                    items(users, key = { it.id }) { user ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onUserClick(user) }
                                .padding(vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            ChatAvatar(
                                avatarUrl = user.avatar,
                                name = user.username,
                                size = 40.dp
                            )
                            Spacer(modifier = Modifier.width(12.dp))
                            Text(
                                text = user.username,
                                style = MaterialTheme.typography.bodyLarge
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Отмена")
            }
        },
        containerColor = MaterialTheme.colorScheme.surface
    )
}

private fun formatTimestamp(timestamp: String): String {
    if (timestamp.isBlank()) return ""
    return try {
        val cleanTs = timestamp.replace("T", " ").take(16).ifBlank { timestamp }
        if (cleanTs.length >= 16) cleanTs.substring(11, 16) else cleanTs
    } catch (e: Exception) { "" }
}
