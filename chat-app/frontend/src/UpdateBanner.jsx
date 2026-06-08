export default function UpdateBanner({
  show,
  status,
  electronInfo,
  browserInfo,
  progress,
  onStartDownload,
  onInstall,
  onClose
}) {
  if (!show) return null;
  return (
    <div className="update-banner">
      <div className="update-banner-content">
        <span className="update-banner-icon">📦</span>
        <div className="update-banner-text">
          {status === 'checking' && (
            <>
              <strong>Проверка обновлений...</strong>
              <p>Подождите, идёт проверка наличия новых версий.</p>
            </>
          )}
          {status === 'available' && electronInfo && (
            <>
              <strong>Доступно обновление v{electronInfo.version}</strong>
              <p>Нажмите «Обновить» для скачивания и установки.</p>
            </>
          )}
          {status === 'available' && browserInfo && (
            <>
              <strong>Доступно обновление v{browserInfo.latestVersion}</strong>
              <p>Текущая версия: v{browserInfo.currentVersion}.</p>
            </>
          )}
          {status === 'downloading' && (
            <>
              <strong>Загрузка обновления...</strong>
              <div className="update-progress-bar-inline">
                <div
                  className="update-progress-fill-inline"
                  style={{ width: `${Math.round(progress)}%` }}
                ></div>
              </div>
              <span className="update-progress-text-inline">{Math.round(progress)}%</span>
            </>
          )}
          {status === 'ready' && electronInfo && (
            <>
              <strong>Обновление v{electronInfo.version} готово к установке</strong>
              <p>Нажмите «Установить и перезапустить» для применения.</p>
            </>
          )}
          {status === 'no-update' && (
            <>
              <strong>У вас последняя версия</strong>
              <p>Обновлений не найдено.</p>
            </>
          )}
          {status === 'error' && (
            <>
              <strong>Ошибка проверки обновлений</strong>
              <p>Не удалось проверить наличие новых версий.</p>
            </>
          )}
        </div>
      </div>
      <div className="update-banner-actions">
        {status === 'available' && electronInfo && (
          <>
            <button className="update-banner-btn" onClick={onStartDownload}>
              Обновить
            </button>
            <button className="update-banner-dismiss" onClick={onClose}>
              Отмена
            </button>
          </>
        )}
        {status === 'available' && browserInfo && (
          <>
            <button
              className="update-banner-btn"
              onClick={() => {
                window.open(browserInfo.releaseUrl, '_blank');
                onClose();
              }}
            >
              Обновить
            </button>
            <button className="update-banner-dismiss" onClick={onClose}>
              Отмена
            </button>
          </>
        )}
        {status === 'ready' && (
          <button className="update-banner-btn" onClick={onInstall}>
            Установить и перезапустить
          </button>
        )}
        {(status === 'checking' || status === 'downloading') && (
          <button className="update-banner-dismiss" onClick={onClose}>
            Отмена
          </button>
        )}
      </div>
    </div>
  );
}
