import { useState, useEffect } from 'react';

export default function DisconnectedOverlay() {
  const [outboxCount, setOutboxCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const { getOutbox } = await import('./db');
        const queue = await getOutbox();
        if (!cancelled) setOutboxCount(queue.length);
      } catch {}
    };
    check();
    const interval = setInterval(check, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="disconnected-overlay">
      <div className="disconnected-overlay-content">
        <div className="disconnected-spinner"></div>
        <p>Потеряно соединение с сервером. Переподключение...</p>
        {outboxCount > 0 && (
          <p className="disconnected-outbox-count">
            📤 {outboxCount} сообщений ожидают отправки
          </p>
        )}
      </div>
    </div>
  );
}
