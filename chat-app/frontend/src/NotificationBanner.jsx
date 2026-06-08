export default function NotificationBanner({
  show,
  onEnable,
  onDismiss
}) {
  if (!show) return null;
  return (
    <div className="notification-banner">
      <div className="notification-banner-content">
        <span className="notification-banner-icon">🔔</span>
        <div className="notification-banner-text">
          <strong>Включите уведомления браузера</strong>
          <p>Чтобы получать уведомления о новых сообщениях, включите их в настройках браузера</p>
        </div>
      </div>
      <div className="notification-banner-actions">
        <button className="notification-banner-btn" onClick={onEnable}>
          Включить
        </button>
        <button className="notification-banner-dismiss" onClick={onDismiss}>
          ✕
        </button>
      </div>
    </div>
  );
}
