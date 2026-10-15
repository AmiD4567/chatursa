package com.chatursa.app.data.sticker

import android.content.Context
import org.json.JSONObject

object EmojiManager {

    private const val PREFS = "emoji_prefs"
    private const val RECENT_KEY = "recent_emojis"
    private const val MAX_RECENT = 48

    private var categories: List<Pair<String, List<String>>>? = null

    fun loadCategories(context: Context): List<Pair<String, List<String>>> {
        categories?.let { return it }
        val result = mutableListOf<Pair<String, List<String>>>()
        try {
            val json = context.assets.open("emojiData.json").bufferedReader().use { it.readText() }
            val root = JSONObject(json)
            val keys = root.keys()
            while (keys.hasNext()) {
                val name = keys.next() as String
                val obj = root.optJSONObject(name) ?: continue
                val arr = obj.optJSONArray("emojis") ?: continue
                val list = mutableListOf<String>()
                for (i in 0 until arr.length()) {
                    val e = arr.optJSONObject(i)?.optString("emoji", "") ?: ""
                    if (e.isNotEmpty()) list.add(e)
                }
                if (list.isNotEmpty()) result.add(name to list)
            }
        } catch (_: Exception) {}
        categories = result
        return result
    }

    fun getRecent(context: Context): List<String> {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val raw = prefs.getString(RECENT_KEY, null) ?: return emptyList()
        return try {
            val arr = org.json.JSONArray(raw)
            (0 until arr.length()).map { arr.getString(it) }
        } catch (_: Exception) { emptyList() }
    }

    fun addRecent(context: Context, emoji: String) {
        if (emoji.isBlank()) return
        val list = getRecent(context).toMutableList()
        list.remove(emoji)
        list.add(0, emoji)
        while (list.size > MAX_RECENT) list.removeAt(list.lastIndex)
        val arr = org.json.JSONArray()
        list.forEach { arr.put(it) }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(RECENT_KEY, arr.toString()).apply()
    }
}
