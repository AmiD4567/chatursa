package com.chatursa.app

import android.app.Application
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.LifecycleOwner

object AppLifecycleObserver : LifecycleEventObserver {
    var isInForeground = true
        private set

    override fun onStateChanged(source: LifecycleOwner, event: Lifecycle.Event) {
        when (event) {
            Lifecycle.Event.ON_START -> isInForeground = true
            Lifecycle.Event.ON_STOP -> isInForeground = false
            else -> {}
        }
    }
}
