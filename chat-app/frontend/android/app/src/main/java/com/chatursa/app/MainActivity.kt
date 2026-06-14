package com.chatursa.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.viewmodel.compose.viewModel
import com.chatursa.app.ui.navigation.AppNavGraph
import com.chatursa.app.ui.theme.ChatUrsaTheme
import com.chatursa.app.ui.theme.ThemeViewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val sharedText = extractSharedText(intent)
        val sharedImageUri = extractSharedImageUri(intent)
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
