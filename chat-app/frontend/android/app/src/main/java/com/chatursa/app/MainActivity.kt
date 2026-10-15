package com.chatursa.app

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.viewmodel.compose.viewModel
import com.chatursa.app.data.BiometricLockManager
import com.chatursa.app.ui.navigation.AppNavGraph
import com.chatursa.app.ui.theme.ChatUrsaTheme
import com.chatursa.app.ui.theme.ThemeViewModel
import java.io.File

class MainActivity : FragmentActivity() {

    private var biometricPending = false
    private var contentReady = false

    private val deepLinkChatId = mutableStateOf<String?>(null)
    private val sharedTextState = mutableStateOf<String?>(null)
    private val sharedMediaState = mutableStateOf<List<String>>(emptyList())

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        consumeIntent(intent)
        requestNotificationPermissionIfNeeded()

        if (BiometricLockManager.isEnabled(this)) {
            biometricPending = true
            showBiometricGate {
                biometricPending = false
                contentReady = true
                setAppContent()
            }
        } else {
            contentReady = true
            setAppContent()
        }

        lifecycle.addObserver(LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_STOP -> {
                    if (BiometricLockManager.isEnabled(this) && contentReady) {
                        biometricPending = true
                    }
                }
                Lifecycle.Event.ON_START -> {
                    if (BiometricLockManager.isEnabled(this) && biometricPending && contentReady) {
                        showBiometricGate {
                            biometricPending = false
                        }
                    }
                }
                else -> {}
            }
        })
    }

    private fun showBiometricGate(onAuth: () -> Unit) {
        BiometricLockManager.authenticate(
            activity = this,
            onSuccess = {
                onAuth()
            },
            onError = { error ->
                Toast.makeText(this, "Ошибка: $error", Toast.LENGTH_SHORT).show()
                Handler(Looper.getMainLooper()).postDelayed({
                    showBiometricGate(onAuth)
                }, 1000)
            }
        )
    }

    private fun setAppContent() {
        setContent {
            val themeViewModel: ThemeViewModel = viewModel()
            ChatUrsaTheme(themeViewModel = themeViewModel) {
                LastCrashLogDialog()
                AppNavGraph(
                    themeViewModel = themeViewModel,
                    sharedText = sharedTextState.value,
                    pendingShareMediaUris = sharedMediaState.value,
                    deepLinkChatId = deepLinkChatId.value,
                    onDeepLinkConsumed = { deepLinkChatId.value = null },
                    onShareConsumed = {
                        sharedTextState.value = null
                        sharedMediaState.value = emptyList()
                    }
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        consumeIntent(intent)
    }

    private fun consumeIntent(intent: Intent?) {
        if (intent == null) return
        intent.getStringExtra("chatId")?.let { deepLinkChatId.value = it }
        extractSharedText(intent)?.let { sharedTextState.value = it }
        val media = extractSharedMedia(intent)
        if (media.isNotEmpty()) sharedMediaState.value = media
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001)
            }
        }
    }

    private fun extractSharedText(intent: Intent): String? {
        if (intent.action != Intent.ACTION_SEND) return null
        if (intent.type != "text/plain") return null
        return intent.getStringExtra(Intent.EXTRA_TEXT)
    }

    @Suppress("DEPRECATION")
    private fun extractSharedMedia(intent: Intent): List<String> {
        val type = intent.type ?: return emptyList()
        if (!type.startsWith("image/") && !type.startsWith("video/")) return emptyList()
        return when (intent.action) {
            Intent.ACTION_SEND -> {
                val uri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
                listOfNotNull(uri?.toString())
            }
            Intent.ACTION_SEND_MULTIPLE -> {
                intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.map { it.toString() }
                    ?: emptyList()
            }
            else -> emptyList()
        }
    }
}

@Composable
private fun LastCrashLogDialog() {
    val context = LocalContext.current
    var crashText by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        val extFile = context.getExternalFilesDir(null)?.let { File(it, "crash_log.txt") }
        val cacheFile = File(context.cacheDir, "crash_log.txt")
        val file = extFile?.takeIf { it.exists() } ?: cacheFile.takeIf { it.exists() }
        if (file != null) {
            crashText = file.readText().takeIf { it.isNotBlank() }
        }
    }

    val text = crashText ?: return

    fun dismiss() {
        crashText = null
        context.getExternalFilesDir(null)?.let { File(it, "crash_log.txt").delete() }
        File(context.cacheDir, "crash_log.txt").delete()
    }

    AlertDialog(
        onDismissRequest = { dismiss() },
        title = { Text("Последний краш") },
        text = {
            Text(
                text = text,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 320.dp)
                    .verticalScroll(rememberScrollState())
            )
        },
        confirmButton = {
            TextButton(onClick = {
                val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText("crash_log", text))
                Toast.makeText(context, "Скопировано", Toast.LENGTH_SHORT).show()
            }) {
                Text("Копировать")
            }
        },
        dismissButton = {
            TextButton(onClick = { dismiss() }) {
                Text("ОК")
            }
        }
    )
}
