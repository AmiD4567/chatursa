package com.chatursa.app.ui.profile

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.chatursa.app.AppConfig
import com.chatursa.app.avatarUrl
import com.chatursa.app.data.model.User
import com.chatursa.app.data.network.UpdateManager
import com.chatursa.app.data.network.UpdateInfo
import com.chatursa.app.ui.ChatAvatar
import com.chatursa.app.ui.theme.*
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import com.chatursa.app.data.network.RetrofitClient
import java.io.File
import java.io.FileOutputStream

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(
    user: User?,
    themeViewModel: com.chatursa.app.ui.theme.ThemeViewModel,
    onLogout: () -> Unit,
    onUserUpdated: (User) -> Unit = {}
) {
    var showThemeSettings by remember { mutableStateOf(false) }

    if (showThemeSettings) {
        com.chatursa.app.ui.theme.ThemeSettingsScreen(
            themeViewModel = themeViewModel,
            onBack = { showThemeSettings = false }
        )
        return
    }
    var showLogoutDialog by remember { mutableStateOf(false) }
    var showEditDialog by remember { mutableStateOf(false) }
    var editUsername by remember { mutableStateOf(user?.username ?: "") }
    var editStatus by remember { mutableStateOf(user?.statusText ?: "") }
    var editAbout by remember { mutableStateOf(user?.about ?: "") }
    var selectedImageUri by remember { mutableStateOf<Uri?>(null) }
    var isUploading by remember { mutableStateOf(false) }
    var updateInfo by remember { mutableStateOf<UpdateInfo?>(null) }
    var isCheckingUpdate by remember { mutableStateOf(false) }
    var isDownloading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    val imagePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        selectedImageUri = uri
        if (uri != null && user != null) {
            isUploading = true
            scope.launch {
                try {
                    val inputStream = context.contentResolver.openInputStream(uri)
                    val file = File(context.cacheDir, "avatar_${user.id}.jpg")
                    inputStream?.let {
                        FileOutputStream(file).use { output ->
                            it.copyTo(output)
                        }
                        it.close()
                    }
                    val requestBody = file.asRequestBody("image/*".toMediaTypeOrNull())
                    val part = MultipartBody.Part.createFormData("avatar", file.name, requestBody)
                    val response = RetrofitClient.apiService.uploadAvatar(part)
                    if (response.isSuccessful) {
                        onUserUpdated(user)
                    }
                } catch (e: Exception) { e.printStackTrace() }
                isUploading = false
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
    ) {
        // Header
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(Purple500)
                .padding(24.dp),
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Box {
                    ChatAvatar(
                        avatarUrl = user?.avatar?.ifEmpty { null },
                        name = user?.username,
                        size = 96.dp
                    )
                    if (isUploading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(96.dp),
                            color = Color.White,
                            strokeWidth = 3.dp
                        )
                    } else {
                        IconButton(
                            onClick = { imagePickerLauncher.launch("image/*") },
                            modifier = Modifier
                                .align(Alignment.BottomEnd)
                                .size(28.dp)
                                .background(Purple700, CircleShape)
                        ) {
                            Icon(Icons.Default.PhotoCamera, "Сменить аватар",
                                tint = Color.White, modifier = Modifier.size(16.dp))
                        }
                    }
                }
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = user?.username ?: "Пользователь",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    color = Color.White
                )
                if (!user?.statusText.isNullOrBlank()) {
                    Text(
                        text = user!!.statusText,
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color.White.copy(alpha = 0.8f)
                    )
                }
                if (user?.email != null) {
                    Text(
                        text = user.email,
                        style = MaterialTheme.typography.bodySmall,
                        color = Color.White.copy(alpha = 0.6f)
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .clickable { showEditDialog = true },
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column {
                ProfileMenuItem(Icons.Default.Person, "Имя пользователя", user?.username ?: "")
                if (!user?.statusText.isNullOrBlank()) {
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, thickness = 0.5.dp)
                    ProfileMenuItem(Icons.Default.EmojiEmotions, "Статус", user!!.statusText)
                }
                if (!user?.about.isNullOrBlank()) {
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, thickness = 0.5.dp)
                    ProfileMenuItem(Icons.Default.Info, "О себе", user!!.about)
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, thickness = 0.5.dp)
                ProfileMenuItem(Icons.Default.Email, "Email", user?.email ?: "")
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, thickness = 0.5.dp)
                ProfileMenuItem(Icons.Default.Badge, "ID", user?.id?.take(8) ?: "")
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, thickness = 0.5.dp)
                Box(modifier = Modifier.padding(16.dp)) {
                    Text("Нажмите, чтобы редактировать", style = MaterialTheme.typography.bodySmall,
                        color = Purple500)
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .clickable { showThemeSettings = true },
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column {
                ProfileMenuItem(Icons.Default.Info, "Версия", "1.0.0")
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, thickness = 0.5.dp)
                ProfileMenuItem(
                    icon = Icons.Default.Palette,
                    label = "Тема",
                    value = if (themeViewModel.isDarkMode) "Тёмная" else "Светлая"
                )
            }
        }

        Spacer(modifier = Modifier.weight(1f))

        // Update section
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Default.SystemUpdateAlt, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(24.dp))
                    Spacer(modifier = Modifier.width(16.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Версия приложения", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(AppConfig.APP_VERSION, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
                    }
                    when {
                        isCheckingUpdate -> CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                        updateInfo != null -> {
                            if (updateInfo!!.hasUpdate) {
                                TextButton(onClick = {
                                    isDownloading = true
                                    UpdateManager(context).downloadAndInstall(updateInfo!!)
                                }) {
                                    Text(if (isDownloading) "Загрузка..." else "Обновить", color = Purple500)
                                }
                            } else {
                                Text("Актуальная", style = MaterialTheme.typography.bodySmall, color = Color(0xFF4CAF50))
                            }
                        }
                        else -> TextButton(onClick = {
                            isCheckingUpdate = true
                            scope.launch {
                                val info = UpdateManager(context).checkForUpdates()
                                updateInfo = info
                                isCheckingUpdate = false
                            }
                        }) { Text("Проверить", color = Purple500) }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        Button(
            onClick = { showLogoutDialog = true },
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .height(48.dp),
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = Color.Transparent,
                contentColor = ErrorRed
            )
        ) {
            Icon(Icons.Default.Logout, "Выйти")
            Spacer(modifier = Modifier.width(8.dp))
            Text("Выйти", fontWeight = FontWeight.Medium)
        }

        Spacer(modifier = Modifier.height(32.dp))
    }

    if (showLogoutDialog) {
        AlertDialog(
            onDismissRequest = { showLogoutDialog = false },
            title = { Text("Выход") },
            text = { Text("Вы уверены, что хотите выйти?") },
            confirmButton = {
                TextButton(onClick = {
                    showLogoutDialog = false
                    onLogout()
                }) { Text("Выйти", color = ErrorRed) }
            },
            dismissButton = {
                TextButton(onClick = { showLogoutDialog = false }) { Text("Отмена") }
            },
            containerColor = MaterialTheme.colorScheme.surface
        )
    }

    if (showEditDialog) {
        AlertDialog(
            onDismissRequest = { showEditDialog = false },
            title = { Text("Редактировать профиль") },
            text = {
                Column {
                    OutlinedTextField(
                        value = editUsername,
                        onValueChange = { editUsername = it },
                        label = { Text("Имя пользователя") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = editStatus,
                        onValueChange = { editStatus = it },
                        label = { Text("Статус (например: 💼 На работе)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = editAbout,
                        onValueChange = { editAbout = it },
                        label = { Text("О себе") },
                        maxLines = 3,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    showEditDialog = false
                    scope.launch {
                        try {
                            RetrofitClient.apiService.updateProfile(mapOf(
                                "userId" to (user?.id ?: ""),
                                "username" to editUsername,
                                "statusText" to editStatus,
                                "about" to editAbout
                            ))
                            user?.let { u ->
                                onUserUpdated(u.copy(
                                    username = editUsername,
                                    statusText = editStatus.ifEmpty { null },
                                    about = editAbout.ifEmpty { null }
                                ))
                            }
                        } catch (e: Exception) { e.printStackTrace() }
                    }
                }) { Text("Сохранить") }
            },
            dismissButton = {
                TextButton(onClick = { showEditDialog = false }) { Text("Отмена") }
            },
            containerColor = MaterialTheme.colorScheme.surface
        )
    }
}

@Composable
fun ProfileMenuItem(icon: ImageVector, label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(24.dp)
        )
        Spacer(modifier = Modifier.width(16.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = value,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface
            )
        }
    }
}