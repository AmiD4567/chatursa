import React, { useEffect, useState } from 'react';
import './CallOverlay.css';

// Feather-иконки (stroke=currentColor) для контролов звонка
const Svg = ({ children, size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
const PhoneIcon = () => (
  <Svg><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></Svg>
);
const PhoneOffIcon = () => (
  <Svg>
    <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/>
    <line x1="23" y1="1" x2="1" y2="23"/>
  </Svg>
);
const MicIcon = () => (
  <Svg><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></Svg>
);
const MicOffIcon = () => (
  <Svg><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/><line x1="1" y1="1" x2="23" y2="23"/></Svg>
);
const VideoIcon = () => (
  <Svg><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></Svg>
);
const VideoOffIcon = () => (
  <Svg><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/><line x1="1" y1="1" x2="23" y2="23"/></Svg>
);
const MonitorIcon = () => (
  <Svg><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></Svg>
);

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
            <button className="call-btn danger big" onClick={actions.declineIncoming} title="Отклонить"><PhoneOffIcon size={30} /></button>
            <button className="call-btn success big" onClick={actions.acceptIncoming} title="Принять">
              {type === 'video' ? <VideoIcon size={30}/> : <PhoneIcon size={30}/>}
            </button>
          </div>
        )}

        {phase === 'outgoing' && (
          <div className="call-controls">
            <button className="call-btn danger big" onClick={actions.cancelOutgoing} title="Отменить"><PhoneOffIcon size={30} /></button>
          </div>
        )}

        {phase === 'active' && (
          <div className="call-controls wide">
            <button className={`call-btn ${micMuted ? 'warn' : ''}`} onClick={actions.toggleMic}
              title={micMuted ? 'Включить микрофон' : 'Выключить микрофон'}>{micMuted ? <MicOffIcon/> : <MicIcon/>}</button>
            <button className={`call-btn ${camOff ? 'warn' : ''}`} onClick={actions.toggleCam}
              title={camOff ? 'Включить камеру' : 'Выключить камеру'}>{camOff ? <VideoOffIcon/> : <VideoIcon/>}</button>
            <button className={`call-btn ${sharing ? 'warn' : ''}`} onClick={actions.toggleShare}
              title={sharing ? 'Остановить показ экрана' : 'Показать экран'}><MonitorIcon/></button>
            <button className="call-btn danger big" onClick={actions.hangup} title="Завершить"><PhoneOffIcon size={28} /></button>
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
