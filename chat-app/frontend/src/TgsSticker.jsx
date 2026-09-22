import React, { useEffect, useRef, useState } from 'react';
import lottie from 'lottie-web';

/**
 * Рендер анимированного стикера Telegram (.tgs = gzip-сжатый Lottie JSON).
 *
 * @param {string} src       — URL файла .tgs (SOCKET_URL/stickers/<пак>/<файл>.tgs)
 * @param {string} size      — размер (CSS), например '64px' или 'var(--message-emoji-size, 28px)'
 * @param {string} className  — доп. классы
 * @param {string} alt        — текст-фолбэк при ошибке
 * @param {boolean} hoverPlay — если true, анимация проигрывается только при наведении
 *                              (для пикера, чтобы не грузить CPU десятками анимаций).
 *                              Если false — autoplay + loop (для сообщений).
 */
export default function TgsSticker({ src, size = '64px', className = '', alt = '', hoverPlay = false }) {
  const containerRef = useRef(null);
  const animRef = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const resp = await fetch(src);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);

        // .tgs — это gzip-сжатый Lottie JSON. Распаковываем через DecompressionStream
        // (встроен в Chromium 120 / Electron 28 и современные браузеры).
        let jsonText;
        if (typeof DecompressionStream !== 'undefined' && resp.body) {
          const ds = new DecompressionStream('gzip');
          jsonText = await new Response(resp.body.pipeThrough(ds)).text();
        } else {
          // Фолбэк: разжимаем руками из ArrayBuffer (если потокового API нет)
          const buf = await resp.arrayBuffer();
          const dec = new TextDecoder('utf-8');
          try {
            const ds = new DecompressionStream('gzip');
            const stream = new Response(buf).body.pipeThrough(ds);
            jsonText = await new Response(stream).text();
          } catch {
            // Возможно, файл не сжат — пробуем как есть
            jsonText = dec.decode(buf);
          }
        }

        const animationData = JSON.parse(jsonText);
        if (cancelled || !containerRef.current) return;

        animRef.current = lottie.loadAnimation({
          container: containerRef.current,
          renderer: 'canvas',
          loop: true,
          autoplay: !hoverPlay,
          animationData,
        });
      } catch (e) {
        console.warn('TgsSticker: не удалось загрузить стикер', src, e);
        if (!cancelled) setFailed(true);
      }
    }

    load();

    return () => {
      cancelled = true;
      if (animRef.current) {
        try { animRef.current.destroy(); } catch {}
        animRef.current = null;
      }
    };
  }, [src, hoverPlay]);

  // Управление воспроизведением для hoverPlay (анимация только при наведении)
  const handleEnter = () => {
    if (hoverPlay && animRef.current) {
      try { animRef.current.play(); } catch {}
    }
  };
  const handleLeave = () => {
    if (hoverPlay && animRef.current) {
      try { animRef.current.pause(); } catch {}
    }
  };

  if (failed) {
    // Фолбэк: показываем alt-текст, если анимация не загрузилась
    return (
      <span
        className={className}
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                 width: size, height: size, fontSize: 'inherit' }}
        aria-label={alt}
      >
        {alt}
      </span>
    );
  }

  return (
    <span
      ref={containerRef}
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
               width: size, height: size, lineHeight: 0 }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    />
  );
}
