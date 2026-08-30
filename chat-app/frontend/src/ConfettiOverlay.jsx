import React from 'react';
import './ConfettiOverlay.css';

const CONFETTI_COLORS = ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#ffd700', '#ff6b6b', '#43e97b', '#fa709a'];

/**
 * Фуллскрин-конфетти на праздничные слова/эмодзи (как в Telegram).
 * Монтируется с уникальным key при каждом триггере — частицы генерируются заново,
 * анимация заканчивается в невидимом состоянии (pointer-events: none).
 */
export default function ConfettiOverlay() {
  const pieces = React.useMemo(() => (
    Array.from({ length: 110 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.8,
      duration: 2 + Math.random() * 1.6,
      size: 6 + Math.random() * 8,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      round: Math.random() > 0.65,
      drift: -80 + Math.random() * 160,
      spin: (360 + Math.random() * 900) * (Math.random() > 0.5 ? 1 : -1),
    }))
  ), []);

  return (
    <div className="confetti-overlay" aria-hidden="true">
      {pieces.map(p => (
        <span
          key={p.id}
          className={`confetti-piece${p.round ? ' round' : ''}`}
          style={{
            left: `${p.left}%`,
            width: `${p.size}px`,
            height: `${Math.round(p.size * (p.round ? 1 : 0.55))}px`,
            background: p.color,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
            '--confetti-drift': `${Math.round(p.drift)}px`,
            '--confetti-spin': `${Math.round(p.spin)}deg`,
          }}
        />
      ))}
    </div>
  );
}
