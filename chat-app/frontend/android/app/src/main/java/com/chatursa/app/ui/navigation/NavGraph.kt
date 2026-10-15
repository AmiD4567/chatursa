package com.chatursa.app.ui.navigation

import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.chatursa.app.avatarUrl
import com.chatursa.app.data.model.Chat
import com.chatursa.app.ui.ChatAvatar
import com.chatursa.app.ui.avatarOrPeer
import com.chatursa.app.ui.auth.AuthScreen
import com.chatursa.app.ui.auth.AuthViewModel
import com.chatursa.app.ui.chat.ChatScreen
import com.chatursa.app.ui.chat.ChatViewModel
import com.chatursa.app.ui.chatlist.ChatListScreen
import com.chatursa.app.ui.chatlist.ChatListViewModel
import com.chatursa.app.ui.contacts.ContactsScreen
import com.chatursa.app.ui.profile.ProfileScreen
import com.chatursa.app.ui.theme.Purple500
import com.chatursa.app.ui.theme.ThemeViewModel
import com.google.gson.Gson

@Composable
fun AppNavGraph(
    themeViewModel: ThemeViewModel,
    sharedText: String? = null,
    pendingShareMediaUris: List<String> = emptyList(),
    deepLinkChatId: String? = null,
    onDeepLinkConsumed: () -> Unit = {},
    onShareConsumed: () -> Unit = {}
) {
    val rootNavController = rememberNavController()
    val authViewModel: AuthViewModel = viewModel()
    val chatListViewModel: ChatListViewModel = viewModel()
    val authState by authViewModel.uiState.collectAsState()
    val chatListState by chatListViewModel.uiState.collectAsState()

    var shareTargetHandled by remember { mutableStateOf(false) }
    var pendingShareText by remember { mutableStateOf<String?>(null) }
    var pendingShareMedia by remember { mutableStateOf<List<String>>(emptyList()) }

    val startDest = if (authState.isLoggedIn) "main" else "auth"
    val context = LocalContext.current

    // Deep link from notification -> open the chat once chats are loaded
    LaunchedEffect(deepLinkChatId, authState.isLoggedIn, chatListState.chats) {
        val id = deepLinkChatId ?: return@LaunchedEffect
        if (!authState.isLoggedIn) return@LaunchedEffect
        val chat = chatListState.chats.find { it.id == id } ?: return@LaunchedEffect
        chatListViewModel.resetUnread(chat.id)
        val encoded = java.net.URLEncoder.encode(Gson().toJson(chat), "UTF-8")
        rootNavController.navigate("chat/$encoded")
        onDeepLinkConsumed()
    }

    if (authState.isLoggedIn && !shareTargetHandled &&
        (sharedText != null || pendingShareMediaUris.isNotEmpty())
    ) {
        var showShareDialog by remember { mutableStateOf(true) }
        if (showShareDialog) {
            AlertDialog(
                onDismissRequest = {
                    showShareDialog = false
                    shareTargetHandled = true
                    onShareConsumed()
                },
                title = { Text("Отправить в чат", fontWeight = FontWeight.SemiBold) },
                text = {
                    val items = chatListState.chats.filter { it.type == "direct" }
                    if (items.isEmpty()) {
                        Text("Нет доступных чатов")
                    } else {
                        LazyColumn(modifier = Modifier.heightIn(max = 400.dp)) {
                            items(items, key = { it.id }) { chat ->
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable {
                                            showShareDialog = false
                                            shareTargetHandled = true
                                            pendingShareText = sharedText
                                            pendingShareMedia = pendingShareMediaUris
                                            val chatJson = Gson().toJson(chat)
                                            rootNavController.navigate("chat/$chatJson")
                                        }
                                        .padding(12.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    ChatAvatar(
                                        avatarUrl = chat.avatarOrPeer(),
                                        name = chat.name,
                                        size = 40.dp
                                    )
                                    Spacer(Modifier.width(12.dp))
                                    Text(
                                        text = chat.name.ifBlank { "Чат" },
                                        fontWeight = FontWeight.Medium
                                    )
                                }
                            }
                        }
                    }
                },
                confirmButton = {},
                dismissButton = {
                    TextButton(onClick = {
                        showShareDialog = false
                        shareTargetHandled = true
                        onShareConsumed()
                    }) {
                        Text("Отмена")
                    }
                }
            )
        }
    }

    NavHost(
        navController = rootNavController,
        startDestination = startDest
    ) {
        composable("auth") {
            AuthScreen(
                viewModel = authViewModel,
                onLoginSuccess = {
                    rootNavController.navigate("main") {
                        popUpTo("auth") { inclusive = true }
                    }
                }
            )
        }

        composable("main") {
            val chatListStateLocal by chatListViewModel.uiState.collectAsState()

            LaunchedEffect(authState.user) {
                authState.user?.let { user ->
                    if (!chatListStateLocal.isConnected) {
                        chatListViewModel.connect(user)
                    }
                }
            }

            LaunchedEffect(chatListStateLocal.createdChatId) {
                val chatId = chatListStateLocal.createdChatId ?: return@LaunchedEffect
                val chat = chatListStateLocal.chats.find { it.id == chatId } ?: return@LaunchedEffect
                val json = Gson().toJson(chat)
                val encoded = java.net.URLEncoder.encode(json, "UTF-8")
                rootNavController.navigate("chat/$encoded")
                chatListViewModel.resetCreatedChatId()
            }

            MainScreen(
                authViewModel = authViewModel,
                chatListViewModel = chatListViewModel,
                themeViewModel = themeViewModel,
                onChatClick = { chat ->
                    chatListViewModel.resetUnread(chat.id)
                    val json = Gson().toJson(chat)
                    val encoded = java.net.URLEncoder.encode(json, "UTF-8")
                    rootNavController.navigate("chat/$encoded")
                },
                onLogout = {
                    chatListViewModel.disconnect()
                    authViewModel.logout()
                    rootNavController.navigate("auth") {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }

        composable("chat/{chatJson}") { backStackEntry ->
            val chatJson = backStackEntry.arguments?.getString("chatJson") ?: ""
            val chat = try {
                Gson().fromJson(java.net.URLDecoder.decode(chatJson, "UTF-8"), Chat::class.java)
            } catch (e: Exception) { null }

            val authStateLocal by authViewModel.uiState.collectAsState()
            val chatViewModel: ChatViewModel = viewModel()

            LaunchedEffect(chat) {
                chat?.let { c ->
                    authStateLocal.user?.let { user ->
                        chatViewModel.connectToChat(c, user)
                    }
                }
            }

            DisposableEffect(Unit) {
                onDispose {
                    chatViewModel.disconnect()
                }
            }

            ChatScreen(
                viewModel = chatViewModel,
                onBack = {
                    rootNavController.popBackStack()
                },
                pendingShareText = pendingShareText,
                pendingShareMediaUris = pendingShareMedia
            )

            LaunchedEffect(pendingShareText, pendingShareMedia) {
                if (pendingShareText != null || pendingShareMedia.isNotEmpty()) {
                    pendingShareText = null
                    pendingShareMedia = emptyList()
                    onShareConsumed()
                }
            }
        }
    }
}

@Composable
fun MainScreen(
    authViewModel: AuthViewModel,
    chatListViewModel: ChatListViewModel,
    themeViewModel: ThemeViewModel,
    onChatClick: (Chat) -> Unit,
    onLogout: () -> Unit
) {
    var selectedTab by remember { mutableStateOf(0) }

    Scaffold(
        bottomBar = {
            NavigationBar(
                containerColor = MaterialTheme.colorScheme.surface
            ) {
                val items = listOf(
                    BottomNavItem("Чаты", Icons.Default.Chat, "chats"),
                    BottomNavItem("Контакты", Icons.Default.Person, "contacts"),
                    BottomNavItem("Настройки", Icons.Default.Settings, "settings")
                )
                items.forEachIndexed { index, item ->
                    NavigationBarItem(
                        icon = { Icon(item.icon, contentDescription = item.label) },
                        label = { Text(item.label) },
                        selected = selectedTab == index,
                        onClick = { selectedTab = index },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = Purple500,
                            selectedTextColor = Purple500,
                            indicatorColor = Purple500.copy(alpha = 0.15f)
                        )
                    )
                }
            }
        }
    ) { padding ->
        Box(modifier = Modifier.padding(padding)) {
            when (selectedTab) {
                0 -> {
                    ChatListScreen(
                        viewModel = chatListViewModel,
                        onChatClick = onChatClick,
                        onLogout = onLogout
                    )
                }
                1 -> {
                    ContactsScreen(
                        viewModel = chatListViewModel,
                        onUserClick = { user -> chatListViewModel.createChat(user.id) }
                    )
                }
                2 -> {
                    ProfileScreen(
                        user = authViewModel.uiState.value.user,
                        themeViewModel = themeViewModel,
                        onLogout = onLogout,
                        onUserUpdated = { updatedUser ->
                            authViewModel.saveUser(updatedUser)
                        }
                    )
                }
            }
        }
    }
}

data class BottomNavItem(
    val label: String,
    val icon: ImageVector,
    val route: String
)
