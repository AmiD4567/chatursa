export default function SettingsView({
  activeSettingsTab, setActiveSettingsTab,
  appTheme, setAppTheme,
  userUiSettings, setUserUiSettings,
  autoLaunch, setAutoLaunch,
  browserNotificationPermission,
  notificationSettings, setNotificationSettings,
  appVersion,
  updateStatus, updateProgress,
  electronUpdateInfo, browserUpdateInfo,
  chatBackgrounds,
  handleOpenChats,
  handleSaveUserUiSettings, handleSaveNotificationSettings,
  enableBrowserNotifications,
  checkForUpdates, startUpdateDownload, installUpdate
}) {
  return (
    <main className="full-page-view">
      <div className="full-page-header">
        <div className="full-page-header-content">
          <button className="back-to-chats-btn white" onClick={handleOpenChats} title="Вернуться к чатам">
            ← Чаты
          </button>
          <h2>🛠️ Настройки</h2>
        </div>
      </div>

      <div className="full-page-content settings-full-page">
        <div className="settings-tabs">
          <button
            className={`settings-tab ${activeSettingsTab === 'appearance' ? 'active' : ''}`}
            onClick={() => setActiveSettingsTab('appearance')}
          >
            🎨 Оформление
          </button>
          <button
            className={`settings-tab ${activeSettingsTab === 'notifications' ? 'active' : ''}`}
            onClick={() => setActiveSettingsTab('notifications')}
          >
            🔔 Уведомления
          </button>
          <button
            className={`settings-tab ${activeSettingsTab === 'about' ? 'active' : ''}`}
            onClick={() => setActiveSettingsTab('about')}
          >
            ℹ️ О приложении
          </button>
        </div>

        <div className="settings-content">
          {activeSettingsTab === 'appearance' && (
            <div className="settings-tab-content">
              <div className="setting-section">
                <h3>Тема оформления</h3>
                <div className="theme-toggle">
                  <button
                    className={`theme-btn ${appTheme === 'dark' ? 'active' : ''}`}
                    onClick={() => setAppTheme('dark')}
                  >
                    🌙 Тёмная
                  </button>
                  <button
                    className={`theme-btn ${appTheme === 'light' ? 'active' : ''}`}
                    onClick={() => setAppTheme('light')}
                  >
                    ☀️ Светлая
                  </button>
                </div>
              </div>

              <div className="setting-section">
                <h3>Размер текста</h3>
                <div className="text-size-options">
                  {[{ level: -1, label: 'A', desc: 'Маленький' }, { level: 0, label: 'A', desc: 'Стандартный' }, { level: 1, label: 'A', desc: 'Большой' }, { level: 2, label: 'A', desc: 'Очень большой' }].map(opt => (
                    <button
                      key={opt.level}
                      className={`text-size-btn ${userUiSettings.textSizeLevel === opt.level ? 'active' : ''}`}
                      onClick={() => setUserUiSettings({ ...userUiSettings, textSizeLevel: opt.level })}
                      style={{ fontSize: opt.level === -1 ? '14px' : opt.level === 0 ? '16px' : opt.level === 1 ? '20px' : '24px' }}
                      title={opt.desc}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="setting-section">
                <h3>Фон чата</h3>
                <div className="chat-background-options">
                  {chatBackgrounds.map(bg => {
                    const gradient = appTheme === 'light' ? bg.light : bg.dark;
                    return (
                      <button
                        key={bg.id}
                        className={`chat-bg-btn ${userUiSettings.chatBackground === bg.id ? 'active' : ''}`}
                        onClick={() => setUserUiSettings({ ...userUiSettings, chatBackground: bg.id })}
                        style={{ background: bg.id === 0 ? 'transparent' : gradient }}
                        title={bg.name}
                      />
                    );
                  })}
                </div>
              </div>

              <div className="setting-section">
                <button className="btn-primary" onClick={handleSaveUserUiSettings}>
                  Сохранить оформление
                </button>
              </div>
            </div>
          )}

          {activeSettingsTab === 'notifications' && (
            <div className="settings-tab-content">
              <div className="setting-section">
                <h3>Уведомления</h3>

                {window.electronAPI?.setAutoLaunch && (
                  <div className="setting-item">
                    <div className="setting-info">
                      <span className="setting-icon">🔄</span>
                      <div>
                        <div className="setting-title">Автозапуск</div>
                        <div className="setting-description">Запускать приложение при входе в систему</div>
                      </div>
                    </div>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={autoLaunch}
                        onChange={(e) => setAutoLaunch(e.target.checked)}
                      />
                      <span className="slider"></span>
                    </label>
                  </div>
                )}

                <div className="setting-item">
                  <div className="setting-info">
                    <span className="setting-icon">🔔</span>
                    <div>
                      <div className="setting-title">Уведомления браузера</div>
                      <div className="setting-description">
                        {browserNotificationPermission === 'granted' && 'Разрешены'}
                        {browserNotificationPermission === 'denied' && 'Запрещены в настройках браузера'}
                        {browserNotificationPermission === 'default' && 'Не настроены'}
                      </div>
                    </div>
                  </div>
                  {browserNotificationPermission !== 'granted' && (
                    <button className="enable-notification-btn" onClick={enableBrowserNotifications}>
                      Включить
                    </button>
                  )}
                </div>

                <div className="setting-item">
                  <div className="setting-info">
                    <span className="setting-icon">💬</span>
                    <div>
                      <div className="setting-title">Новые сообщения</div>
                      <div className="setting-description">Уведомления о новых сообщениях</div>
                    </div>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={notificationSettings.newMessages} onChange={(e) => setNotificationSettings(prev => ({ ...prev, newMessages: e.target.checked }))} />
                    <span className="slider"></span>
                  </label>
                </div>

                <div className="setting-item">
                  <div className="setting-info">
                    <span className="setting-icon">🎂</span>
                    <div>
                      <div className="setting-title">Дни рождения</div>
                      <div className="setting-description">Уведомления о днях рождениях пользователей</div>
                    </div>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={notificationSettings.birthdays} onChange={(e) => setNotificationSettings(prev => ({ ...prev, birthdays: e.target.checked }))} />
                    <span className="slider"></span>
                  </label>
                </div>

                <div className="setting-item">
                  <div className="setting-info">
                    <span className="setting-icon">🔊</span>
                    <div>
                      <div className="setting-title">Звук</div>
                      <div className="setting-description">Звуковые уведомления</div>
                    </div>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={notificationSettings.sound} onChange={(e) => setNotificationSettings(prev => ({ ...prev, sound: e.target.checked }))} />
                    <span className="slider"></span>
                  </label>
                </div>

                <div className="setting-item">
                  <div className="setting-info">
                    <span className="setting-icon">🤖</span>
                    <div>
                      <div className="setting-title">Бот-помощник</div>
                      <div className="setting-description">Уведомления от бота-помощника</div>
                    </div>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={notificationSettings.botAssistant} onChange={(e) => setNotificationSettings(prev => ({ ...prev, botAssistant: e.target.checked }))} />
                    <span className="slider"></span>
                  </label>
                </div>

                <div className="setting-item">
                  <div className="setting-info">
                    <span className="setting-icon">📋</span>
                    <div>
                      <div className="setting-title">Задачи</div>
                      <div className="setting-description">Уведомления о задачах</div>
                    </div>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={notificationSettings.tasks} onChange={(e) => setNotificationSettings(prev => ({ ...prev, tasks: e.target.checked }))} />
                    <span className="slider"></span>
                  </label>
                </div>

                <div className="setting-item">
                  <div className="setting-info">
                    <span className="setting-icon">📅</span>
                    <div>
                      <div className="setting-title">Переговорная</div>
                      <div className="setting-description">Уведомления о бронированиях переговорной</div>
                    </div>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={notificationSettings.meetingRoom} onChange={(e) => setNotificationSettings(prev => ({ ...prev, meetingRoom: e.target.checked }))} />
                    <span className="slider"></span>
                  </label>
                </div>
              </div>

              <div className="setting-section">
                <button className="btn-secondary" onClick={handleOpenChats}>Отмена</button>
                <button className="btn-primary" onClick={handleSaveNotificationSettings}>Сохранить уведомления</button>
              </div>
            </div>
          )}

          {activeSettingsTab === 'about' && (
            <div className="settings-tab-content">
              <div className="about-app-container">
                <div className="about-app-header">
                  <div className="about-app-logo">🍦</div>
                  <h2>Чат УРСА</h2>
                  <p className="about-app-subtitle">Корпоративный мессенджер</p>
                </div>

                <div className="about-app-info">
                  <p>Версия: {appVersion}</p>
                  <p>Разработчик: Pantyuhov DI</p>
                </div>

                <div className="about-app-update">
                  <h3>Обновления</h3>
                  {updateStatus === null && (
                    <button className="btn-primary" onClick={checkForUpdates}>Проверить обновления</button>
                  )}
                  {updateStatus === 'checking' && <p>⏳ Проверка обновлений...</p>}
                  {updateStatus === 'available' && electronUpdateInfo && (
                    <div>
                      <p>📦 Доступно обновление v{electronUpdateInfo.version}</p>
                      <button className="btn-primary" onClick={startUpdateDownload}>Обновить</button>
                    </div>
                  )}
                  {updateStatus === 'available' && browserUpdateInfo && (
                    <div>
                      <p>📦 Доступно обновление v{browserUpdateInfo.latestVersion}</p>
                      <button className="btn-primary" onClick={() => { window.open(browserUpdateInfo.releaseUrl, '_blank'); }}>Скачать</button>
                    </div>
                  )}
                  {updateStatus === 'downloading' && (
                    <div>
                      <p>⏳ Загрузка обновления... {Math.round(updateProgress)}%</p>
                      <div className="update-progress-bar">
                        <div className="update-progress-bar-fill" style={{ width: `${Math.round(updateProgress)}%` }} />
                      </div>
                    </div>
                  )}
                  {updateStatus === 'ready' && electronUpdateInfo && (
                    <div>
                      <p>✅ Обновление v{electronUpdateInfo.version} готово</p>
                      <button className="btn-primary" onClick={installUpdate}>Установить и перезапустить</button>
                    </div>
                  )}
                  {updateStatus === 'no-update' && <p>✅ У вас последняя версия</p>}
                  {updateStatus === 'error' && (
                    <div>
                      <p>❌ Ошибка проверки обновлений</p>
                      <button className="btn-primary" onClick={checkForUpdates}>Повторить</button>
                    </div>
                  )}
                </div>

                <div className="about-app-footer">
                  <p>© 2026 Pantyuhov DI. Все права защищены.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
