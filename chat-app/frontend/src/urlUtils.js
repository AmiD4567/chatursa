/**
 * Regex для обнаружения URL в тексте.
 * Подхватывает http/https ссылки с доменами, IP-адресами и путями.
 */
const URL_REGEX = /(?:https?:\/\/)?(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)/gi;

/**
 * Находит все URL в тексте и возвращает массив объектов { url, start, end }.
 */
export function detectUrls(text) {
  if (!text || typeof text !== 'string') return [];
  const urls = [];
  let match;
  while ((match = URL_REGEX.exec(text)) !== null) {
    // Не даём regex "съесть" trailing точки/скобки которые не часть URL
    let url = match[0];
    const trailing = url.match(/[.()]+$/);
    if (trailing && !url.endsWith('.com') && !url.endsWith('.ru') && !url.endsWith('.io')) {
      // Убираем лишние trailing символы если это не доменное окончание
      const cleanTrailing = trailing[0].replace(/[.)]+$/, '');
      if (cleanTrailing.length < url.length - 1) {
        url = url.slice(0, -(trailing[0].length - cleanTrailing.length));
      } else {
        url = url.slice(0, -trailing[0].length);
      }
    }

    // Убедимся что URL начинается с протокола или содержит доменную точку
    if (!url.startsWith('http') && !/\.[a-zA-Z]{2,}/.test(url)) continue;

    urls.push({ url, start: match.index, end: match.index + match[0].length });
  }
  return urls;
}

/**
 * Разбивает текст на части: обычный текст и URL.
 * Возвращает массив { type: 'text'|'url', content: string }.
 */
export function splitTextByUrls(text) {
  if (!text || typeof text !== 'string') return [{ type: 'text', content: text }];

  const urls = detectUrls(text);
  if (urls.length === 0) return [{ type: 'text', content: text }];

  const parts = [];
  let lastIndex = 0;

  for (const { url, start, end } of urls) {
    // Текст до URL
    if (start > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, start) });
    }
    // Сам URL
    parts.push({ type: 'url', content: url.startsWith('http') ? url : `https://${url}` });
    lastIndex = end;
  }

  // Текст после последнего URL
  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return parts;
}
