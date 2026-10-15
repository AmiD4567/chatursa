import React, { useRef, useEffect, useId, useCallback } from 'react';

// ══════════ Обёртка модального окна ══════════
// Берёт на себя всё общее поведение 37 диалогов приложения: роль и aria-атрибуты,
// закрытие по Escape, перенос фокуса внутрь, ловушку фокуса и возврат фокуса
// на элемент, который был активен до открытия.
//
// Разметка шапки и тела остаётся у вызывающего: одни окна закрываются крестиком
// в шапке, другие — кнопками в подвале, и унифицировать это здесь значило бы
// переписать их все.
//
// Окна умеют открываться поверх других (из списка объявлений — редактор,
// из кадрового отдела — форма), поэтому фокус и Escape достаются только
// верхнему в стеке: иначе две ловушки дрались бы друг с другом.

const dialogStack = [];

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableWithin(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  );
}

export default function Dialog({
  open,
  onClose,
  className = '',
  closeOnEscape = true,
  closeOnOverlayClick = true,
  initialFocusRef,
  children,
}) {
  const contentRef = useRef(null);
  const returnFocusRef = useRef(null);
  const generatedId = useId();
  const [labelledBy, setLabelledBy] = React.useState(null);

  const isTopmost = () => {
    const mine = dialogStack[dialogStack.length - 1];
    return !mine || mine === contentRef.current;
  };

  // Заголовок внутри окна подключаем через aria-labelledby. Ищем сами,
  // чтобы не править 37 тегов <h3> в разметке.
  useEffect(() => {
    if (!open || !contentRef.current) return;
    const heading = contentRef.current.querySelector('h1, h2, h3, h4, [role="heading"]');
    if (!heading) {
      setLabelledBy(null);
      return;
    }
    if (!heading.id) heading.id = `${generatedId}-title`;
    setLabelledBy(heading.id);
  }, [open, generatedId]);

  useEffect(() => {
    if (!open || !contentRef.current) return;
    const node = contentRef.current;
    dialogStack.push(node);
    returnFocusRef.current = document.activeElement;

    // Фокус: явно заданный элемент → autofocus внутри → первый фокусируемый → сам диалог
    const raf = requestAnimationFrame(() => {
      let target = initialFocusRef?.current;
      if (!target) target = node.querySelector('[autofocus]');
      if (!target) target = focusableWithin(node)[0];
      if (!target) target = node;
      try {
        target.focus({ preventScroll: true });
      } catch (e) {
        /* элемент мог исчезнуть между расчётом и фокусом */
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      const idx = dialogStack.lastIndexOf(node);
      if (idx !== -1) dialogStack.splice(idx, 1);
      const back = returnFocusRef.current;
      if (back && document.contains(back) && typeof back.focus === 'function') {
        try {
          back.focus({ preventScroll: true });
        } catch (e) {
          /* элемент мог быть удалён из DOM */
        }
      }
    };
  }, [open, initialFocusRef]);

  const handleKeyDown = useCallback(
    (e) => {
      if (!open || !contentRef.current || !isTopmost()) return;
      const node = contentRef.current;

      if (e.key === 'Escape' && closeOnEscape) {
        e.stopPropagation();
        e.preventDefault();
        onClose?.();
        return;
      }

      if (e.key !== 'Tab') return;

      // Ловушка фокуса: Tab не должен уводить за пределы окна
      const items = focusableWithin(node);
      if (items.length === 0) {
        e.preventDefault();
        node.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && (active === first || active === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [open, onClose, closeOnEscape]
  );

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      onClick={closeOnOverlayClick ? onClose : undefined}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={contentRef}
        className={`modal-content ${className}`.trim()}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy || undefined}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
