package com.chatursa.app

object AppConfig {
    const val SERVER_URL = "http://192.168.210.48:3001"
    const val SOCKET_URL = SERVER_URL
    val APP_VERSION: String get() = "1.3"
    const val GITHUB_REPO_OWNER = "AmiD4567"
    const val GITHUB_REPO_NAME = "chatursa.apk"
    const val GITHUB_API_URL = "https://api.github.com/repos/$GITHUB_REPO_OWNER/$GITHUB_REPO_NAME/releases/latest"
}



