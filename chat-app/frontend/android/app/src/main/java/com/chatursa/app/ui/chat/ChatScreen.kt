package com.chatursa.app.ui.chat

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.provider.MediaStore
import android.util.Log
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.animation.core.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import coil.compose.AsyncImagePainter
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.chatursa.app.AppConfig
import com.chatursa.app.avatarUrl
import com.chatursa.app.data.model.Chat
import com.chatursa.app.data.model.FileData
import com.chatursa.app.data.model.LinkPreview
import com.chatursa.app.data.model.Message
import com.chatursa.app.data.model.Reaction
import com.chatursa.app.data.model.User
import com.chatursa.app.data.sticker.StickerManager
import com.chatursa.app.ui.ChatAvatar
import com.chatursa.app.ui.theme.*
import java.io.File
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val QUICK_REACTIONS = listOf("👍", "❤️", "😂", "😮", "😢", "🙏")

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun ChatScreen(
    viewModel: ChatViewModel,
    onBack: () -> Unit,
    pendingShareText: String? = null,
    pendingShareImageUri: String? = null
) {
    val uiState by viewModel.uiState.collectAsState()
    var messageText by rememberSaveable { mutableStateOf("") }
    var editText by rememberSaveable { mutableStateOf("") }

    LaunchedEffect(Unit) {
        if (pendingShareText != null || pendingShareImageUri != null) {
            messageText = pendingShareText ?: ""
        }
    }

    val chatId = uiState.chat?.id
    LaunchedEffect(chatId) {
        if (chatId != null) {
            messageText = viewModel.loadDraft(chatId)
        }
    }
    LaunchedEffect(messageText, chatId) {
        if (chatId != null) {
            delay(400)
            viewModel.saveDraft(chatId, messageText)
        }
    }
    val listState = rememberLazyListState()
    val focusManager = androidx.compose.ui.platform.LocalFocusManager.current
    val context = androidx.compose.ui.platform.LocalContext.current

    val recordPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            viewModel.startRecording(context.cacheDir)
        }
    }

    val fileUploadLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri ->
        if (uri != null) {
            viewModel.uploadAndSendFile(context, uri)
        }
    }

    var cameraUri by remember { mutableStateOf<Uri?>(null) }
    val cameraChooserLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val uri = cameraUri
        cameraUri = null
        if (result.resultCode == Activity.RESULT_OK && uri != null) {
            viewModel.uploadAndSendFile(context, uri)
        }
    }

    val cameraPreviewLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.TakePicturePreview()
    ) { bitmap ->
        if (bitmap != null) {
            val file = File(context.cacheDir, "capture_${System.currentTimeMillis()}.jpg")
            try {
                file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }
                viewModel.uploadAndSendFile(context, Uri.fromFile(file), "image/jpeg")
            } catch (e: Exception) {
                Log.e("ChatScreen", "Preview save error", e)
            }
        }
    }

    fun launchCamera() {
        val cameraIntent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
        val cameraAvailable = context.packageManager
            .queryIntentActivities(cameraIntent, PackageManager.MATCH_DEFAULT_ONLY).isNotEmpty()
        if (!cameraAvailable) {
            Toast.makeText(context, "Камера недоступна", Toast.LENGTH_SHORT).show()
            return
        }
        val uri = try {
            val file = File(context.cacheDir, "capture_${System.currentTimeMillis()}.jpg")
            FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        } catch (e: Exception) {
            Log.e("ChatScreen", "Camera file prepare error", e)
            val msg = "Не удалось подготовить файл: ${e.javaClass.simpleName}: ${e.message}"
            Toast.makeText(context, msg, Toast.LENGTH_LONG).show()
            writeCameraErrorToLog(context, e)
            return
        }
        cameraUri = uri
        val captureIntent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(MediaStore.EXTRA_OUTPUT, uri)
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION
                    or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )
        }
        try {
            cameraChooserLauncher.launch(
                Intent.createChooser(captureIntent, "Сделать фото")
            )
        } catch (e: Exception) {
            Log.e("ChatScreen", "Camera launch error", e)
            writeCameraErrorToLog(context, e)
            try {
                cameraPreviewLauncher.launch(null)
            } catch (e2: Exception) {
                Log.e("ChatScreen", "Camera preview launch error", e2)
                writeCameraErrorToLog(context, e2)
                Toast.makeText(
                    context,
                    "Не удалось открыть камеру: ${e.javaClass.simpleName}",
                    Toast.LENGTH_LONG
                ).show()
            }
        }
    }

    val cameraPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            launchCamera()
        } else {
            Toast.makeText(context, "Нет доступа к камере", Toast.LENGTH_LONG).show()
        }
    }

    val firstMessageLoad = remember { mutableStateOf(true) }

    LaunchedEffect(uiState.messages.size) {
        if (uiState.messages.isNotEmpty() && !uiState.isSearching) {
            if (firstMessageLoad.value) {
                firstMessageLoad.value = false
                listState.animateScrollToItem(uiState.messages.size - 1)
            } else {
                val lastVisible = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: return@LaunchedEffect
                if (lastVisible >= listState.layoutInfo.totalItemsCount - 3) {
                    listState.animateScrollToItem(uiState.messages.size - 1)
                }
            }
        }
    }

    // Delete confirmation dialog
    if (uiState.showDeleteConfirm != null) {
        AlertDialog(
            onDismissRequest = { viewModel.cancelDelete() },
            title = { Text("Удалить сообщение?") },
            text = { Text("Вы уверены, что хотите удалить это сообщение?") },
            confirmButton = {
                TextButton(onClick = { viewModel.confirmDelete() }) {
                    Text("Удалить", color = Color.Red)
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.cancelDelete() }) {
                    Text("Отмена")
                }
            }
        )
    }

    // Forward dialog
    if (uiState.showForwardDialog) {
        AlertDialog(
            onDismissRequest = { viewModel.cancelForward() },
            title = { Text("Переслать сообщение") },
            text = {
                if (uiState.users.isEmpty()) {
                    Text("Нет доступных пользователей")
                } else {
                    LazyColumn(modifier = Modifier.heightIn(max = 300.dp)) {
                        items(uiState.users.filter { it.id != uiState.currentUser?.id }, key = { it.id }) { user ->
                            Surface(
                                onClick = { viewModel.forwardToUser(user.id) },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Row(
                                    modifier = Modifier.padding(8.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    ChatAvatar(
                                        avatarUrl = user.avatar,
                                        name = user.username,
                                        size = 32.dp
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(user.username)
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(onClick = { viewModel.cancelForward() }) {
                    Text("Отмена")
                }
            }
        )
    }

    // Media gallery
    var showMediaGallery by remember { mutableStateOf(false) }
    val allImageUrls = remember(uiState.messages) {
        uiState.messages.mapNotNull { it.fileData }
            .filter { it.mimetype.startsWith("image/") }
            .map { it.url }
    }
    if (showMediaGallery) {
        MediaGallery(
            messages = uiState.messages,
            onDismiss = { showMediaGallery = false },
            onImageClick = { url ->
                viewModel.showImageViewer(allImageUrls, allImageUrls.indexOf(url))
                showMediaGallery = false
            }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    if (uiState.isSearching) {
                        OutlinedTextField(
                            value = uiState.searchQuery,
                            onValueChange = { viewModel.setSearchQuery(it) },
                            placeholder = { Text("Поиск...", color = TextSecondary) },
                            singleLine = true,
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedBorderColor = Color.Transparent,
                                unfocusedBorderColor = Color.Transparent,
                                focusedContainerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                                unfocusedContainerColor = Color.Transparent,
                                cursorColor = Purple500
                            ),
                            modifier = Modifier.fillMaxWidth(),
                            textStyle = MaterialTheme.typography.bodyLarge
                        )
                    } else {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            ChatAvatar(
                                avatarUrl = uiState.chat?.avatar,
                                name = uiState.chat?.name,
                                size = 40.dp,
                                modifier = Modifier.clickable {
                                    uiState.chat?.avatar?.let { viewModel.showImageViewer(it) }
                                }
                            )
                            Spacer(modifier = Modifier.width(12.dp))
                            Column {
                                Text(
                                    text = uiState.chat?.name ?: "Чат",
                                    fontWeight = FontWeight.SemiBold,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.clickable { viewModel.showUserInfo() }
                                )
                                if (uiState.typingText.isNotEmpty()) {
                                    Text(
                                        text = uiState.typingText,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = Purple500
                                    )
                                } else {
                                    if (uiState.chat?.isOnline == true) {
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            Box(
                                                modifier = Modifier
                                                    .size(6.dp)
                                                    .clip(CircleShape)
                                                    .background(Color(0xFF4CAF50))
                                            )
                                            Spacer(modifier = Modifier.width(4.dp))
                                            Text(
                                                text = "в сети",
                                                style = MaterialTheme.typography.bodySmall,
                                                color = TextSecondary
                                            )
                                        }
                                    } else if (uiState.isConnected) {
                                        val lastSeen = uiState.chat?.lastSeen
                                        if (uiState.chat?.type == "direct" && lastSeen != null) {
                                            Text(
                                                text = "был(а) в сети ${formatLastSeen(lastSeen)}",
                                                style = MaterialTheme.typography.bodySmall,
                                                color = TextSecondary
                                            )
                                        } else {
                                            Text(
                                                text = "не в сети",
                                                style = MaterialTheme.typography.bodySmall,
                                                color = TextSecondary
                                            )
                                        }
                                    } else {
                                        Text(
                                            text = "подключение...",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = TextSecondary
                                        )
                                    }
                                }
                            }
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = {
                        viewModel.disconnect()
                        onBack()
                    }) {
                        Icon(Icons.Default.ArrowBack, "Назад")
                    }
                },
                actions = {
                    if (uiState.isSearching) {
                        IconButton(onClick = { viewModel.stopSearch() }) {
                            Icon(Icons.Default.Close, "Закрыть поиск")
                        }
                    } else {
                        IconButton(onClick = { viewModel.startSearch() }) {
                            Icon(Icons.Default.Search, "Поиск")
                        }
                        IconButton(onClick = { showMediaGallery = true }) {
                            Icon(Icons.Default.PhotoLibrary, "Медиа")
                        }
                        if (uiState.chat?.type == "group") {
                            IconButton(onClick = { /* TODO: group info */ }) {
                                Icon(Icons.Default.Info, "Инфо")
                            }
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface
                )
            )
        }
    ) { padding ->
        val chatBgBrush = com.chatursa.app.ui.theme.LocalChatBackgroundBrush.current
        val isDarkMode = com.chatursa.app.ui.theme.LocalIsDarkMode.current
        val defaultChatBg = if (isDarkMode) ChatBg else LightChatBg

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding()
                .then(
                    if (chatBgBrush != null) Modifier.background(chatBgBrush)
                    else Modifier.background(defaultChatBg)
                )
        ) {
            if (uiState.isLoading) {
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator(color = Purple500)
                }
            } else {
                // Pinned message bar
                if (uiState.pinnedMessage != null) {
                    val pinned = uiState.pinnedMessage!!
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        color = Purple500.copy(alpha = 0.15f),
                        tonalElevation = 2.dp
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                Icons.Default.PushPin,
                                null,
                                tint = Color(0xFFFFC107),
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = pinned.senderName,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = Purple500,
                                    fontWeight = FontWeight.Medium
                                )
                                Text(
                                    text = StickerManager.stripStickerMarkers(pinned.text).ifBlank {
                                        if (pinned.fileData != null) "📎 Файл" else ""
                                    },
                                    style = MaterialTheme.typography.bodySmall,
                                    color = TextSecondary,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                            IconButton(onClick = { viewModel.unpinCurrent() }) {
                                Icon(Icons.Default.Close, "Открепить", tint = TextSecondary, modifier = Modifier.size(18.dp))
                            }
                        }
                    }
                }

                if (uiState.messages.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxWidth(),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            "Нет сообщений. Напишите что-нибудь!",
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextSecondary
                        )
                    }
                } else {
                // Reply preview
                AnimatedVisibility(visible = uiState.replyToMessage != null) {
                    uiState.replyToMessage?.let { replyMsg ->
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            color = MaterialTheme.colorScheme.surfaceVariant,
                            tonalElevation = 2.dp
                        ) {
                            Row(
                                modifier = Modifier.padding(8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Box(
                                    modifier = Modifier
                                        .width(3.dp)
                                        .height(32.dp)
                                        .background(Purple500)
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = replyMsg.senderName,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = Purple500,
                                        fontWeight = FontWeight.Medium
                                    )
                                    Text(
                                        text = StickerManager.stripStickerMarkers(replyMsg.text).ifBlank { "📎 Файл" },
                                        style = MaterialTheme.typography.bodySmall,
                                        color = TextSecondary,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                                IconButton(onClick = { viewModel.setReplyTo(null) }) {
                                    Icon(Icons.Default.Close, "Отмена", tint = TextSecondary)
                                }
                            }
                        }
                    }
                }

                // Edit mode indicator
                AnimatedVisibility(visible = uiState.editingMessage != null) {
                    uiState.editingMessage?.let { editMsg ->
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            color = Purple500.copy(alpha = 0.15f),
                            tonalElevation = 2.dp
                        ) {
                            Row(
                                modifier = Modifier.padding(8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Box(
                                    modifier = Modifier
                                        .width(3.dp)
                                        .height(32.dp)
                                        .background(Purple500)
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = "Редактирование",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = Purple500,
                                        fontWeight = FontWeight.Medium
                                    )
                                    Text(
                                        text = StickerManager.stripStickerMarkers(editMsg.text).ifBlank { "📎 Файл" },
                                        style = MaterialTheme.typography.bodySmall,
                                        color = TextSecondary,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                                IconButton(onClick = { viewModel.setEditing(null) }) {
                                    Icon(Icons.Default.Close, "Отмена", tint = TextSecondary)
                                }
                            }
                        }
                        LaunchedEffect(editMsg) { editText = editMsg.text }
                    }
                }

                // Context menu popup
                if (uiState.showContextMenu && uiState.contextMenuMessage != null) {
                    val ctxMsg = uiState.contextMenuMessage!!
                    val isOwn = ctxMsg.senderId == uiState.currentUser?.id
                    AlertDialog(
                        onDismissRequest = { viewModel.hideContextMenu() },
                        title = {
                            Text(
                                text = if (isOwn) "Ваше сообщение" else ctxMsg.senderName,
                                style = MaterialTheme.typography.bodyMedium
                            )
                        },
                        text = {
                            Column {
                                // Quick reactions row
                                Text("Реакции:", style = MaterialTheme.typography.labelMedium, color = TextSecondary)
                                Spacer(modifier = Modifier.height(8.dp))
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceEvenly
                                ) {
                                    QUICK_REACTIONS.forEach { emoji ->
                                        val hasIt = ctxMsg.reactions.any { it.emoji == emoji && it.userId == uiState.currentUser?.id }
                                        Surface(
                                            onClick = { viewModel.toggleReaction(ctxMsg.id, emoji) },
                                            shape = CircleShape,
                                            color = if (hasIt) Purple500.copy(alpha = 0.3f) else Color.Transparent,
                                            modifier = Modifier.size(40.dp)
                                        ) {
                                            Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                                                Text(emoji, fontSize = 24.sp)
                                            }
                                        }
                                    }
                                }

                                HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))

                                // Actions
                                Surface(onClick = { viewModel.setReplyTo(ctxMsg); viewModel.hideContextMenu() }) {
                                    Row(modifier = Modifier.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                        Icon(Icons.Default.Reply, null, tint = Purple500, modifier = Modifier.size(20.dp))
                                        Spacer(modifier = Modifier.width(8.dp))
                                        Text("Ответить")
                                    }
                                }
                                Surface(onClick = { viewModel.showForwardUI(ctxMsg) }) {
                                    Row(modifier = Modifier.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                        Icon(Icons.Default.Forward, null, tint = Purple500, modifier = Modifier.size(20.dp))
                                        Spacer(modifier = Modifier.width(8.dp))
                                        Text("Переслать")
                                    }
                                }
                                if (isOwn) {
                                    Surface(onClick = { viewModel.setEditing(ctxMsg); viewModel.hideContextMenu() }) {
                                        Row(modifier = Modifier.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                            Icon(Icons.Default.Edit, null, tint = Purple500, modifier = Modifier.size(20.dp))
                                            Spacer(modifier = Modifier.width(8.dp))
                                            Text("Редактировать")
                                        }
                                    }
                                    Surface(onClick = { viewModel.deleteMessage(ctxMsg) }) {
                                        Row(modifier = Modifier.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                            Icon(Icons.Default.Delete, null, tint = Color.Red, modifier = Modifier.size(20.dp))
                                            Spacer(modifier = Modifier.width(8.dp))
                                            Text("Удалить", color = Color.Red)
                                        }
                                    }
                                }
                                HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))
                                Surface(onClick = { viewModel.pinMessage(ctxMsg) }) {
                                    Row(modifier = Modifier.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                        Icon(
                                            if (ctxMsg.isPinned) Icons.Default.PushPin else Icons.Default.PushPin,
                                            null,
                                            tint = if (ctxMsg.isPinned) Color(0xFFFFC107) else Purple500,
                                            modifier = Modifier.size(20.dp)
                                        )
                                        Spacer(modifier = Modifier.width(8.dp))
                                        Text(if (ctxMsg.isPinned) "Открепить" else "Закрепить")
                                    }
                                }
                            }
                        },
                        confirmButton = {},
                        dismissButton = {
                            TextButton(onClick = { viewModel.hideContextMenu() }) { Text("Закрыть") }
                        }
                    )
                }

                // Image overlay dialog
                if (uiState.imageViewerUrls.isNotEmpty()) {
                    ImageViewerDialog(
                        imageUrls = uiState.imageViewerUrls,
                        initialIndex = uiState.imageViewerIndex,
                        onDismiss = { viewModel.hideImageViewer() }
                    )
                }

                // User info dialog
                if (uiState.showUserInfo) {
                    UserInfoDialog(
                        chat = uiState.chat,
                        users = uiState.users,
                        currentUserId = uiState.currentUser?.id,
                        onDismiss = { viewModel.hideUserInfo() },
                        onAvatarClick = { url -> viewModel.showImageViewer(url); viewModel.hideUserInfo() }
                    )
                }

                // Search results count
                if (uiState.isSearching && uiState.searchQuery.isNotBlank()) {
                    val filteredCount = uiState.messages.count { msg ->
                        val q = uiState.searchQuery.trim().lowercase()
                        msg.text.lowercase().contains(q) ||
                        msg.senderName.lowercase().contains(q) ||
                        (msg.fileData?.name?.lowercase()?.contains(q) == true)
                    }
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        color = Purple500.copy(alpha = 0.1f)
                    ) {
                        Text(
                            text = "Найдено: $filteredCount",
                            style = MaterialTheme.typography.bodySmall,
                            color = Purple500,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
                        )
                    }
                }

                val displayMessages by remember(uiState.messages, uiState.searchQuery, uiState.isSearching) {
                    derivedStateOf {
                        if (uiState.isSearching && uiState.searchQuery.isNotBlank()) {
                            val q = uiState.searchQuery.trim().lowercase()
                            uiState.messages.filter { msg ->
                                msg.text.lowercase().contains(q) ||
                                msg.senderName.lowercase().contains(q) ||
                                (msg.fileData?.name?.lowercase()?.contains(q) == true)
                            }
                        } else uiState.messages
                    }
                }

                val scope = rememberCoroutineScope()
                val isRefreshing = remember { mutableStateOf(false) }

                PullToRefreshBox(
                    isRefreshing = isRefreshing.value,
                    onRefresh = {
                        scope.launch {
                            isRefreshing.value = true
                            viewModel.reloadMessages()
                            isRefreshing.value = false
                        }
                    },
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth()
                ) {
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(horizontal = 8.dp),
                        state = listState,
                        contentPadding = PaddingValues(vertical = 8.dp)
                    ) {
                        items(displayMessages.distinctBy { it.id }, key = { it.id }) { message ->
                            MessageBubble(
                                message = message,
                                isOwn = message.senderId == uiState.currentUser?.id,
                                currentUserId = uiState.currentUser?.id,
                                onLongClick = { viewModel.showContextMenu(message) },
                                onImageClick = { url -> viewModel.showImageViewer(allImageUrls, allImageUrls.indexOf(url)) },
                                linkPreviews = uiState.linkPreviews,
                                onFetchLinkPreview = { url -> viewModel.fetchLinkPreview(url) }
                            )
                        }
                    }
                }
            }
            }

            // Input bar
            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 4.dp
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = {
                        val hasCameraPermission = ContextCompat.checkSelfPermission(
                            context,
                            Manifest.permission.CAMERA
                        ) == PackageManager.PERMISSION_GRANTED
                        if (hasCameraPermission) {
                            launchCamera()
                        } else {
                            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                        }
                    }) {
                        Icon(
                            Icons.Default.PhotoCamera,
                            "Сделать фото",
                            tint = TextSecondary
                        )
                    }

                    IconButton(onClick = { fileUploadLauncher.launch("*/*") }) {
                        Icon(
                            Icons.Default.AttachFile,
                            "Прикрепить",
                            tint = TextSecondary
                        )
                    }

                    if (uiState.editingMessage != null) {
                        OutlinedTextField(
                            value = editText,
                            onValueChange = { editText = it },
                            placeholder = { Text("Редактировать...", color = TextSecondary) },
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(24.dp),
                            singleLine = false,
                            maxLines = 4,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                            keyboardActions = KeyboardActions(
                                onDone = {
                                    uiState.editingMessage?.let { msg ->
                                        viewModel.editSubmit(msg.id, editText.trim())
                                        editText = ""
                                        focusManager.clearFocus()
                                    }
                                }
                            ),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedBorderColor = Purple500,
                                unfocusedBorderColor = Color.Transparent,
                                cursorColor = Purple500,
                                focusedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
                                unfocusedContainerColor = MaterialTheme.colorScheme.surfaceVariant
                            )
                        )

                        Spacer(modifier = Modifier.width(4.dp))

                        FilledIconButton(
                            onClick = {
                                uiState.editingMessage?.let { msg ->
                                    viewModel.editSubmit(msg.id, editText.trim())
                                    editText = ""
                                    focusManager.clearFocus()
                                }
                            },
                            modifier = Modifier.size(44.dp),
                            shape = CircleShape,
                            colors = IconButtonDefaults.filledIconButtonColors(
                                containerColor = Purple500,
                                contentColor = Color.White
                            )
                        ) {
                            Icon(Icons.Default.Check, "Готово", modifier = Modifier.size(22.dp))
                        }
                    } else {
                        OutlinedTextField(
                            value = messageText,
                            onValueChange = {
                                messageText = it
                                viewModel.sendTyping(it.isNotEmpty())
                            },
                            placeholder = { Text("Сообщение...", color = TextSecondary) },
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(24.dp),
                            singleLine = false,
                            maxLines = 4,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                            keyboardActions = KeyboardActions(
                                onSend = {
                                    if (messageText.isNotBlank()) {
                                        viewModel.sendMessage(messageText.trim())
                                        messageText = ""
                                        viewModel.sendTyping(false)
                                        focusManager.clearFocus()
                                    }
                                }
                            ),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedBorderColor = Purple500,
                                unfocusedBorderColor = Color.Transparent,
                                cursorColor = Purple500,
                                focusedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
                                unfocusedContainerColor = MaterialTheme.colorScheme.surfaceVariant
                            )
                        )

                        Spacer(modifier = Modifier.width(4.dp))

                        if (uiState.isRecording) {
                            // Recording state: show duration and stop button
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.height(44.dp)
                            ) {
                                Text(
                                    text = formatDuration(uiState.recordingDurationMs),
                                    color = Color(0xFFFF4444),
                                    style = MaterialTheme.typography.bodyMedium
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                IconButton(
                                    onClick = { viewModel.stopRecordingAndSend() },
                                    modifier = Modifier.size(44.dp)
                                ) {
                                    Icon(
                                        Icons.Default.Send,
                                        "Отправить",
                                        tint = Purple500
                                    )
                                }
                            }
                        } else {
                            FilledIconButton(
                                onClick = {
                                    if (messageText.isNotBlank()) {
                                        viewModel.sendMessage(messageText.trim())
                                        messageText = ""
                                        viewModel.sendTyping(false)
                                        focusManager.clearFocus()
                                    } else {
                                        val perm = Manifest.permission.RECORD_AUDIO
                                        if (androidx.core.content.ContextCompat.checkSelfPermission(context, perm) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                                            viewModel.startRecording(context.cacheDir)
                                        } else {
                                            recordPermissionLauncher.launch(perm)
                                        }
                                    }
                                },
                                modifier = Modifier.size(44.dp),
                                shape = CircleShape,
                                colors = IconButtonDefaults.filledIconButtonColors(
                                    containerColor = Purple500,
                                    contentColor = Color.White
                                )
                            ) {
                                Icon(
                                    if (messageText.isBlank()) Icons.Default.Mic else Icons.Default.Send,
                                    "Отправить",
                                    modifier = Modifier.size(22.dp)
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MessageBubble(
    message: Message,
    isOwn: Boolean,
    currentUserId: String? = null,
    onLongClick: () -> Unit,
    onImageClick: (String) -> Unit = {},
    linkPreviews: Map<String, LinkPreview> = emptyMap(),
    onFetchLinkPreview: (String) -> Unit = {},
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp),
        horizontalAlignment = if (isOwn) Alignment.End else Alignment.Start
    ) {
        // Forwarded badge
        if (message.forwardedFrom != null) {
            Text(
                text = "⬆ Переслано от ${message.forwardedFrom.senderName}",
                style = MaterialTheme.typography.bodySmall,
                color = TextSecondary,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp)
            )
        }

        // Reply preview in bubble
        if (message.replyTo != null) {
            Surface(
                modifier = Modifier
                    .padding(horizontal = if (isOwn) 4.dp else 0.dp, vertical = 2.dp),
                color = if (isOwn) Purple500.copy(alpha = 0.3f) else MaterialTheme.colorScheme.surfaceVariant,
                shape = RoundedCornerShape(4.dp)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(
                        modifier = Modifier
                            .width(3.dp)
                            .height(24.dp)
                            .background(if (isOwn) Color.White else Purple500)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Column {
                        Text(
                            text = message.replyTo.senderName,
                            style = MaterialTheme.typography.bodySmall,
                            color = if (isOwn) Color.White.copy(alpha = 0.7f) else Purple500,
                            fontWeight = FontWeight.Medium
                        )
                        Text(
                            text = StickerManager.stripStickerMarkers(message.replyTo.text).ifBlank { "📎 Файл" },
                            style = MaterialTheme.typography.bodySmall,
                            color = if (isOwn) Color.White.copy(alpha = 0.5f) else TextSecondary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }
            }
        }

        Surface(
            modifier = Modifier
                .combinedClickable(
                    onClick = {},
                    onLongClick = onLongClick
                )
                .widthIn(max = 280.dp),
            shape = RoundedCornerShape(
                topStart = 16.dp,
                topEnd = 16.dp,
                bottomStart = if (isOwn) 16.dp else 4.dp,
                bottomEnd = if (isOwn) 4.dp else 16.dp
            ),
            color = if (isOwn) MyMessage else if (com.chatursa.app.ui.theme.LocalIsDarkMode.current) OtherMessage else LightOtherMessage,
        ) {
            Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)) {
                if (!isOwn) {
                    Text(
                        text = message.senderName,
                        style = MaterialTheme.typography.bodySmall,
                        color = Purple200,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.padding(bottom = 2.dp)
                    )
                }

                // Message text (supports stickers)
                StickerAwareText(
                    text = message.text,
                    isOwn = isOwn,
                    isDarkMode = com.chatursa.app.ui.theme.LocalIsDarkMode.current
                )

                // File attachment
                if (message.fileData != null) {
                    Spacer(modifier = Modifier.height(4.dp))
                    FileAttachment(
                        fileData = message.fileData!!,
                        isOwn = isOwn,
                        onImageClick = onImageClick
                    )
                }

                // Link preview
                val urls = remember(message.text) { ChatViewModel.getUrlsFromText(message.text) }
                if (urls.isNotEmpty()) {
                    val firstUrl = urls.first()
                    LaunchedEffect(firstUrl) { onFetchLinkPreview(firstUrl) }
                    val preview = linkPreviews[firstUrl]
                    if (preview != null) {
                        Spacer(modifier = Modifier.height(4.dp))
                        LinkPreviewCard(preview = preview, isOwn = isOwn)
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (message.edited) {
                        val editColor = if (isOwn || com.chatursa.app.ui.theme.LocalIsDarkMode.current) Color.White.copy(alpha = 0.5f) else Color.Black.copy(alpha = 0.4f)
                        Text(
                            text = "ред.",
                            style = MaterialTheme.typography.labelSmall,
                            color = editColor,
                            modifier = Modifier.padding(end = 4.dp)
                        )
                    }
                    val timeColor = if (isOwn || com.chatursa.app.ui.theme.LocalIsDarkMode.current) Color.White.copy(alpha = 0.5f) else Color.Black.copy(alpha = 0.4f)
                    Text(
                        text = formatTime(message.timestamp),
                        style = MaterialTheme.typography.labelSmall,
                        color = timeColor
                    )
                    if (isOwn) {
                        Spacer(modifier = Modifier.width(4.dp))
                        Icon(
                            imageVector = if (message.readAt != null) Icons.Default.DoneAll
                            else Icons.Default.Done,
                            contentDescription = null,
                            modifier = Modifier.size(14.dp),
                            tint = if (message.readAt != null) Color(0xFF53D769) else Color.White.copy(alpha = 0.5f)
                        )
                    }
                }

                // Reactions row
                if (message.reactions.isNotEmpty()) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(12.dp))
                            .background(Color(0x33000000))
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    ) {
                        val grouped: Map<String, List<Reaction>> = message.reactions.groupBy { it.emoji }
                        grouped.forEach { (emoji, reactions) ->
                            val hasMine = reactions.any { it.userId == currentUserId }
                            Text(
                                text = "$emoji ${reactions.size}",
                                style = MaterialTheme.typography.bodySmall,
                                color = if (hasMine) Purple200 else Color.White,
                                fontWeight = if (hasMine) FontWeight.Bold else FontWeight.Normal,
                                modifier = Modifier.padding(end = 4.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun formatTime(timestamp: String): String {
    if (timestamp.isBlank()) return ""
    return try {
        val cleanTs = timestamp.replace("T", " ").take(16).ifBlank { timestamp }
        if (cleanTs.length >= 16) cleanTs.substring(11, 16) else cleanTs
    } catch (e: Exception) { "" }
}

private fun formatDuration(ms: Long): String {
    if (ms <= 0) return "0:00"
    val totalSec = (ms / 1000).toInt()
    val min = totalSec / 60
    val sec = totalSec % 60
    return "$min:${sec.toString().padStart(2, '0')}"
}

@Composable
fun FileAttachment(fileData: FileData, isOwn: Boolean, onImageClick: (String) -> Unit = {}) {
    val context = LocalContext.current
    val bgColor = if (isOwn) Color.White.copy(alpha = 0.15f) else Color.Black.copy(alpha = 0.1f)

    val isImage = fileData.mimetype.startsWith("image/")
    val isAudio = fileData.mimetype.startsWith("audio/")

    if (isImage) {
        AsyncImage(
            model = fileData.url,
            contentDescription = fileData.name,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = 300.dp)
                .clip(RoundedCornerShape(8.dp))
                .clickable { onImageClick(fileData.url) },
            contentScale = ContentScale.FillWidth
        )
    } else if (isAudio) {
        AudioPlayer(url = fileData.url, isOwn = isOwn)
    } else {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .clickable {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(fileData.url))
                    context.startActivity(intent)
                },
            color = bgColor,
            shape = RoundedCornerShape(8.dp)
        ) {
            Row(
                modifier = Modifier.padding(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Default.AttachFile,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(24.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = fileData.name.ifBlank { "Файл" },
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color.White,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                    if (fileData.size > 0) {
                        Text(
                            text = formatFileSize(fileData.size),
                            style = MaterialTheme.typography.bodySmall,
                            color = Color.White.copy(alpha = 0.5f)
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun StickerAwareText(text: String, isOwn: Boolean, isDarkMode: Boolean) {
    val textColor = if (isOwn || isDarkMode) Color.White else Color.Black
    if (!text.contains("\u0000STICKER\u0000")) {
        Text(
            text = text,
            style = MaterialTheme.typography.bodyLarge,
            color = textColor
        )
        return
    }

    val parts = text.split("\u0000STICKER\u0000")
    val stickerOnly = StickerManager.isStickerOnlyMessage(text)

    val infiniteTransition = rememberInfiniteTransition(label = "stickerPulse")
    val stickerScale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = if (stickerOnly) 1.05f else 1.03f,
        animationSpec = infiniteRepeatable(
            animation = tween(1500, easing = EaseInOutCubic),
            repeatMode = RepeatMode.Reverse
        ),
        label = "stickerScale"
    )
    val stickerAnimMod = Modifier.scale(stickerScale)

    if (stickerOnly) {
        val files = StickerManager.parseStickerFiles(text)
        if (files.isNotEmpty()) {
            Box(
                modifier = Modifier.fillMaxWidth(),
                contentAlignment = Alignment.Center
            ) {
                AsyncImage(
                    model = StickerManager.stickerUrl(files.first()),
                    contentDescription = "Стикер",
                    modifier = stickerAnimMod
                        .width(128.dp)
                        .height(128.dp),
                    contentScale = ContentScale.Fit
                )
            }
        }
    } else {
        Column {
            for (i in parts.indices) {
                if (i % 2 == 0 && parts[i].isNotBlank()) {
                    Text(
                        text = parts[i],
                        style = MaterialTheme.typography.bodyLarge,
                        color = textColor
                    )
                } else if (i % 2 == 1 && parts[i].isNotBlank()) {
                    AsyncImage(
                        model = StickerManager.stickerUrl(parts[i].trim()),
                        contentDescription = "Стикер",
                        modifier = stickerAnimMod
                            .width(64.dp)
                            .height(64.dp),
                        contentScale = ContentScale.Fit
                    )
                }
            }
        }
    }
}

private fun formatFileSize(bytes: Long): String {
    return when {
        bytes >= 1024 * 1024 -> String.format("%.1f MB", bytes / (1024.0 * 1024.0))
        bytes >= 1024 -> String.format("%.1f KB", bytes / 1024.0)
        else -> "$bytes B"
    }
}

private fun formatLastSeen(timestamp: String): String {
    if (timestamp.isBlank()) return "не в сети"
    return try {
        val cleanTs = timestamp.replace("T", " ").replace("Z", "").trim()
        val dateFormat = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.getDefault())
        val date = dateFormat.parse(cleanTs.take(19)) ?: return timestamp.take(16)
        val now = System.currentTimeMillis()
        val diff = now - date.time
        val seconds = (diff / 1000).toInt()
        val minutes = seconds / 60
        val hours = minutes / 60
        val days = hours / 24
        when {
            minutes < 1 -> "только что"
            minutes < 2 -> "1 минуту назад"
            minutes < 5 -> "$minutes минуты назад"
            minutes < 21 -> "$minutes минут назад"
            minutes % 10 == 1 -> "$minutes минуту назад"
            minutes % 10 in 2..4 -> "$minutes минуты назад"
            minutes < 60 -> "$minutes минут назад"
            hours < 2 -> "1 час назад"
            hours < 5 -> "$hours часа назад"
            hours < 24 -> "$hours часов назад"
            days < 2 -> "вчера"
            days < 5 -> "$days дня назад"
            days < 21 -> "$days дней назад"
            days % 10 == 1 -> "$days день назад"
            else -> "$days дней назад"
        }
    } catch (e: Exception) { timestamp.take(16) }
}

@Composable
private fun UserInfoDialog(
    chat: Chat?,
    users: List<User>,
    currentUserId: String?,
    onDismiss: () -> Unit,
    onAvatarClick: (String) -> Unit
) {
    val otherUserId = if (chat?.type == "direct" && currentUserId != null) {
        chat.participants.find { it != currentUserId }
    } else null
    val otherUser = otherUserId?.let { id -> users.find { it.id == id } }
    val name = otherUser?.username?.ifBlank { null } ?: otherUser?.fullName ?: chat?.name ?: "Пользователь"
    val avatar = otherUser?.avatar ?: chat?.avatar
    val statusText = otherUser?.statusText
    val about = otherUser?.about
    val phone = otherUser?.mobilePhone
    val userStatus = otherUser?.status ?: "offline"
    val userLastSeen = otherUser?.lastSeen

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                ChatAvatar(
                    avatarUrl = avatar,
                    name = name,
                    size = 80.dp,
                    modifier = Modifier.clickable { avatar?.let { onAvatarClick(it) } }
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = name,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = when {
                        userStatus == "online" -> "в сети"
                        userLastSeen != null -> "был(а) в сети ${formatLastSeen(userLastSeen)}"
                        else -> "не в сети"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = TextSecondary
                )
            }
        },
        text = {
            Column {
                if (!statusText.isNullOrBlank()) {
                    Text(
                        text = statusText,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(bottom = 8.dp)
                    )
                }
                if (!about.isNullOrBlank()) {
                    Text(
                        text = about,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(bottom = 8.dp)
                    )
                }
                if (!phone.isNullOrBlank()) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            Icons.Default.Phone,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                            tint = TextSecondary
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = phone,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Закрыть")
            }
        },
        containerColor = MaterialTheme.colorScheme.surface,
        tonalElevation = 8.dp
    )
}

private fun writeCameraErrorToLog(context: Context, e: Exception) {
    try {
        val text = buildString {
            appendLine("Time: ${System.currentTimeMillis()}")
            appendLine("Thread: ${Thread.currentThread().name}")
            appendLine("Camera error: ${e.javaClass.name}: ${e.message}")
            appendLine(e.stackTrace.joinToString("\n"))
        }
        val externalDir = context.getExternalFilesDir(null)
        if (externalDir != null) {
            File(externalDir, "crash_log.txt").writeText(text)
        }
        File(context.cacheDir, "crash_log.txt").writeText(text)
    } catch (_: Exception) {
    }
}