import React, { useState, useCallback, useRef, createContext, useContext } from 'react';
import ReactionParticleContainer from './ReactionParticles';

/** Контекст для запуска частиц реакций */
export const ReactionParticlesContext = createContext(null);

/** Хук-обёртка для удобного использования */
export function useReactionParticles() {
  return useContext(ReactionParticlesContext) || { spawn: () => {} };
}

/** Провайдер — один на всё приложение, размещается в App.js */
export function ReactionParticlesProvider({ children }) {
  const [effects, setEffects] = useState([]);
  const nextId = useRef(0);

  /** Запуск частиц: от startRect к endRect */
  const spawn = useCallback((emoji, startRect, endRect) => {
    // Если rect нулевой — пробуем найти бейдж в DOM по эмодзи и ID сообщения
    if (!startRect || !endRect || !startRect.width || !startRect.height) {
      console.log('[ReactionParticles] spawn: invalid rect, skipping', emoji, startRect, endRect);
      return;
    }

    const id = ++nextId.current;
    const effect = { id, emoji, startRect, endRect };

    console.log('[ReactionParticles] spawning:', emoji, 'id:', id, 'startRect:', startRect, 'endRect:', endRect);

    setEffects(prev => [...prev, effect]);

    // Удалить эффект после завершения анимации (~3.5 сек)
    setTimeout(() => {
      setEffects(prev => prev.filter(e => e.id !== id));
    }, 3500);
  }, []);

  return (
    <ReactionParticlesContext.Provider value={{ spawn }}>
      {children}
      {/* Рендерим все активные эффекты */}
      {effects.map(effect => (
        <ReactionParticleContainer
          key={effect.id}
          emoji={effect.emoji}
          startRect={effect.startRect}
          endRect={effect.endRect}
        />
      ))}
    </ReactionParticlesContext.Provider>
  );
}
