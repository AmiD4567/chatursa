export default function Sidebar({
  currentUser,
  activeView,
  showStatusPicker,
  isAdmin,
  unreadNotificationsCount,
  onOpenProfile,
  onOpenStatus,
  onOpenNotifications,
  onOpenChats,
  onOpenPhonebook,
  onOpenCalendar,
  onOpenSettings,
  onOpenAdmin,
  onLogout
}) {
  return (
    <aside className="sidebar-buttons">
      <div className="user-info" onClick={onOpenProfile} style={{ cursor: 'pointer' }} title={currentUser?.username}>
        <div className="user-avatar-wrapper">
          <img src={currentUser?.avatar} alt={currentUser?.username} className="user-avatar" />
        </div>
        <span className="user-name-sidebar">{currentUser?.username}</span>
      </div>
      <div className="buttons-column">
        <button
          className={`nav-sidebar-btn ${showStatusPicker ? 'active' : ''}`}
          onClick={onOpenStatus}
          title="Изменить статус"
        >
          <div className="nav-btn-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
              <line x1="9" y1="9" x2="9.01" y2="9"/>
              <line x1="15" y1="9" x2="15.01" y2="9"/>
            </svg>
          </div>
          <span className="nav-btn-label">Статус</span>
        </button>

        <button
          className={`nav-sidebar-btn ${showNotifications ? 'active' : ''}`}
          onClick={onOpenNotifications}
          title="Уведомления"
        >
          <div className="nav-btn-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            {unreadNotificationsCount > 0 && (
              <span className="nav-btn-badge">{unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}</span>
            )}
          </div>
          <span className="nav-btn-label">Уведомления</span>
        </button>

        <button
          className={`nav-sidebar-btn ${activeView === 'chats' ? 'active' : ''}`}
          onClick={onOpenChats}
          title="Чаты"
        >
          <div className="nav-btn-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <span className="nav-btn-label">Чаты</span>
        </button>

        <button
          className={`nav-sidebar-btn ${activeView === 'phonebook' ? 'active' : ''}`}
          onClick={onOpenPhonebook}
          title="Телефонная книга"
        >
          <div className="nav-btn-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <span className="nav-btn-label">Телефоны</span>
        </button>

        <button
          className={`nav-sidebar-btn ${activeView === 'calendar' ? 'active' : ''}`}
          onClick={onOpenCalendar}
          title="Календарь"
        >
          <div className="nav-btn-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </div>
          <span className="nav-btn-label">Календарь</span>
        </button>

        <button
          className={`nav-sidebar-btn ${activeView === 'settings' ? 'active' : ''}`}
          onClick={onOpenSettings}
          title="Настройки"
        >
          <div className="nav-btn-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </div>
          <span className="nav-btn-label">Настройки</span>
        </button>

        {isAdmin && (
          <button
            className={`nav-sidebar-btn ${activeView === 'admin' ? 'active' : ''}`}
            onClick={onOpenAdmin}
            title="Панель администратора"
          >
            <div className="nav-btn-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
            </div>
            <span className="nav-btn-label">Админ</span>
          </button>
        )}

        <button
          className="nav-sidebar-btn logout-btn"
          onClick={onLogout}
          title="Выйти"
        >
          <div className="nav-btn-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </div>
          <span className="nav-btn-label">Выйти</span>
        </button>
      </div>
    </aside>
  );
}
