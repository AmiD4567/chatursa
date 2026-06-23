import { useState, useEffect, useRef } from 'react';

export default function InAppNotification({ notifications, onDismiss, onSelectChat, renderEmoji }) {
  return (
    <div className="in-app-notification-container">
      {notifications.map(n => (
        <InAppToast
          key={n.id}
          notification={n}
          onDismiss={onDismiss}
          onSelectChat={onSelectChat}
          renderEmoji={renderEmoji}
        />
      ))}
    </div>
  );
}

function InAppToast({ notification, onDismiss, onSelectChat, renderEmoji }) {
  const [hiding, setHiding] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setHiding(true);
      setTimeout(() => onDismiss(notification.id), 300);
    }, 5000);
    return () => clearTimeout(timerRef.current);
  }, [notification.id, onDismiss]);

  const handleClick = () => {
    clearTimeout(timerRef.current);
    onDismiss(notification.id);
    if (notification.chatId && onSelectChat) {
      const chat = { id: notification.chatId };
      onSelectChat(chat);
    }
  };

  const handleClose = (e) => {
    e.stopPropagation();
    clearTimeout(timerRef.current);
    setHiding(true);
    setTimeout(() => onDismiss(notification.id), 300);
  };

  return (
    <div
      className={`in-app-notification ${hiding ? 'hiding' : ''}`}
      onClick={handleClick}
      title={notification.body}
    >
      {notification.icon ? (
        <img
          src={notification.icon}
          alt=""
          className="in-app-notification-avatar"
          onError={(e) => { e.target.style.display = 'none'; }}
        />
      ) : (
        <div className="in-app-notification-avatar in-app-notification-avatar-placeholder">
          {renderEmoji ? renderEmoji('💬', '', 18) : '💬'}
        </div>
      )}
      <div className="in-app-notification-content">
        <div className="in-app-notification-title">{notification.title}</div>
        <div className="in-app-notification-body">{notification.body}</div>
      </div>
      <button className="in-app-notification-close" onClick={handleClose}>✕</button>
    </div>
  );
}
