package com.chatursa.app.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items as rowItems
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.chatursa.app.data.model.StickerItem
import com.chatursa.app.data.sticker.StickerManager
import com.chatursa.app.ui.theme.Purple500
import com.chatursa.app.ui.theme.TextSecondary

@Composable
fun StickerPicker(
    onStickerSelected: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val catalog = remember { StickerManager.loadCatalog(context) }
    val recent = remember {
        StickerManager.loadRecentStickers(context)
        StickerManager.getRecentStickers()
    }

    val variants = catalog.variants
    var selectedVariant by rememberSaveable { mutableStateOf(variants.keys.firstOrNull() ?: "") }
    var showRecent by rememberSaveable { mutableStateOf(true) }
    val categories = variants[selectedVariant]?.categories ?: emptyMap()
    var selectedCategory by rememberSaveable { mutableStateOf("") }

    LaunchedEffect(selectedVariant) {
        if (!categories.containsKey(selectedCategory)) {
            selectedCategory = categories.keys.firstOrNull() ?: ""
        }
    }

    val stickers: List<StickerItem> = if (showRecent) recent
        else categories[selectedCategory]?.stickers ?: emptyList()

    Column(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 220.dp, max = 320.dp)
            .background(MaterialTheme.colorScheme.surface)
    ) {
        // Variant tabs
        LazyRow(
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
        ) {
            rowItems(variants.keys.toList()) { key ->
                val selected = !showRecent && key == selectedVariant
                Text(
                    text = variants[key]?.label ?: key,
                    color = if (selected) Purple500 else TextSecondary,
                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                    modifier = Modifier
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                        .clickable {
                            showRecent = false
                            selectedVariant = key
                        }
                )
            }
        }

        // Category row
        if (!showRecent) {
            LazyRow(
                modifier = Modifier.fillMaxWidth(),
                contentPadding = PaddingValues(horizontal = 8.dp)
            ) {
                rowItems(categories.keys.toList()) { cat ->
                    val selected = cat == selectedCategory
                    Box(
                        modifier = Modifier
                            .padding(end = 8.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(
                                if (selected) Purple500.copy(alpha = 0.2f)
                                else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)
                            )
                            .clickable { selectedCategory = cat }
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                    ) {
                        Text(categories[cat]?.icon ?: "•", fontSize = 18.sp)
                    }
                }
            }
        }

        // Recent toggle
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = if (showRecent) "🕘 Недавние" else "🎨 Стикеры",
                color = if (showRecent) Purple500 else TextSecondary,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.clickable { showRecent = !showRecent }
            )
        }

        if (stickers.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = if (showRecent) "Нет недавних стикеров" else "Стикеры не найдены",
                    color = TextSecondary
                )
            }
        } else {
            LazyVerticalGrid(
                columns = GridCells.Fixed(4),
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                contentPadding = PaddingValues(8.dp)
            ) {
                items(stickers, key = { it.file }) { sticker ->
                    AsyncImage(
                        model = StickerManager.stickerUrl(sticker.file),
                        contentDescription = sticker.name,
                        modifier = Modifier
                            .padding(4.dp)
                            .size(72.dp)
                            .clickable { onStickerSelected(sticker.file) }
                    )
                }
            }
        }
    }
}
