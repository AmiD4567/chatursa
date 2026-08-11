package com.chatursa.app

import android.content.Context
import okhttp3.OkHttpClient
import java.security.KeyStore
import java.security.SecureRandom
import java.security.cert.CertificateFactory
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

object ServerTls {

    @Volatile
    private var client: OkHttpClient? = null

    fun okHttpClient(context: Context): OkHttpClient {
        client?.let { return it }
        synchronized(this) {
            client?.let { return it }
            val trustManagerFactory = buildTrustManagerFactory(context)
            val sslContext = SSLContext.getInstance("TLS")
            sslContext.init(null, trustManagerFactory.trustManagers, SecureRandom())
            val trustManager = trustManagerFactory.trustManagers.firstOrNull()
                as? X509TrustManager ?: throw IllegalStateException("No X509 trust manager")
            val c = OkHttpClient.Builder()
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(60, TimeUnit.SECONDS)
                .writeTimeout(60, TimeUnit.SECONDS)
                .sslSocketFactory(sslContext.socketFactory, trustManager)
                .build()
            client = c
            return c
        }
    }

    private fun buildTrustManagerFactory(context: Context): TrustManagerFactory {
        val certificateFactory = CertificateFactory.getInstance("X.509")
        val caCertificate = context.assets.open("rootca.pem").use { input ->
            certificateFactory.generateCertificate(input)
        }
        val keyStore = KeyStore.getInstance(KeyStore.getDefaultType()).apply {
            load(null, null)
            setCertificateEntry("chatursa_rootca", caCertificate)
        }
        return TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply {
            init(keyStore)
        }
    }
}
