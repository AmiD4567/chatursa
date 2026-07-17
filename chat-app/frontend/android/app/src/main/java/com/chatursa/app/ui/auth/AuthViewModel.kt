package com.chatursa.app.ui.auth

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.chatursa.app.data.model.User
import com.chatursa.app.data.network.ApiResult
import com.chatursa.app.data.repository.AuthRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class AuthUiState(
    val isLoading: Boolean = false,
    val isLoggedIn: Boolean = false,
    val user: User? = null,
    val error: String? = null,
    val isLoginMode: Boolean = true
)

class AuthViewModel(application: Application) : AndroidViewModel(application) {

    private val repository = AuthRepository()
    private val prefs = application.getSharedPreferences("chat_ursa", 0)

    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    init {
        val savedUser = getSavedUser()
        if (savedUser != null) {
            _uiState.value = AuthUiState(isLoggedIn = true, user = savedUser)
        }
    }

    fun toggleMode() {
        _uiState.value = _uiState.value.copy(
            isLoginMode = !_uiState.value.isLoginMode,
            error = null
        )
    }

    fun login(email: String, password: String) {
        if (email.isBlank() || password.isBlank()) {
            _uiState.value = _uiState.value.copy(error = "Заполните все поля")
            return
        }

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            when (val result = repository.login(email.trim(), password)) {
                is ApiResult.Success -> {
                    saveUser(result.data)
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        isLoggedIn = true,
                        user = result.data
                    )
                }
                is ApiResult.Error -> {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = result.message
                    )
                }
            }
        }
    }

    fun register(username: String, email: String, password: String, confirmPassword: String, birthDate: String) {
        if (username.isBlank() || email.isBlank() || password.isBlank()) {
            _uiState.value = _uiState.value.copy(error = "Заполните все поля")
            return
        }
        if (password != confirmPassword) {
            _uiState.value = _uiState.value.copy(error = "Пароли не совпадают")
            return
        }

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            when (val result = repository.register(username.trim(), email.trim(), password, confirmPassword, birthDate)) {
                is ApiResult.Success -> {
                    saveUser(result.data)
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        isLoggedIn = true,
                        user = result.data
                    )
                }
                is ApiResult.Error -> {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = result.message
                    )
                }
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            try {
                val fcmToken = prefs.getString("fcm_token", null)
                if (fcmToken != null) {
                    com.chatursa.app.data.network.RetrofitClient.apiService
                        .registerFcmToken(mapOf("token" to fcmToken, "unregister" to "true"))
                }
            } catch (e: Exception) {
                android.util.Log.e("AuthVM", "logout FCM unregister error", e)
            }
        }
        getApplication<android.app.Application>()
            .getSharedPreferences("chat_prefs", 0)
            .edit()
            .clear()
            .apply()
        prefs.edit().clear().apply()
        _uiState.value = AuthUiState()
    }

    private fun getSavedUser(): User? {
        val json = prefs.getString("user_data", null) ?: return null
        return try {
            val gson = com.google.gson.Gson()
            gson.fromJson(json, User::class.java)
        } catch (e: Exception) { null }
    }

    fun saveUser(user: User) {
        val gson = com.google.gson.Gson()
        prefs.edit().putString("user_data", gson.toJson(user)).apply()
        getApplication<android.app.Application>()
            .getSharedPreferences("chat_prefs", 0)
            .edit()
            .putString("user_id", user.id)
            .apply()
    }
}
