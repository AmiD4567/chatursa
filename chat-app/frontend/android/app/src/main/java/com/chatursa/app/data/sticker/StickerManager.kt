package com.chatursa.app.data.sticker

import android.content.Context
import android.content.SharedPreferences
import com.chatursa.app.AppConfig
import com.chatursa.app.data.model.StickerCatalog
import com.chatursa.app.data.model.StickerCategory
import com.chatursa.app.data.model.StickerItem
import com.chatursa.app.data.model.StickerVariant
import org.json.JSONObject

object StickerManager {

    private const val PREFS_NAME = "sticker_prefs"
    private const val RECENT_KEY = "recent_stickers"
    private const val MAX_RECENT = 32
    private const val STICKER_MARKER = "\u0000STICKER\u0000"

    private var catalog: StickerCatalog? = null
    private var recentList: MutableList<StickerItem> = mutableListOf()

    fun loadCatalog(context: Context): StickerCatalog {
        catalog?.let { return it }

        val json = loadJsonFromAssets(context, "stickerData.json") ?: return StickerCatalog(emptyMap())
        val variants = mutableMapOf<String, StickerVariant>()

        val root = JSONObject(json)
        val variantNames = root.keys()
        while (variantNames.hasNext()) {
            val vName = variantNames.next() as String
            val vObj = root.getJSONObject(vName)
            val categories = mutableMapOf<String, StickerCategory>()
            val catsObj = vObj.getJSONObject("categories")
            val catNames = catsObj.keys()
            while (catNames.hasNext()) {
                val cName = catNames.next() as String
                val cObj = catsObj.getJSONObject(cName)
                val stickers = mutableListOf<StickerItem>()
                val arr = cObj.getJSONArray("stickers")
                for (i in 0 until arr.length()) {
                    val s = arr.getJSONObject(i)
                    stickers.add(StickerItem(
                        name = s.getString("name"),
                        file = s.getString("file"),
                        emoji = s.optString("emoji", "")
                    ))
                }
                categories[cName] = StickerCategory(
                    icon = cObj.getString("icon"),
                    stickers = stickers
                )
            }
            variants[vName] = StickerVariant(
                label = vObj.getString("label"),
                icon = vObj.getString("icon"),
                categories = categories
            )
        }

        val result = StickerCatalog(variants)
        catalog = result
        return result
    }

    fun getRecentStickers(): List<StickerItem> = recentList.toList()

    fun loadRecentStickers(context: Context) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val json = prefs.getString(RECENT_KEY, null) ?: return
        try {
            val arr = org.json.JSONArray(json)
            recentList.clear()
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                recentList.add(StickerItem(
                    name = obj.getString("name"),
                    file = obj.getString("file"),
                    emoji = obj.optString("emoji", "")
                ))
            }
        } catch (_: Exception) {}
    }

    fun addStickerToHistory(context: Context, sticker: StickerItem) {
        recentList.removeAll { it.file == sticker.file }
        recentList.add(0, sticker)
        if (recentList.size > MAX_RECENT) recentList.removeAt(recentList.lastIndex)
        saveRecent(context)
    }

    private fun saveRecent(context: Context) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val arr = org.json.JSONArray()
        for (s in recentList) {
            arr.put(org.json.JSONObject().apply {
                put("name", s.name)
                put("file", s.file)
                put("emoji", s.emoji)
            })
        }
        prefs.edit().putString(RECENT_KEY, arr.toString()).apply()
    }

    fun stickerUrl(file: String): String {
        val parts = file.split("/").joinToString("/") { java.net.URLEncoder.encode(it, "UTF-8").replace("+", "%20") }
        return "${AppConfig.SOCKET_URL}/stickers/$parts"
    }

    fun isStickerOnlyMessage(text: String): Boolean {
        val cleaned = text.trim().removeSurrounding("\"")
        val marker = STICKER_MARKER
        val first = cleaned.indexOf(marker)
        val last = cleaned.lastIndexOf(marker)
        return first == 0 && last == cleaned.length - marker.length && first < last
    }

    fun stripStickerMarkers(text: String): String {
        if (text.isBlank()) return text
        val parts = text.split(STICKER_MARKER)
        val sb = StringBuilder()
        for (i in parts.indices) {
            if (i % 2 == 0) {
                sb.append(parts[i])
            }
        }
        val result = sb.toString().trim()
        return if (result.isBlank() && text.contains(STICKER_MARKER)) "🎨 Стикер" else result
    }

    fun parseStickerFiles(text: String): List<String> {
        val result = mutableListOf<String>()
        val parts = text.split(STICKER_MARKER)
        for (i in parts.indices) {
            if (i % 2 == 1) {
                val f = parts[i].trim()
                if (f.isNotEmpty()) result.add(f)
            }
        }
        return result
    }

    fun wrapStickerText(filePath: String): String = "${STICKER_MARKER}${filePath}${STICKER_MARKER}"

    private fun loadJsonFromAssets(context: Context, filename: String): String? {
        return try {
            context.assets.open(filename).bufferedReader().use { it.readText() }
        } catch (e: Exception) { null }
    }
}
