import React, { useCallback, useEffect, useRef, useState } from 'react';
import './ImageGalleryModal.css';

const MIN_SCALE = 1;
const MAX_SCALE = 6;

/**
 * Галерейный просмотрщик изображений чата.
 * Навигация: экранные стрелки + ArrowLeft/ArrowRight (циклично).
 * Зум: колесо мыши, кнопки, клавиши +/-/0, двойной клик. Пан — перетаскиванием.
 */
export default function ImageGalleryModal({ images, index, onClose, onNavigate }) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);
  const dragRef = useRef(null); // { startX, startY, baseX, baseY }
  const indexRef = useRef(index);
  indexRef.current = index;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const current = images[index];
  const many = images.length > 1;

  const resetTransform = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  // Сброс зума/панорамы при смене изображения
  useEffect(() => { resetTransform(); }, [index, resetTransform]);

  const clampOffset = (o, s) => ({
    x: Math.max(-700 * s, Math.min(700 * s, o.x)),
    y: Math.max(-500 * s, Math.min(500 * s, o.y))
  });

  const applyZoom = useCallback((next) => {
    const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));
    setScale(s);
    setOffset(o => (s === MIN_SCALE ? { x: 0, y: 0 } : clampOffset(o, s)));
  }, []);

  const zoomIn  = () => applyZoom((scaleRef.current || 1) * 1.25);
  const zoomOut = () => applyZoom((scaleRef.current || 1) / 1.25);

  // Колесо мыши — нативный слушатель (preventDefault требует passive:false)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      applyZoom((scaleRef.current || 1) * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyZoom]);

  // Клавиатура: ←/→ навигация, +/-/0 зум
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft' && many) onNavigate(-1);
      else if (e.key === 'ArrowRight' && many) onNavigate(1);
      else if (e.key === '+' || e.key === '=') zoomIn();
      else if (e.key === '-') zoomOut();
      else if (e.key === '0') { setScale(1); setOffset({ x: 0, y: 0 }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [many, onNavigate, zoomIn, zoomOut]);

  // Панорамирование при scale > 1
  const onMouseDown = (e) => {
    if (scale <= 1) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y };
    const move = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      setOffset(clampOffset(
        { x: d.baseX + (ev.clientX - d.startX), y: d.baseY + (ev.clientY - d.startY) },
        scaleRef.current
      ));
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const onDoubleClick = () => applyZoom(scale > 1 ? 1 : 2.5);

  if (!current) return null;

  return (
    <div className="igm-overlay" ref={containerRef} onClick={onClose}>
      <div className="igm-stage" onClick={(e) => e.stopPropagation()}>
        {/* Счётчик */}
        <div className="igm-counter">{index + 1} / {images.length}</div>

        {/* Закрыть */}
        <button className="igm-btn igm-close" onClick={onClose} title="Закрыть (Esc)">✕</button>

        {/* Изображение */}
        <img
          src={current.url}
          alt={current.filename}
          className={`igm-image ${scale > 1 ? 'zoomed' : ''}`}
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
          onMouseDown={onMouseDown}
          onDoubleClick={onDoubleClick}
          draggable={false}
        />

        {/* Стрелки навигации */}
        {many && (
          <>
            <button className="igm-btn igm-nav prev" onClick={() => onNavigate(-1)} title="Предыдущее (←)">‹</button>
            <button className="igm-btn igm-nav next" onClick={() => onNavigate(1)} title="Следующее (→)">›</button>
          </>
        )}

        {/* Зум-контролы */}
        <div className="igm-zoombar" onClick={(e) => e.stopPropagation()}>
          <button className="igm-btn small" onClick={zoomOut} title="Уменьшить (-)">−</button>
          <span className="igm-zoom-value">{Math.round(scale * 100)}%</span>
          <button className="igm-btn small" onClick={zoomIn} title="Увеличить (+)">+</button>
          <button className="igm-btn small" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }} title="Сбросить (0)">⟲</button>
        </div>

        {/* Инфо: имя файла + скачивание */}
        <div className="igm-info">
          <span className="igm-filename" title={current.filename}>{current.filename}</span>
          <a href={current.downloadHref} className="igm-download" download title="Скачать оригинал">⬇️ Скачать</a>
        </div>
      </div>
    </div>
  );
}
