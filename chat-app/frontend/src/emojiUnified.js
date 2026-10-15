import React, { useState, useEffect } from 'react';

// ══════════ Рендер эмодзи в стиле Apple (CDN) ══════════
// Единая точка для всех мест, где эмодзи показываются картинкой:
// пикер, сообщения, реакции, статусы, частицы.
//
// Имя файла в emoji-datasource — это unified-код вида "1f9d1-200d-2695-fe0f".
// Однозначно восстановить его из самого символа нельзя: вариационный селектор
// FE0F в символе может присутствовать, а может быть потерян при сохранении.
// Поэтому строим список кандидатов и пробуем их по очереди, а если не подошёл
// ни один — показываем нативный глиф вместо пустого места.

export const EMOJI_CDN_VERSION = '16.0.0';
export const EMOJI_CDN = `https://cdn.jsdelivr.net/npm/emoji-datasource-apple@${EMOJI_CDN_VERSION}/img/apple/64`;

export function emojiUnifiedCandidates(cluster) {
  if (!cluster || typeof cluster !== 'string') return [];

  const codes = [...cluster].map((c) => c.codePointAt(0));

  // 1) Как есть, со всеми селекторами — покрывает большинство (638 из 652)
  const raw = codes.map((c) => c.toString(16)).join('-');
  const hasVariationSelector = codes.some((c) => c >= 0xfe00 && c <= 0xfe0f);

  // 2) Без VS16 — когда символ сохранился без него, а в CDN файл только с ним
  const rawWithVs = raw + '-fe0f';

  // 3) Полностью очищенный вариант: без FE0F/20E3 и без скин-тона
  const classic = codes
    .filter(
      (c) =>
        !((c >= 0xfe00 && c <= 0xfe0f) || c === 0x20e3 || (c >= 0x1f3fb && c <= 0x1f3ff))
    )
    .map((c) => c.toString(16))
    .join('-');

  const candidates = [raw];
  if (!hasVariationSelector) candidates.push(rawWithVs);
  candidates.push(classic);

  return [...new Set(candidates.filter(Boolean))];
}

export function emojiUnifiedUrl(cluster, index = 0) {
  const candidates = emojiUnifiedCandidates(cluster);
  const picked = candidates[index];
  return picked ? `${EMOJI_CDN}/${picked}.png` : null;
}

/**
 * Эмодзи как <img> с Apple CDN.
 * Перебирает unified-варианты, при неудаче показывает нативный глиф —
 * чтобы смайл никогда не выглядел пустой кнопкой или «битой» картинкой.
 */
export function EmojiImg({
  cluster,
  size = 20,
  className = '',
  style,
  alt = '',
  ...rest
}) {
  const candidates = emojiUnifiedCandidates(cluster);
  const [failed, setFailed] = useState(() => new Set());

  useEffect(() => {
    setFailed(new Set());
  }, [cluster]);

  const dim = typeof size === 'number' ? `${size}px` : size;
  const index = candidates.findIndex((c) => !failed.has(c));

  if (!cluster || index === -1) {
    return (
      <span
        className={className}
        style={{
          fontSize: dim,
          lineHeight: 1,
          display: 'inline-block',
          verticalAlign: 'middle',
          ...style,
        }}
      >
        {cluster}
      </span>
    );
  }

  return (
    <img
      src={`${EMOJI_CDN}/${candidates[index]}.png`}
      alt={alt}
      className={className}
      style={{
        width: dim,
        height: dim,
        objectFit: 'contain',
        verticalAlign: 'middle',
        display: 'inline-block',
        ...style,
      }}
      onError={() => setFailed((prev) => new Set(prev).add(candidates[index]))}
      {...rest}
    />
  );
}

export default EmojiImg;
