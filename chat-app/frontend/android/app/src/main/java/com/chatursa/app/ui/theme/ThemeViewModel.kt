package com.chatursa.app.ui.theme

import android.app.Application
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel

class ThemeViewModel(application: Application) : AndroidViewModel(application) {
    private val prefs = application.getSharedPreferences("chat_ursa_theme", Context.MODE_PRIVATE)

    var isDarkMode by mutableStateOf(prefs.getBoolean("is_dark_mode", true))
        private set

    var chatBackgroundIndex by mutableStateOf(prefs.getInt("chat_background", 0))
        private set

    fun toggleDarkMode(dark: Boolean) {
        isDarkMode = dark
        prefs.edit().putBoolean("is_dark_mode", dark).apply()
    }

    fun setChatBackground(index: Int) {
        chatBackgroundIndex = index
        prefs.edit().putInt("chat_background", index).apply()
    }
}
