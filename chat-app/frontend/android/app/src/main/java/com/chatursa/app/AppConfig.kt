package com.chatursa.app

import java.net.URLEncoder

object AppConfig {
    const val SERVER_URL = "http://192.168.210.48:3001"
    const val SOCKET_URL = SERVER_URL
    val APP_VERSION: String get() = "1.11"
    const val GITHUB_REPO_OWNER = "AmiD4567"
    const val GITHUB_REPO_NAME = "chatursa.apk"
    const val GITHUB_API_URL = "https://api.github.com/repos/$GITHUB_REPO_OWNER/$GITHUB_REPO_NAME/releases/latest"
}

fun avatarUrl(name: String?): String {
    val encoded = URLEncoder.encode(name?.trim()?.ifBlank { null } ?: "User", "UTF-8")
    return "https://ui-avatars.com/api/?name=$encoded&background=6C5CE7&color=fff&size=128"
}

fun avatarUrl(name: String?, size: Int): String {
    val encoded = URLEncoder.encode(name?.trim()?.ifBlank { null } ?: "User", "UTF-8")
    return "https://ui-avatars.com/api/?name=$encoded&background=6C5CE7&color=fff&size=$size"
}











