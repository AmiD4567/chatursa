export default function DisconnectedOverlay() {
  return (
    <div className="disconnected-overlay">
      <div className="disconnected-overlay-content">
        <div className="disconnected-spinner"></div>
        <p>Потеряно соединение с сервером. Переподключение...</p>
      </div>
    </div>
  );
}
