package com.chatursa.app.data.model

data class StickerCatalog(
    val variants: Map<String, StickerVariant>
)

data class StickerVariant(
    val label: String,
    val icon: String,
    val categories: Map<String, StickerCategory>
)

data class StickerCategory(
    val icon: String,
    val stickers: List<StickerItem>
)

data class StickerItem(
    val name: String,
    val file: String,
    val emoji: String
)
