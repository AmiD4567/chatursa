import React, { useEffect, useState } from 'react';
import './CallOverlay.css';

/**
 * Полноэкранный оверлей звонка: входящий / исходящий / активный.
 * call — объект из useCall(); null = не рендерим.
 */
export default function CallOverlay({ call, localStream, remoteStream, actions }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (call?.phase !== 'active' || !call.startedAt) return;
    const t = setInterval(() => setTick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, [call?.phase, call?.startedAt]);

  if (!call) return null;

  const { phase, peer, type, micMuted, camOff, sharing, startedAt } = call;
  const isVideo = type === 'video' && phase === 'active';
  const avatar = peer?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(peer?.username || 'U')}&background=667eea&color=fff`;

  const attachLocal = (el) => { if (el && localStream) el.srcObject = localStream; };
  const attachRemote = (el) => { if (el && remoteStream) el.srcObject = remoteStream; };

  const statusText =
    phase === 'incoming' ? 'Входящий ' + (type === 'video' ? 'видеозвонок' : 'звонок')
    : phase === 'outgoing' ? 'Вызываю…'
    : formatDuration(startedAt);

  return (
    <div className={`call-overlay ${isVideo ? 'video' : 'audio'} ${phase}`}>
      {/* Удалённое видео (только активный видеозвонок) */}
      {phase === 'active' && isVideo && (
        <video
          ref={attachRemote}
          className="call-remote-video"
          autoPlay playsInline
        />
      )}
      {!isVideo && <div className="call-bg-blur" style={{ backgroundImage: `url(${avatar})` }} />}

      <div className="call-center">
        {!(phase === 'active' && isVideo) && (
          <img src={avatar} alt="" className="call-avatar" />
        )}
        <div className="call-peer-name">{peer?.username}</div>
        <div className="call-status">{statusText}{micMuted ? ' · 🔇' : ''}{camOff ? ' · 📷выкл' : ''}{sharing ? ' · экран' : ''}</div>

        {/* Активный видеозвонок: локальное превью в углу */}
        {phase === 'active' && isVideo && (
          <div className="call-local-pip">
            <video ref={attachLocal} autoPlay playsInline muted
              style={{ opacity: camOff || sharing ? 0.25 : 1 }} />
          </div>
        )}

        {/* ── Управление ── */}
        {phase === 'incoming' && (
          <div className="call-controls">
            <button className="call-btn danger big" onClick={actions.declineIncoming} title="Отклонить">✕</button>
            <button className="call-btn success big" onClick={actions.acceptIncoming} title="Принять">
              {type === 'video' ? '📹' : '📞'}
            </button>
          </div>
        )}

        {phase === 'outgoing' && (
          <div className="call-controls">
            <button className="call-btn danger big" onClick={actions.cancelOutgoing} title="Отменить">✕</button>
          </div>
        )}

        {phase === 'active' && (
          <div className="call-controls wide">
            <button className={`call-btn ${micMuted ? 'warn' : ''}`} onClick={actions.toggleMic}
              title={micMuted ? 'Включить микрофон' : 'Выключить микрофон'}>{micMuted ? '🔇' : '🎙'}</button>
            <button className={`call-btn ${camOff ? 'warn' : ''}`} onClick={actions.toggleCam}
              title={camOff ? 'Включить камеру' : 'Выключить камеру'}>{camOff ? '📷' : '📹'}</button>
            <button className={`call-btn ${sharing ? 'warn' : ''}`} onClick={actions.toggleShare}
              title={sharing ? 'Остановить показ экрана' : 'Показать экран'}>🖥</button>
            <button className="call-btn danger big" onClick={actions.hangup} title="Завершить">📵</button>
          </div>
        )}
      </div>
    </div>
  );
}

function formatDuration(startedAt) {
  if (!startedAt) return 'Соединение…';
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
