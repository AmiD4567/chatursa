import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ReactionParticlesProvider } from './ReactionParticlesManager';
import './css/index.css';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(ch => ch.charCodeAt(0)));
}

async function subscribeToPush(reg) {
  try {
    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      const stored = localStorage.getItem('chat_push_subscription');
      if (stored && JSON.stringify(sub.toJSON()) === stored) {
        return;
      }
    }
    const res = await fetch('/api/push/vapid-key');
    const { publicKey } = await res.json();
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
    localStorage.setItem('chat_push_subscription', JSON.stringify(sub.toJSON()));
    window.__pushSubscription = sub;
  } catch (err) {
    console.warn('[Push] Подписка не удалась:', err.message);
  }
}

// SW регистрируем только в браузере (не в Electron — file:// не поддерживает SW)
if ('serviceWorker' in navigator && !window.electronAPI) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      console.log('[SW] Зарегистрирован:', reg.scope);

      subscribeToPush(reg);

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed') {
            console.log('[SW] Доступно обновление, применится при следующем запуске');
          }
        });
      });
    }).catch((err) => console.error('[SW] Ошибка регистрации:', err));
  });
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ReactionParticlesProvider>
      <App />
    </ReactionParticlesProvider>
  </React.StrictMode>
);
