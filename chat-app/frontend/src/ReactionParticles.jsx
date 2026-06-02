import React, { useState, useEffect, useRef, useMemo } from 'react';
import './ReactionParticles.css';

/** Конвертирует emoji в Apple unified code (hex) */
function emojiToUnified(emoji) {
  if (!emoji) return '';
  try {
    const codePoints = [...emoji].map(char => {
      const code = char.codePointAt(0);
      // НЕ фильтруем FE0F — для ❤️ нужен формат "2764-fe0f" (файл 2764.png не существует на CDN)
      if (code === 0x20E3) return null;                         // combining enclosing keycap
      if (code >= 0x1F3FB && code <= 0x1F3FF) return null;     // skin tone modifiers
      return code.toString(16);
    }).filter(Boolean);

    let result = codePoints.join('-');

    // Для символов из диапазонов Miscellaneous Symbols (U+2600–U+26FF)
    // и Dingbats (U+2700–U+27BF), которые не являются полноценными emoji,
    // требуется добавление Variation Selector-16 (-fe0f) для корректного
    // отображения в стиле Apple. Без VS16 файл не существует в CDN.
    if (codePoints.length === 1 && !result.includes('fe0f')) {
      const code = parseInt(codePoints[0], 16);
      if ((code >= 0x2600 && code <= 0x26FF) || (code >= 0x2700 && code <= 0x27BF)) {
        result += '-fe0f';
      }
    }

    return result;
  } catch {
    return '';
  }
}

/** URL Apple CDN для emoji */
const EMOJI_CDN = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.0.1/img/apple/64';

/** Отрисовка emoji как <img> (стиль Apple) с fallback-логикой */
function EmojiImage({ emoji, size }) {
  const unified = emojiToUnified(emoji);
  const primarySrc = `${EMOJI_CDN}/${unified}.png`;

  // Fallback: если emoji содержит FE0F но unified его не содержит — пробуем добавить
  let fallbackSrc = null;
  if (!unified.includes('fe0f')) {
    const hasFE0F = [...emoji].some(c => c.codePointAt(0) >= 0xFE00 && c.codePointAt(0) <= 0xFE0F);
    if (hasFE0F) {
      fallbackSrc = `${EMOJI_CDN}/${unified}-fe0f.png`;
    }
  }

  const [imgSrc, setImgSrc] = useState(primarySrc);

  useEffect(() => {
    // Проверяем существование основного URL через Image onload/onerror
    const img = new Image();
    img.onload = () => setImgSrc(primarySrc);
    img.onerror = () => {
      if (fallbackSrc) {
        img.src = fallbackSrc;
        img.onload = () => setImgSrc(fallbackSrc);
        img.onerror = () => setImgSrc(primarySrc); // показываем сломанный если ничего не помогло
      } else {
        setImgSrc(primarySrc);
      }
    };
    img.src = primarySrc;
  }, [primarySrc, fallbackSrc]);

  return (
    <img
      src={imgSrc}
      alt={emoji}
      draggable={false}
      style={{ width: size, height: size, display: 'block', objectFit: 'contain' }}
    />
  );
}

/** Spring-easing функция с overshoot для естественного движения */
function springEase(t) {
  // Формула spring-анимации (упрощённая версия Framer Motion)
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  const c1 = 1.70158;   // overshoot factor
  const c3 = c1 + 1;    // cubic coefficient

  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** Плавное замедление перед финишем (easeOutExpo) */
function easeOutExpo(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t === 1 ? 1 : -Math.pow(2, -10 * t) + 1;
}

/** Генерирует частицы для spring-анимации */
function generateSpringParticles(count = 30) {
  const particles = [];

  for (let i = 0; i < count; i++) {
    // Случайное направление разлёта от центра
    const angle = Math.random() * Math.PI * 2;
    const distance = 40 + Math.random() * 120; // радиус разлёта

    particles.push({
      id: `spring-${i}-${Date.now()}`,
      offsetX: Math.cos(angle) * distance,
      offsetY: Math.sin(angle) * distance,
      delay: Math.random() * 200,       // задержка старта (мс)
      duration: 1800 + Math.random() * 1200, // длительность (мс)
      size: 16 + Math.random() * 14,    // размер (px)
      rotation: Math.random() * 360 - 180,
      scaleStart: 0.5 + Math.random() * 0.5,
      scaleEnd: 0.2,                    // финальный масштаб при "впитывании"
    });
  }

  return particles;
}

/** Spring-анимация через requestAnimationFrame */
function useSpringAnimation(particles, startRect, endRect, emoji) {
  const rafRef = useRef(null);
  const startTimeRef = useRef(null);

  useEffect(() => {
    if (!startRect || !endRect || particles.length === 0) return;

    // Центр старта и финиша — вычисляем один раз
    const startX = startRect.left + startRect.width / 2;
    const startY = startRect.top + startRect.height / 2;
    const endX = endRect.left + endRect.width / 2;
    const endY = endRect.top + endRect.height / 2;

    startTimeRef.current = performance.now();

    /** Вычисление позиции частицы на данном шаге */
    function getParticlePosition(particle, elapsed) {
      const particleElapsed = Math.max(0, elapsed - particle.delay);
      const progress = Math.min(particleElapsed / particle.duration, 1);

      let currentX, currentY, scale, rotation, opacity;

      if (progress < 0.4) {
        // ── Фаза 1 (0–40%): разлёт от центра старта наружу ──
        const phase1Progress = progress / 0.4;
        const spread = easeOutExpo(phase1Progress);

        // Позиция: центр старта + смещение частицы, растянутое по фазе
        currentX = startX + particle.offsetX * spread;
        currentY = startY + particle.offsetY * spread;

        // Масштаб: увеличивается при разлёте (эффект "взрыва")
        scale = particle.scaleStart + (1.2 - particle.scaleStart) * phase1Progress;

        // Вращение: нарастает от 0 до target rotation
        rotation = particle.rotation * phase1Progress;
        opacity = 1;
      } else {
        // ── Фаза 2 (40–100%): возврат к центру финиша ──
        const phase2Progress = (progress - 0.4) / 0.6;

        // Позиция на пике разлёта (конец фазы 1) — это "отправная точка" для возврата
        const burstX = startX + particle.offsetX * easeOutExpo(1);
        const burstY = startY + particle.offsetY * easeOutExpo(1);

        // Интерполяция от позиции разлёта к центру финиша с spring easing
        const easedProgress = springEase(phase2Progress);

        currentX = burstX + (endX - burstX) * easedProgress;
        currentY = burstY + (endY - burstY) * easedProgress;

        // Масштаб: уменьшается при "впитывании" в бейдж
        scale = particle.scaleStart + (particle.scaleEnd - particle.scaleStart) * phase2Progress;

        // Вращение: разворачивается обратно к 0
        rotation = particle.rotation * (1 - phase2Progress);

        // Прозрачность: лёгкое затухание в финале
        opacity = 1 - (phase2Progress * 0.35);
      }

      return { currentX, currentY, scale, rotation, opacity };
    }

    const animate = (currentTime) => {
      if (!startTimeRef.current) return;

      const elapsed = currentTime - startTimeRef.current;

      particles.forEach((particle) => {
        // Частица ещё не стартовала — скрываем
        if (elapsed < particle.delay) {
          const el = document.getElementById(particle.id);
          if (el) el.style.opacity = '0';
          return;
        }

        const pos = getParticlePosition(particle, elapsed);
        const progress = Math.min(Math.max(0, elapsed - particle.delay) / particle.duration, 1);

        const el = document.getElementById(particle.id);
        if (el) {
          el.style.transform = `translate(${pos.currentX}px, ${pos.currentY}px) scale(${pos.scale}) rotate(${pos.rotation}deg)`;
          el.style.opacity = pos.opacity;
        }

        // Если анимация завершена — удаляем элемент
        if (progress >= 1) {
          setTimeout(() => {
            const elToRemove = document.getElementById(particle.id);
            if (elToRemove) elToRemove.remove();
          }, 50);
        }
      });

      // Продолжаем анимацию если есть активные частицы или время ещё не вышло
      const maxTime = Math.max(...particles.map(p => p.delay + p.duration));
      if (elapsed < maxTime) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        // Убеждаемся что все элементы удалены
        particles.forEach(p => {
          const el = document.getElementById(p.id);
          if (el) el.remove();
        });
      }
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      startTimeRef.current = null;
    };
  }, [particles, startRect, endRect]);

  return null; // не нужен canvas ref
}

/** Отдельная частица */
function Particle({ particle, emoji }) {
  const style = useMemo(() => ({
    position: 'absolute',
    left: '0px',
    top: '0px',
    fontSize: `${particle.size}px`,
    willChange: 'transform, opacity',
    userSelect: 'none',
  }), [particle]);

  return (
    <span
      id={particle.id}
      className="reaction-particle rp-spring"
      style={style}
    >
      <EmojiImage emoji={emoji} size={particle.size} />
    </span>
  );
}

/** Контейнер для одной реакции на сообщении */
export default function ReactionParticleContainer({ emoji, startRect, endRect }) {
  const particles = useMemo(() => generateSpringParticles(30), [emoji]);
  useSpringAnimation(particles, startRect, endRect, emoji);

  // Таймаут очистки — после завершения всех частиц
  useEffect(() => {
    if (!startRect || !endRect) return;

    const maxTime = Math.max(...particles.map(p => p.delay + p.duration));
    const timer = setTimeout(() => {
      particles.forEach(p => {
        const el = document.getElementById(p.id);
        if (el) el.remove();
      });
    }, maxTime + 200);

    return () => clearTimeout(timer);
  }, [particles, startRect, endRect]);

  if (!startRect || !endRect) return null;

  const startX = startRect.left + startRect.width / 2;
  const startY = startRect.top + startRect.height / 2;

  return (
    <div
      className="reaction-particles-overlay"
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    >
      {particles.map(p => (
        <Particle key={p.id} particle={p} emoji={emoji} />
      ))}
      {/* Стартовая точка — вспышка */}
      <div
        className="reaction-particle start-flash"
        style={{
          left: startX,
          top: startY,
          transform: 'translate(-50%, -50%)',
        }}
      >
        <EmojiImage emoji={emoji} size={24} />
      </div>
    </div>
  );
}
