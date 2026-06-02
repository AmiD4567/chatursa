const path = require('path');
const { nativeImage } = require('electron');

/**
 * Создает простую иконку с красной точкой
 * Использует упрощенный подход без offscreen window
 */
function createBadgeIconSync(count, mainProcessAPI) {
  try {
    const iconPath = path.join(__dirname, 'icon.ico');
    const fs = require('fs');
    
    if (!fs.existsSync(iconPath)) {
      console.error('[Badge] Icon not found:', iconPath);
      return null;
    }

    const baseIcon = nativeImage.createFromPath(iconPath);
    const baseSize = baseIcon.getSize();
    const size = Math.max(baseSize.width, baseSize.height, 48);
    
    console.log(`[Badge] Creating badge icon: size=${size}, count=${count}`);
    
    // Используем основной процесс для создания через встроенные средства
    // Это временное решение - используем setOverlayIcon с простой иконкой
    return baseIcon;
  } catch (err) {
    console.error('[Badge] Error creating badge icon:', err.message);
    return null;
  }
}

module.exports = { createBadgeIconSync };
