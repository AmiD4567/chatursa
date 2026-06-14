package com.chatursa.app.data.network

import android.media.MediaRecorder
import java.io.File

class AudioRecorder {

    private var mediaRecorder: MediaRecorder? = null
    private var outputFile: File? = null
    private var startTime: Long = 0L

    val isRecording: Boolean get() = mediaRecorder != null

    fun start(outputDir: File): File {
        stop()
        val file = File(outputDir, "voice_${System.currentTimeMillis()}.m4a")
        outputFile = file
        startTime = System.currentTimeMillis()

        mediaRecorder = MediaRecorder().apply {
            setAudioSource(MediaRecorder.AudioSource.MIC)
            setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            setAudioSamplingRate(44100)
            setAudioEncodingBitRate(192000)
            setAudioChannels(1)
            setMaxDuration(60000)
            setOutputFile(file.absolutePath)
            prepare()
            start()
        }
        return file
    }

    fun stop(): Triple<File?, Long, Long>? {
        val file = outputFile
        val duration = if (startTime > 0) System.currentTimeMillis() - startTime else 0L
        mediaRecorder?.apply {
            try {
                stop()
            } catch (e: Exception) {
            }
            release()
        }
        mediaRecorder = null
        outputFile = null
        startTime = 0L
        return if (file != null && file.exists()) Triple(file, duration, System.currentTimeMillis()) else null
    }

    fun cancel() {
        mediaRecorder?.apply {
            try {
                stop()
            } catch (e: Exception) {
            }
            release()
        }
        mediaRecorder = null
        outputFile?.delete()
        outputFile = null
        startTime = 0L
    }
}
