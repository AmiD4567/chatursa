import React, { useState, useRef, useEffect } from 'react';
import './EmojiInlinePicker.css';
import emojiData from './emojiData.json';
import stickerData from './stickerData.json';

/** Извлекает unified код из emoji-символа (с удалением variation selectors) */
function getUnified(emoji) {
  const codePoints = [...emoji]
    .map(c => c.codePointAt(0))
    // Исключаем variation selectors (FE00-FE0F) и keycap (20E3)
    .filter(code => !(code >= 0xFE00 && code <= 0xFE0F) && code !== 0x20E3)
    .map(code => code.toString(16));

  let result = codePoints.join('-');

  // Для символов из диапазонов Miscellaneous Symbols (U+2600–U+26FF)
  // и Dingbats (U+2700–U+27BF), которые не являются полноценными emoji,
  // требуется добавление Variation Selector-16 (-fe0f) для корректного
  // отображения в стиле Apple. Без VS16 файл не существует в CDN.
  if (codePoints.length === 1) {
    const code = parseInt(codePoints[0], 16);
    if ((code >= 0x2600 && code <= 0x26FF) || (code >= 0x2700 && code <= 0x27BF)) {
      result += '-fe0f';
    }
  }

  return result;
}

// CDN для Apple emoji PNG (совпадает с App.js)
const APPLE_EMOJI_CDN = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.0.1/img/apple/64';

// Ключ localStorage для истории эмодзи
const RECENT_EMOJIS_KEY = 'recent_emojis';

/** Получает последние N отправленных эмодзи из localStorage */
function getRecentEmojis(limit = 32) {
  try {
    const stored = localStorage.getItem(RECENT_EMOJIS_KEY);
    if (!stored) return [];
    const emojis = JSON.parse(stored);
    // Возвращаем последние limit элементов в обратном порядке (новые первыми)
    return emojis.slice(-limit).reverse();
  } catch {
    return [];
  }
}

// Ключ localStorage для истории стикеров
const RECENT_STICKERS_KEY = 'recent_stickers';

/** Получает последние N отправленных стикеров из localStorage */
function getRecentStickers(limit = 32) {
  try {
    const stored = localStorage.getItem(RECENT_STICKERS_KEY);
    if (!stored) return [];
    const stickers = JSON.parse(stored);
    return stickers.slice(-limit).reverse();
  } catch {
    return [];
  }
}

/** Добавляет стикер в историю последних отправленных */
function addStickerToHistory(sticker) {
  try {
    const stored = localStorage.getItem(RECENT_STICKERS_KEY);
    let stickers = stored ? JSON.parse(stored) : [];
    stickers = stickers.filter(s => s.file !== sticker.file);
    stickers.push({ file: sticker.file, name: sticker.name, emoji: sticker.emoji });
    if (stickers.length > 64) {
      stickers = stickers.slice(-64);
    }
    localStorage.setItem(RECENT_STICKERS_KEY, JSON.stringify(stickers));
  } catch (e) {
    console.warn('Не удалось сохранить историю стикеров:', e);
  }
}

/** Добавляет эмодзи в историю последних отправленных */
function addEmojiToHistory(emoji) {
  try {
    const stored = localStorage.getItem(RECENT_EMOJIS_KEY);
    let emojis = stored ? JSON.parse(stored) : [];

    // Удаляем дубликат если уже есть
    emojis = emojis.filter(e => e !== emoji);

    // Добавляем в конец (будет первым при отображении)
    emojis.push(emoji);

    // Ограничиваем размер истории
    if (emojis.length > 64) {
      emojis = emojis.slice(-64);
    }

    localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(emojis));
  } catch (e) {
    console.warn('Не удалось сохранить историю эмодзи:', e);
  }
}

// Преобразуем emojiData.json в формат EMOJI_CATEGORIES
const BASE_CATEGORIES = Object.entries(emojiData).map(([name, data]) => ({
  id: name.toLowerCase().replace(/\s+/g, '_'),
  label: name,
  icon: data.icon,
  iconUnified: getUnified(data.icon),
  emojis: data.emojis.map(e => ({ emoji: e.emoji, unified: getUnified(e.emoji) })),
}));

// Создаём финальный список категорий с "Последние" в начале
const EMOJI_CATEGORIES = [
  {
    id: 'recent',
    label: 'Последние',
    icon: '🕐',
    iconUnified: getUnified('🕐'), // Часы как иконка для "последних"
    isRecent: true,
    emojis: [], // Заполняется динамически
  },
  ...BASE_CATEGORIES,
];

/** Компонент для рендеринга эмодзи как <img> из Apple CDN */
function EmojiImage({ unified, size = '22px', className = '', emoji = '' }) {
  if (!unified) {
    return <span className={className} style={{ fontSize: size, lineHeight: 1, display: 'inline-block', verticalAlign: 'middle' }}>{emoji}</span>;
  }
  return (
    <img
      src={`${APPLE_EMOJI_CDN}/${unified}.png`}
      alt=""
      draggable={false}
      className={className}
      style={{ width: size, height: size, objectFit: 'contain', pointerEvents: 'none' }}
      onError={(e) => { e.target.style.display = 'none'; }}
    />
  );
}

const stickerUrl = (file, baseUrl) => {
  const parts = file.split('/').map(p => encodeURIComponent(p).replace(/%20/g, ' '));
  return (baseUrl || '') + '/stickers/' + parts.join('/');
};

/** Компонент стикера с изображением */
function StickerItem({ file, name, emoji, size = '64px', onClick, serverUrl }) {
  const [error, setError] = useState(false);
  if (error) {
    return (
      <button type="button" className="eip-sticker-btn" onClick={() => onClick({ type: 'sticker', file, emoji })} title={name}>
        <span style={{ fontSize: size }}>{emoji}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className="eip-sticker-btn"
      onClick={() => onClick({ type: 'sticker', file, emoji })}
      title={name}
    >
      <img src={stickerUrl(file, serverUrl)} alt={name} className="eip-sticker-img"
           style={{ width: size, height: size, objectFit: 'contain' }}
           onError={() => setError(true)} />
    </button>
  );
}

export default function EmojiInlinePicker({ show, onEmojiClick, onClose, theme, onStickerSend, serverUrl }) {
  const [activeCategory, setActiveCategory] = useState('smilies');
  const recentInit = getRecentStickers(32);
  const firstTab = recentInit.length > 0 ? '__recent__' : (Object.keys(stickerData.popular?.categories || {})[0] || '');
  const [stickersTab, setStickersTab] = useState(firstTab);
  const [stickerVariant, setStickerVariant] = useState('popular');
  const [panelMode, setPanelMode] = useState('emojis'); // 'emojis' | 'stickers'
  const [animating, setAnimating] = useState(false);
  const pickerRef = useRef(null);

  // Получаем последние эмодзи из localStorage
  const recentEmojis = getRecentEmojis(32).map(e => ({ emoji: e, unified: getUnified(e) }));

  // Добавляем последние эмодзи в начало списка категорий
  const categoriesWithRecent = [
    {
      id: 'recent',
      label: 'Последние',
      iconUnified: getUnified('🕐'),
      isRecent: true,
      emojis: recentEmojis,
    },
    ...BASE_CATEGORIES,
  ];

  // Закрытие по клику вне
  useEffect(() => {
    if (!show) return;

    const handleClickOutside = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        onClose?.();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [show, onClose]);

  // Сбрасываем категории на первую при каждом открытии пикера
  useEffect(() => {
    if (show) {
      setActiveCategory(categoriesWithRecent[0]?.id || 'recent');
      setAnimating(true);
      const timer = setTimeout(() => setAnimating(false), 350);
      return () => clearTimeout(timer);
    }
  }, [show]);

  const handleEmojiClick = (emoji) => {
    addEmojiToHistory(emoji);
    onEmojiClick(emoji);
  };

  // Получаем последние стикеры из localStorage
  const recentStickers = getRecentStickers(32);

  // Категории стикеров с "Последние" в начале
  const stickerCategories = stickerData[stickerVariant].categories;
  const stickerCategoryEntries = Object.entries(stickerCategories);
  const allStickerTabs = [
    ...(recentStickers.length > 0 ? [{ id: '__recent__', label: 'Последние', icon: '🕐', stickers: recentStickers }] : []),
    ...stickerCategoryEntries.map(([name, data]) => ({ id: name, ...data })),
  ];

  const handleStickerClick = (stickerObj) => {
    // Сохраняем в историю последних стикеров
    addStickerToHistory({ file: stickerObj.file, name: stickerObj.name, emoji: stickerObj.emoji });
    if (onStickerSend) {
      onStickerSend(stickerObj);
    } else {
      onEmojiClick(stickerObj);
    }
  };

  // Используем categoriesWithRecent вместо EMOJI_CATEGORIES
  const currentEmojis = categoriesWithRecent.find(c => c.id === activeCategory)?.emojis || [];

  if (!show) return null;

  return (
    <div className={`emoji-inline-picker ${animating ? 'pop-in' : ''} ${theme === 'light' ? 'light' : 'dark'}`} ref={pickerRef}>
      {/* Переключатель Смайлы / Стикеры наверху */}
      <div className="eip-top-bar">
        <button
          type="button"
          className={`eip-mode-btn ${panelMode === 'emojis' ? 'active' : ''}`}
          onClick={() => setPanelMode('emojis')}
        >
          😀 Смайлы
        </button>
        <button
          type="button"
          className={`eip-mode-btn ${panelMode === 'stickers' ? 'active' : ''}`}
          onClick={() => setPanelMode('stickers')}
        >
          🎨 Стикеры
        </button>
      </div>

      {/* Верхние категории (только для эмодзи) */}
      {panelMode === 'emojis' && (
        <div className="eip-categories" onWheel={(e) => { if (e.deltaY !== 0) { e.currentTarget.scrollLeft += e.deltaY; e.preventDefault(); } }}>
          {categoriesWithRecent.map(cat => (
            <button
              key={cat.id}
              type="button"
              className={`eip-category-btn ${activeCategory === cat.id ? 'active' : ''}`}
              onClick={() => setActiveCategory(cat.id)}
              title={cat.label}
            >
              {cat.isRecent ? (
                <span style={{ fontSize: '16px' }}>🕐</span>
              ) : (
                <EmojiImage unified={cat.iconUnified} size="18px" emoji={cat.icon} />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Сетка эмодзи */}
      {panelMode === 'emojis' && currentEmojis.length > 0 && (
        <div className="eip-grid">
          {currentEmojis.map((item, i) => (
            <button
              key={`emoji-${activeCategory}-${i}`}
              type="button"
              className="eip-emoji-btn"
              onClick={() => handleEmojiClick(item.emoji)}
              title={item.emoji}
            >
              <EmojiImage unified={item.unified} size="22px" emoji={item.emoji} />
            </button>
          ))}
        </div>
      )}

      {/* Сетка стикеров */}
      {panelMode === 'stickers' && (
        <>
          {/* Переключатель вариантов стикеров */}
          <div className="eip-sticker-variants">
            {Object.entries(stickerData).map(([key, variant]) => (
              <button
                key={key}
                type="button"
                className={`eip-sticker-variant-btn ${stickerVariant === key ? 'active' : ''}`}
                onClick={() => { setStickerVariant(key); setStickersTab(Object.keys(variant.categories)[0]); }}
                title={variant.label}
              >
                {variant.icon} {variant.label}
              </button>
            ))}
          </div>

          {/* Категории стикеров */}
          <div className="eip-stickers-tabs" onWheel={(e) => { if (e.deltaY !== 0) { e.currentTarget.scrollLeft += e.deltaY; e.preventDefault(); } }}>
            {allStickerTabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                className={`eip-sticker-tab-btn ${stickersTab === tab.id ? 'active' : ''}`}
                onClick={() => setStickersTab(tab.id)}
                title={tab.label}
              >
                {tab.icon}
              </button>
            ))}
          </div>

          {/* Сетка стикеров */}
          <div className="eip-sticker-grid">
            {(allStickerTabs.find(t => t.id === stickersTab)?.stickers || []).map((sticker, i) => (
              <StickerItem
                key={`sticker-${stickerVariant}-${stickersTab}-${i}`}
                file={sticker.file}
                name={sticker.name}
                emoji={sticker.emoji}
                size="64px"
                onClick={handleStickerClick}
                serverUrl={serverUrl}
              />
            ))}
          </div>
        </>
      )}

      {/* Футер с количеством */}
      <div className="eip-footer">
        {panelMode === 'emojis' ? (
          <span>{currentEmojis.length} эмодзи</span>
        ) : (
          <span>{(allStickerTabs.find(t => t.id === stickersTab)?.stickers.length || 0)} стикеров</span>
        )}
      </div>
    </div>
  );
}
