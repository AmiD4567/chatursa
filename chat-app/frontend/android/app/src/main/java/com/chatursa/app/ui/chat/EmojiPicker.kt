package com.chatursa.app.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
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
import com.chatursa.app.data.sticker.EmojiManager
import com.chatursa.app.ui.theme.Purple500
import com.chatursa.app.ui.theme.TextSecondary

@Composable
fun EmojiPicker(
    onEmojiSelected: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val categories = remember { EmojiManager.loadCategories(context) }
    var recent by remember { mutableStateOf(EmojiManager.getRecent(context)) }
    var showRecent by rememberSaveable { mutableStateOf(recent.isNotEmpty()) }
    var selectedIndex by rememberSaveable { mutableStateOf(0) }

    val current: List<String> = if (showRecent) recent
        else categories.getOrNull(selectedIndex)?.second ?: emptyList()

    Column(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 200.dp, max = 300.dp)
            .background(MaterialTheme.colorScheme.surface)
    ) {
        LazyRow(
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
        ) {
            if (recent.isNotEmpty()) {
                item {
                    Text(
                        text = "🕘",
                        fontSize = 18.sp,
                        modifier = Modifier
                            .padding(horizontal = 8.dp)
                            .clickable { showRecent = true }
                    )
                }
            }
            rowItems(categories.indices.toList()) { idx ->
                val selected = !showRecent && idx == selectedIndex
                Text(
                    text = categories[idx].first,
                    fontSize = 12.sp,
                    color = if (selected) Purple500 else TextSecondary,
                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                    modifier = Modifier
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                        .clickable {
                            showRecent = false
                            selectedIndex = idx
                        }
                )
            }
        }

        if (current.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                contentAlignment = Alignment.Center
            ) {
                Text("Нет эмодзи", color = TextSecondary)
            }
        } else {
            LazyVerticalGrid(
                columns = GridCells.Fixed(8),
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                contentPadding = PaddingValues(6.dp)
            ) {
                items(current) { emoji ->
                    Box(
                        modifier = Modifier
                            .padding(2.dp)
                            .size(38.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .clickable {
                                EmojiManager.addRecent(context, emoji)
                                recent = EmojiManager.getRecent(context)
                                onEmojiSelected(emoji)
                            },
                        contentAlignment = Alignment.Center
                    ) {
                        Text(text = emoji, fontSize = 24.sp)
                    }
                }
            }
        }
    }
}
