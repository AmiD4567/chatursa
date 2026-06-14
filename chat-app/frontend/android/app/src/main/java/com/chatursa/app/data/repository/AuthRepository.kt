package com.chatursa.app.data.repository

import com.chatursa.app.data.model.*
import com.chatursa.app.data.network.ApiResult
import com.chatursa.app.data.network.RetrofitClient
import com.google.gson.Gson

class AuthRepository {

    private val api = RetrofitClient.apiService
    private val gson = Gson()

    suspend fun login(email: String, password: String): ApiResult<User> {
        return try {
            val response = api.login(LoginRequest(email, password))
            if (response.isSuccessful) {
                val body = response.body()
                if (body?.user != null) {
                    ApiResult.Success(body.user.copy(avatar = body.user.avatar?.ifEmpty { null }))
                } else {
                    ApiResult.Error("Неверный email или пароль")
                }
            } else {
                val errorBody = response.errorBody()?.string()
                val errorMsg = try {
                    gson.fromJson(errorBody, Map::class.java)["error"] as? String
                } catch (e: Exception) { null }
                ApiResult.Error(errorMsg ?: "Ошибка входа", response.code())
            }
        } catch (e: Exception) {
            ApiResult.Error("Ошибка сети: ${e.localizedMessage ?: "Неизвестная ошибка"}")
        }
    }

    suspend fun register(
        username: String,
        email: String,
        password: String,
        confirmPassword: String,
        birthDate: String
    ): ApiResult<User> {
        return try {
            val response = api.register(
                RegisterRequest(username, email, password, confirmPassword, birthDate)
            )
            if (response.isSuccessful) {
                val body = response.body()
                if (body?.user != null) {
                    ApiResult.Success(body.user.copy(avatar = body.user.avatar?.ifEmpty { null }))
                } else {
                    ApiResult.Error("Ошибка регистрации")
                }
            } else {
                val errorBody = response.errorBody()?.string()
                val errorMsg = try {
                    gson.fromJson(errorBody, Map::class.java)["error"] as? String
                } catch (e: Exception) { null }
                ApiResult.Error(errorMsg ?: "Ошибка регистрации", response.code())
            }
        } catch (e: Exception) {
            ApiResult.Error("Ошибка сети: ${e.localizedMessage ?: "Неизвестная ошибка"}")
        }
    }
}
