package com.chatursa.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.viewmodel.compose.viewModel
import com.chatursa.app.data.BiometricLockManager
import com.chatursa.app.ui.navigation.AppNavGraph
import com.chatursa.app.ui.theme.ChatUrsaTheme
import com.chatursa.app.ui.theme.ThemeViewModel

class MainActivity : FragmentActivity() {

    private var biometricPending = false
    private var contentReady = false

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val sharedText = extractSharedText(intent)
        val sharedImageUri = extractSharedImageUri(intent)

        if (BiometricLockManager.isEnabled(this)) {
            biometricPending = true
            showBiometricGate {
                biometricPending = false
                contentReady = true
                setAppContent(sharedText, sharedImageUri)
            }
        } else {
            contentReady = true
            setAppContent(sharedText, sharedImageUri)
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

    private fun setAppContent(sharedText: String?, sharedImageUri: Uri?) {
        setContent {
            val themeViewModel: ThemeViewModel = viewModel()
            ChatUrsaTheme(themeViewModel = themeViewModel) {
                AppNavGraph(
                    themeViewModel = themeViewModel,
                    sharedText = sharedText,
                    sharedImageUri = sharedImageUri
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
    }

    private fun extractSharedText(intent: Intent): String? {
        if (intent.action != Intent.ACTION_SEND) return null
        if (intent.type != "text/plain") return null
        return intent.getStringExtra(Intent.EXTRA_TEXT)
    }

    private fun extractSharedImageUri(intent: Intent): Uri? {
        if (intent.action != Intent.ACTION_SEND) return null
        val type = intent.type ?: return null
        if (!type.startsWith("image/")) return null
        return intent.getParcelableExtra(Intent.EXTRA_STREAM)
    }
}
