import React from 'react';

function AdminPanel({
  currentUser,
  activeAdminTab,
  adminStats,
  adminUsers,
  hostCounts,
  activeSessions,
  uploadedFiles,
  securityLogs,
  onOpenChats,
  onAdminTabChange,
  onOpenSessions,
  onOpenFileManager,
  onOpenSecurityLogs,
  onToggleMeetingRoomRights,
  onToggleAdminRights,
  onOpenResetPassword,
  onDeleteUser,
  onOpenCreateUser,
  onTerminateSession,
  onDeleteFile,
}) {
  return (
    <main className="full-page-view">
      <div className="full-page-header">
        <div className="full-page-header-content">
          <button className="back-to-chats-btn white" onClick={onOpenChats} title="Вернуться к чатам">
            ← Чаты
          </button>
          <h2>⚙️ Панель администратора</h2>
        </div>
      </div>

      <div className="full-page-content admin-full-page">
        <div className="admin-tabs">
          <button
            className={`admin-tab ${activeAdminTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => onAdminTabChange('dashboard')}
          >
            📊 Главная
          </button>
          <button
            className={`admin-tab ${activeAdminTab === 'users' ? 'active' : ''}`}
            onClick={() => onAdminTabChange('users')}
          >
            👥 Пользователи
          </button>
          <button
            className={`admin-tab ${activeAdminTab === 'sessions' ? 'active' : ''}`}
            onClick={() => { onAdminTabChange('sessions'); onOpenSessions(); }}
          >
            💻 Сессии
          </button>
          <button
            className={`admin-tab ${activeAdminTab === 'files' ? 'active' : ''}`}
            onClick={() => { onAdminTabChange('files'); onOpenFileManager(); }}
          >
            📁 Файлы
          </button>
          <button
            className={`admin-tab ${activeAdminTab === 'security' ? 'active' : ''}`}
            onClick={() => { onAdminTabChange('security'); onOpenSecurityLogs(); }}
          >
            🛡️ Безопасность
          </button>
          <button
            className={`admin-tab ${activeAdminTab === '2fa' ? 'active' : ''}`}
            onClick={() => onAdminTabChange('2fa')}
          >
            🔐 2FA
          </button>
        </div>

        <div className="admin-content">
            {activeAdminTab === 'dashboard' && adminStats && (
              <div className="admin-dashboard">
                <div className="admin-stat-card">
                  <div className="stat-icon">👥</div>
                  <div className="stat-info">
                    <div className="stat-value">{adminStats.totalUsers}</div>
                    <div className="stat-label">Пользователей</div>
                  </div>
                </div>
                <div className="admin-stat-card">
                  <div className="stat-icon">📝</div>
                  <div className="stat-info">
                    <div className="stat-value">{adminStats.totalMessages}</div>
                    <div className="stat-label">Сообщений</div>
                  </div>
                </div>
                <div className="admin-stat-card">
                  <div className="stat-icon">📁</div>
                  <div className="stat-info">
                    <div className="stat-value">{adminStats.totalFiles}</div>
                    <div className="stat-label">Файлов</div>
                  </div>
                </div>
                <div className="admin-stat-card">
                  <div className="stat-icon">🟢</div>
                  <div className="stat-info">
                    <div className="stat-value">{adminStats.onlineUsers}</div>
                    <div className="stat-label">Онлайн</div>
                  </div>
                </div>
                <div className="admin-stat-card">
                  <div className="stat-icon">💾</div>
                  <div className="stat-info">
                    <div className="stat-value">{(adminStats.uploadsSize / 1024 / 1024).toFixed(2)} МБ</div>
                    <div className="stat-label">Файлы</div>
                  </div>
                </div>
              </div>
            )}

            {activeAdminTab === 'users' && (
              <div className="admin-users-list">
                <div className="admin-users-header">
                  <h4>Все пользователи</h4>
                  <button
                    className="btn-primary"
                    onClick={onOpenCreateUser}
                  >
                    ➕ Создать пользователя
                  </button>
                </div>
                <div className="host-warning">
                  <strong>⚠️ Подозрительные компьютеры:</strong>{' '}
                  {Object.entries(hostCounts)
                    .filter(([_, count]) => count > 3)
                    .map(([host, count]) => (
                      <span key={host} className="host-warning-item">
                        {host} ({count} учётных записей)
                      </span>
                    ))}
                  {Object.entries(hostCounts).filter(([_, count]) => count > 3).length === 0 && (
                    <span className="no-warning">подозрительных компьютеров не обнаружено</span>
                  )}
                </div>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Имя</th>
                      <th>Email</th>
                      <th>Статус</th>
                      <th>Роль</th>
                      <th>Компьютер</th>
                      <th>IP</th>
                      <th>Бронирование</th>
                      <th>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminUsers.map(user => {
                      const userHostCount = hostCounts[user.host] || 1;
                      return (
                        <tr key={user.id} className={userHostCount > 3 ? 'suspicious-row' : ''}>
                          <td>
                            <div className="user-cell">
                              <img src={user.avatar || `https://ui-avatars.com/api/?name=${user.username}`} alt={user.username} className="user-avatar-small" />
                              <span>{user.username}</span>
                              {userHostCount > 3 && (
                                <span className="suspicious-badge" title={`Этот компьютер создал ${userHostCount} учётных записей`}>
                                  ⚠️ {userHostCount}
                                </span>
                              )}
                            </div>
                          </td>
                          <td>{user.email || '-'}</td>
                          <td>
                            <span className={`status-badge ${user.status}`}>
                              {user.status === 'online' ? '🟢 Онлайн' : '⚫ Офлайн'}
                            </span>
                          </td>
                          <td>
                            {user.is_admin === 1 ? (
                              <span className="admin-badge">👑 Админ</span>
                            ) : (
                              <span>Пользователь</span>
                            )}
                          </td>
                          <td className="host-cell" title={user.host}>
                            <code>{user.host || 'unknown'}</code>
                          </td>
                          <td className="ip-cell">{user.ip_address || 'unknown'}</td>
                          <td>
                            <label className="toggle-switch">
                              <input
                                type="checkbox"
                                checked={user.can_book_meeting_room === 1 || user.username === 'Root'}
                                onChange={() => onToggleMeetingRoomRights(user.id, user.can_book_meeting_room)}
                                disabled={user.username === 'Root'}
                                title={user.username === 'Root' ? 'Root имеет право по умолчанию' : 'Переключить право на бронирование'}
                              />
                              <span className="toggle-slider"></span>
                            </label>
                          </td>
                          <td>
                            <div className="action-buttons">
                              <button
                                className="action-btn edit"
                                onClick={() => onToggleAdminRights(user.id, user.is_admin)}
                                title={user.is_admin === 1 ? 'Снять права админа' : 'Дать права админа'}
                              >
                                {user.is_admin === 1 ? '👤' : '👑'}
                              </button>
                              <button
                                className="action-btn reset"
                                onClick={() => onOpenResetPassword(user)}
                                title="Сбросить пароль"
                              >
                                🔑
                              </button>
                              <button
                                className="action-btn delete"
                                onClick={() => onDeleteUser(user.id)}
                                title="Удалить"
                              >
                                🗑️
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {activeAdminTab === 'sessions' && (
              <div className="admin-sessions-list">
                <h4>💻 Активные сессии</h4>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Пользователь</th>
                      <th>IP адрес</th>
                      <th>Браузер</th>
                      <th>Вход</th>
                      <th>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeSessions.map(session => (
                      <tr key={session.id}>
                        <td>
                          <div className="user-cell">
                            <img src={session.avatar || `https://ui-avatars.com/api/?name=${session.username}`} alt={session.username} className="user-avatar-small" />
                            <span>{session.username}</span>
                          </div>
                        </td>
                        <td>{session.ip || 'unknown'}</td>
                        <td>{session.browser || 'Unknown'}</td>
                        <td>{new Date(session.loginTime).toLocaleString('ru-RU')}</td>
                        <td>
                          <button
                            className="action-btn delete"
                            onClick={() => onTerminateSession(session.id)}
                            title="Завершить сессию"
                          >
                            ⏹️
                          </button>
                        </td>
                      </tr>
                    ))}
                    {activeSessions.length === 0 && (
                      <tr>
                        <td colSpan="5" style={{textAlign: 'center', padding: '20px'}}>Нет активных сессий</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {activeAdminTab === 'files' && (
              <div className="admin-files-list">
                <h4>📁 Загруженные файлы</h4>
                <div className="files-grid">
                  {uploadedFiles.map(file => (
                    <div key={file.id} className="file-card">
                      <div className="file-icon">
                        {file.mime_type?.startsWith('image/') ? '🖼️' : 
                         file.mime_type?.startsWith('video/') ? '🎬' :
                         file.mime_type?.startsWith('audio/') ? '🎵' :
                         file.mime_type?.includes('pdf') ? '📄' : '📁'}
                      </div>
                      <div className="file-name">{file.name}</div>
                      <div className="file-info">
                        <span>{(file.size / 1024).toFixed(1)} КБ</span>
                        <span>{new Date(file.created_at).toLocaleDateString('ru-RU')}</span>
                      </div>
                      <button
                        className="action-btn delete"
                        onClick={() => onDeleteFile(file)}
                        title="Удалить файл"
                      >
                        🗑️
                      </button>
                    </div>
                  ))}
                </div>
                {uploadedFiles.length === 0 && (
                  <p style={{textAlign: 'center', color: 'var(--text-tertiary)', padding: '40px'}}>Нет загруженных файлов</p>
                )}
              </div>
            )}

            {activeAdminTab === 'security' && (
              <div className="admin-security-logs">
                <h4>🛡️ Журнал безопасности</h4>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Время</th>
                      <th>Событие</th>
                      <th>Пользователь</th>
                      <th>IP адрес</th>
                      <th>Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {securityLogs.map(log => (
                      <tr key={log.id}>
                        <td>{new Date(log.timestamp).toLocaleString('ru-RU')}</td>
                        <td>
                          <span className={`log-event ${log.event_type}`}>
                            {log.event_type === 'failed_login' && '🔴 '}
                            {log.event_type === 'success_login' && '🟢 '}
                            {log.event_type === 'password_reset' && '🔑 '}
                            {log.event_type === 'session_terminated' && '⏹️ '}
                            {log.event_type === 'user_blocked' && '🚫 '}
                            {log.event}
                          </span>
                        </td>
                        <td>{log.username || '-'}</td>
                        <td>{log.ip_address || '-'}</td>
                        <td>
                          <span className={`status-badge ${log.status === 'success' ? 'success' : 'warning'}`}>
                            {log.status === 'success' ? '✓' : '⚠'}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {securityLogs.length === 0 && (
                      <tr>
                        <td colSpan="5" style={{textAlign: 'center', padding: '20px'}}>Нет записей в журнале</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {activeAdminTab === '2fa' && (
              <div className="admin-2fa-settings">
                <h4>🔐 Двухфакторная аутентификация (TOTP)</h4>
                <p style={{marginBottom: '16px', color: 'var(--text-secondary)'}}>
                  Защитите свой аккаунт с помощью Google Authenticator или аналогичного приложения.
                </p>
                <div className="settings-form">
                  <button
                    className="create-btn"
                    onClick={async () => {
                      try {
                        const resp = await fetch('/api/admin/2fa/generate', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ userId: currentUser?.id })
                        });
                        const data = await resp.json();
                        if (data.qrCode) {
                          const w = window.open('', '_blank', 'width=400,height=500');
                          w.document.write(`<img src="${data.qrCode}" style="width:300px;display:block;margin:40px auto"/><p style="text-align:center;color:#333">Секретный ключ: ${data.secret}</p><p style="text-align:center;color:#666;font-size:12px">Или отсканируйте QR-код в приложении аутентификатора</p>`);
                        }
                      } catch (e) { alert('Ошибка: ' + e.message); }
                    }}
                  >
                    🔑 Сгенерировать ключ 2FA
                  </button>
                  <div style={{marginTop: '16px'}}>
                    <label>Код из аутентификатора</label>
                    <div style={{display: 'flex', gap: '8px', marginTop: '8px'}}>
                      <input
                        id="totp-input"
                        type="text"
                        placeholder="000000"
                        style={{flex: 1, maxWidth: '200px'}}
                        maxLength={6}
                      />
                      <button
                        className="create-btn"
                        onClick={async () => {
                          const input = document.getElementById('totp-input');
                          const token = input?.value;
                          if (!token || token.length < 6) { alert('Введите 6-значный код'); return; }
                          try {
                            const resp = await fetch('/api/admin/2fa/verify', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ userId: currentUser?.id, token })
                            });
                            const data = await resp.json();
                            if (data.success) { alert('✅ 2FA включена!'); input.value = ''; }
                            else { alert('❌ ' + (data.error || 'Ошибка')); }
                          } catch (e) { alert('Ошибка: ' + e.message); }
                        }}
                      >
                        ✅ Подтвердить и включить
                      </button>
                    </div>
                  </div>
                  <div style={{marginTop: '24px'}}>
                    <button
                      className="logout-btn danger-btn"
                      onClick={async () => {
                        if (!confirm('Вы уверены, что хотите отключить 2FA?')) return;
                        try {
                          const resp = await fetch('/api/admin/2fa/disable', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ userId: currentUser?.id })
                          });
                          const data = await resp.json();
                          if (data.success) alert('2FA отключена');
                          else alert('Ошибка: ' + (data.error || 'Неизвестная ошибка'));
                        } catch (e) { alert('Ошибка: ' + e.message); }
                      }}
                    >
                      🚫 Отключить 2FA
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
    </main>
  );
}

export default AdminPanel;
