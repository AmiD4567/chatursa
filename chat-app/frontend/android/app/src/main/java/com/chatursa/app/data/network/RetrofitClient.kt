package com.chatursa.app.data.network

import android.util.Log
import com.chatursa.app.AppConfig
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.logging.HttpLoggingInterceptor
import org.json.JSONObject
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object RetrofitClient {

    private const val TAG = "RetrofitClient"
    private var csrfToken: String? = null

    private val loggingInterceptor = HttpLoggingInterceptor().apply {
        level = HttpLoggingInterceptor.Level.BODY
    }

    private val csrfInterceptor = Interceptor { chain ->
        val request = chain.request()
        val method = request.method.uppercase()
        if (method in listOf("POST", "PUT", "PATCH", "DELETE")) {
            val token = getCsrfToken()
            if (token != null) {
                val newRequest = request.newBuilder()
                    .header("X-CSRF-Token", token)
                    .build()
                val response = chain.proceed(newRequest)
                if (response.code == 403) {
                    csrfToken = null
                    val retryToken = getCsrfToken()
                    if (retryToken != null) {
                        response.close()
                        val retryRequest = request.newBuilder()
                            .header("X-CSRF-Token", retryToken)
                            .build()
                        return@Interceptor chain.proceed(retryRequest)
                    }
                }
                return@Interceptor response
            }
        }
        chain.proceed(request)
    }

    private val okHttpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .addInterceptor(loggingInterceptor)
        .addInterceptor(csrfInterceptor)
        .build()

    private val retrofit = Retrofit.Builder()
        .baseUrl("${AppConfig.SERVER_URL}/")
        .client(okHttpClient)
        .addConverterFactory(GsonConverterFactory.create())
        .build()

    val apiService: ApiService = retrofit.create(ApiService::class.java)

    private fun getCsrfToken(): String? {
        if (csrfToken != null) return csrfToken
        return try {
            val url = java.net.URL("${AppConfig.SERVER_URL}/api/csrf-token")
            val conn = url.openConnection() as java.net.HttpURLConnection
            conn.connectTimeout = 5000
            conn.readTimeout = 5000
            val json = JSONObject(conn.inputStream.bufferedReader().readText())
            csrfToken = json.optString("csrfToken", null)
            Log.d(TAG, "CSRF token fetched: $csrfToken")
            csrfToken
        } catch (e: Exception) {
            Log.e(TAG, "Failed to fetch CSRF token", e)
            null
        }
    }
}
