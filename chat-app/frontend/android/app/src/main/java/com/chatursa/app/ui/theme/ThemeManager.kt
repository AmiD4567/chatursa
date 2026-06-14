package com.chatursa.app.ui.theme

import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

data class ChatBackground(
    val id: Int,
    val name: String,
    val darkBrush: Brush?,
    val lightBrush: Brush?
)

val chatBackgrounds: List<ChatBackground> = listOf(
    ChatBackground(0, "Нет", null, null),
    ChatBackground(1, "Закат",
        Brush.linearGradient(listOf(Color(0xFF1A0A00), Color(0xFF3D1A00), Color(0xFF1A0A00))),
        Brush.linearGradient(listOf(Color(0xFFFFF5EB), Color(0xFFFFE0B2), Color(0xFFFFF5EB)))),
    ChatBackground(2, "Океан",
        Brush.linearGradient(listOf(Color(0xFF001220), Color(0xFF003355), Color(0xFF001220))),
        Brush.linearGradient(listOf(Color(0xFFE3F2FD), Color(0xFFBBDEFB), Color(0xFFE3F2FD)))),
    ChatBackground(3, "Лес",
        Brush.linearGradient(listOf(Color(0xFF001A00), Color(0xFF003D00), Color(0xFF001A00))),
        Brush.linearGradient(listOf(Color(0xFFE8F5E9), Color(0xFFC8E6C9), Color(0xFFE8F5E9)))),
    ChatBackground(4, "Лаванда",
        Brush.linearGradient(listOf(Color(0xFF1A0020), Color(0xFF3D004D), Color(0xFF1A0020))),
        Brush.linearGradient(listOf(Color(0xFFF3E5F5), Color(0xFFE1BEE7), Color(0xFFF3E5F5)))),
    ChatBackground(5, "Неон",
        Brush.linearGradient(listOf(Color(0xFF0A0020), Color(0xFF2A0066), Color(0xFF0A0020))),
        Brush.linearGradient(listOf(Color(0xFFF3E8FF), Color(0xFFE1D5FF), Color(0xFFF3E8FF)))),
    ChatBackground(6, "Песок",
        Brush.linearGradient(listOf(Color(0xFF1A1A00), Color(0xFF3D3D00), Color(0xFF1A1A00))),
        Brush.linearGradient(listOf(Color(0xFFFFF8E1), Color(0xFFFFECB3), Color(0xFFFFF8E1)))),
    ChatBackground(7, "Вишня",
        Brush.linearGradient(listOf(Color(0xFF20000A), Color(0xFF4D001A), Color(0xFF20000A))),
        Brush.linearGradient(listOf(Color(0xFFFCE4EC), Color(0xFFF8BBD0), Color(0xFFFCE4EC)))),
    ChatBackground(8, "Мята",
        Brush.linearGradient(listOf(Color(0xFF00200A), Color(0xFF004D1A), Color(0xFF00200A))),
        Brush.linearGradient(listOf(Color(0xFFE0F2F1), Color(0xFFB2DFDB), Color(0xFFE0F2F1)))),
    ChatBackground(9, "Космос",
        Brush.linearGradient(listOf(Color(0xFF000020), Color(0xFF1A003D), Color(0xFF000020))),
        Brush.linearGradient(listOf(Color(0xFFE8EAF6), Color(0xFFC5CAE9), Color(0xFFE8EAF6)))),
    ChatBackground(10, "Осень",
        Brush.linearGradient(listOf(Color(0xFF201000), Color(0xFF4D2600), Color(0xFF201000))),
        Brush.linearGradient(listOf(Color(0xFFFFF3E0), Color(0xFFFFE0B2), Color(0xFFFFF3E0)))),
    ChatBackground(11, "Арктика",
        Brush.linearGradient(listOf(Color(0xFF002020), Color(0xFF004D4D), Color(0xFF002020))),
        Brush.linearGradient(listOf(Color(0xFFE0F7FA), Color(0xFFB2EBF2), Color(0xFFE0F7FA)))),
    ChatBackground(12, "Тропики",
        Brush.linearGradient(listOf(Color(0xFF00200A), Color(0xFF003D1A), Color(0xFF00200A))),
        Brush.linearGradient(listOf(Color(0xFFE8F5E9), Color(0xFFA5D6A7), Color(0xFFE8F5E9)))),
    ChatBackground(13, "Фиолетовый",
        Brush.linearGradient(listOf(Color(0xFF1A0020), Color(0xFF3D005A), Color(0xFF1A0020))),
        Brush.linearGradient(listOf(Color(0xFFEDE7F6), Color(0xFFD1C4E9), Color(0xFFEDE7F6)))),
    ChatBackground(14, "Янтарь",
        Brush.linearGradient(listOf(Color(0xFF201800), Color(0xFF4D3D00), Color(0xFF201800))),
        Brush.linearGradient(listOf(Color(0xFFFFF8E1), Color(0xFFFFE082), Color(0xFFFFF8E1)))),
    ChatBackground(15, "Голубой",
        Brush.linearGradient(listOf(Color(0xFF001020), Color(0xFF003366), Color(0xFF001020))),
        Brush.linearGradient(listOf(Color(0xFFE3F2FD), Color(0xFF90CAF9), Color(0xFFE3F2FD)))),
    ChatBackground(16, "Шоколад",
        Brush.linearGradient(listOf(Color(0xFF1A0D00), Color(0xFF3D1F00), Color(0xFF1A0D00))),
        Brush.linearGradient(listOf(Color(0xFFEFEBE9), Color(0xFFD7CCC8), Color(0xFFEFEBE9)))),
    ChatBackground(17, "Рассвет",
        Brush.linearGradient(listOf(Color(0xFF1A0D1A), Color(0xFF4D264D), Color(0xFF1A0D1A))),
        Brush.linearGradient(listOf(Color(0xFFFCE4EC), Color(0xFFF48FB1), Color(0xFFFCE4EC)))),
    ChatBackground(18, "Изумруд",
        Brush.linearGradient(listOf(Color(0xFF001A0D), Color(0xFF003D1F), Color(0xFF001A0D))),
        Brush.linearGradient(listOf(Color(0xFFE0F2F1), Color(0xFF80CBC4), Color(0xFFE0F2F1)))),
    ChatBackground(19, "Туман",
        Brush.linearGradient(listOf(Color(0xFF0D0D1A), Color(0xFF262640), Color(0xFF0D0D1A))),
        Brush.linearGradient(listOf(Color(0xFFF5F5F5), Color(0xFFE0E0E0), Color(0xFFF5F5F5)))),
    ChatBackground(20, "Пламя",
        Brush.linearGradient(listOf(Color(0xFF200500), Color(0xFF5C1500), Color(0xFF200500))),
        Brush.linearGradient(listOf(Color(0xFFFFF3E0), Color(0xFFFFAB91), Color(0xFFFFF3E0))))
)

val LocalChatBackgroundBrush = staticCompositionLocalOf<Brush?> { null }
val LocalIsDarkMode = staticCompositionLocalOf { true }
