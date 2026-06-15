import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ReactionParticlesProvider } from './ReactionParticlesManager';
import './css/index.css';

// Регистрация Service Worker для офлайн-режима
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      console.log('[SW] Зарегистрирован:', reg.scope);
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('[SW] Доступно обновление');
            if (window.confirm('Доступна новая версия приложения. Обновить?')) {
              newWorker.postMessage({ type: 'skip-waiting' });
              window.location.reload();
            }
          }
        });
      });
    }).catch((err) => console.error('[SW] Ошибка регистрации:', err));
  });

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
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
