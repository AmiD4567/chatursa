import React from 'react';

const ChatList = ({
  searchResults,
  searchQuery,
  isSearching,
  currentSearchIndex,
  chats,
  currentUser,
  activeChat,
  showUsersList,
  users,
  birthdaysToday,
  onCloseSearch,
  onSearchChange,
  onSearchMessages,
  onSearchResultClick,
  onSearchPrev,
  onSearchNext,
  onOpenNewChat,
  onSelectChat,
  onViewUserProfile,
  onCloseUsersList,
  formatTime,
  getChatIcon,
  getChatDisplayName,
  formatLastMessageTime,
  renderEmoji,
}) => {
  return (
    <aside className="sidebar">
      {searchResults.length > 0 && (
        <div className="chats-search-results-header">
          <span className="chats-search-results-count">Найдено: {searchResults.length}</span>
          <button className="search-clear-btn" onClick={onCloseSearch}>✕</button>
        </div>
      )}

      <div className="chats-section">
        <div className="section-header">
          <span>Чаты</span>
          <button className="new-chat-btn" onClick={onOpenNewChat} title="Новый чат">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>

        <div className="chats-search-container">
          <input
            type="text"
            className="chats-search-input"
            placeholder="Поиск сообщений..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && onSearchMessages()}
          />
          {isSearching && <span className="chats-search-loading">🔍</span>}
        </div>

        {searchResults.length > 0 ? (
          <div className="chats-list">
            {searchResults.map((result, idx) => (
              <div
                key={result.id || idx}
                className={`chat-item ${currentSearchIndex === idx ? 'active' : ''}`}
                onClick={() => onSearchResultClick(result)}
              >
                <div className="chat-item-left" style={{ cursor: 'pointer' }}>
                  <div className="chat-icon">{getChatIcon(result.chat || result)}</div>
                  <div className="chat-info">
                    <div className="chat-name-row">
                      <span className="chat-name">{result.chat?.name || result.chat?.title || result.senderName || 'Чат'}</span>
                      <span className="chat-time">{formatTime(result.timestamp)}</span>
                    </div>
                    <div className="chat-preview-row">
                      <span className="chat-preview">{result.senderName ? `${result.senderName}: ` : ''}{result.text || ''}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <div className="search-nav-controls">
              <button className="search-nav-btn" onClick={onSearchPrev}>↑</button>
              <span className="search-count">{currentSearchIndex + 1} / {searchResults.length}</span>
              <button className="search-nav-btn" onClick={onSearchNext}>↓</button>
            </div>
          </div>
        ) : (
          <div className="chats-list">
            {chats.sort((a, b) => {
              const aTime = a.lastMessage?.timestamp || a.createdAt;
              const bTime = b.lastMessage?.timestamp || b.createdAt;
              return new Date(bTime) - new Date(aTime);
            }).map(chat => {
              const otherUserId = chat.type === 'direct' && chat.participantsDetails
                ? chat.participantsDetails.find(p => p.username !== currentUser?.username)?.id
                : null;

              return (
                <div
                  key={chat.id}
                  className={`chat-item ${activeChat?.id === chat.id ? 'active' : ''} ${chat.id?.startsWith('bot-chat-') ? 'bot-chat' : ''}`}
                  data-user-id={otherUserId || ''}
                >
                  <div
                    className="chat-item-left"
                    onClick={() => onSelectChat(chat)}
                  >
                    {chat.type === 'direct' && chat.participantsDetails ? (
                      (() => {
                        const otherUser = chat.participantsDetails.find(
                          p => p.username !== currentUser?.username
                        );
                        return otherUser ? (
                          <div className="chat-avatar-wrapper">
                            <img
                              src={otherUser.avatar || chat.avatar || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(otherUser.username)}
                              alt={otherUser.username}
                              className="chat-avatar"
                            />
                            <span className={`chat-status-indicator ${otherUser.status === 'online' ? 'online' : ''}`}></span>
                          </div>
                        ) : (
                          <div className="chat-icon">{getChatIcon(chat)}</div>
                        );
                      })()
                    ) : chat.type === 'general' && chat.avatar ? (
                      <img
                        src={chat.avatar}
                        alt="Общий чат"
                        className="chat-avatar"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (currentUser?.is_admin === 1) {
                            onViewUserProfile({
                              id: 'general',
                              username: 'Общий чат',
                              avatar: chat.avatar,
                              isGeneralChat: true
                            });
                          }
                        }}
                        style={{ cursor: currentUser?.is_admin === 1 ? 'pointer' : 'default' }}
                        title={currentUser?.is_admin === 1 ? 'Настройки общего чата' : ''}
                      />
                    ) : (
                      <div className="chat-icon">{getChatIcon(chat)}</div>
                    )}
                    <div className="chat-info">
                      <div className="chat-name-row">
                        <span className="chat-name">
                          {getChatDisplayName(chat)}
                          {chat.type === 'direct' && chat.participantsDetails && (() => {
                            const otherUser = chat.participantsDetails.find(p => p.username !== currentUser?.username);
                            if (otherUser && birthdaysToday.some(b => b.id === otherUser.id)) {
                              return <span className="birthday-badge" title="Сегодня день рождения!">🎂</span>;
                            }
                            return null;
                          })()}
                        </span>
                        <span className="chat-time">{formatLastMessageTime(chat.lastMessage?.timestamp || chat.createdAt)}</span>
                      </div>
                      {chat.type === 'direct' && chat.participantsDetails && (() => {
                        const otherUser = chat.participantsDetails.find(p => p.username !== currentUser?.username);
                        if (otherUser && otherUser.status_text) {
                          const statusText = otherUser.status_text;
                          const maxLength = 20;
                          const displayStatus = statusText.length > maxLength
                            ? statusText.substring(0, maxLength) + ' ...'
                            : statusText;
                          return (
                            <div className="chat-status-row">
                              <span className="chat-status-text">
                                {displayStatus.split('').map((char, idx) => {
                                  if (/[\p{Emoji}]/u.test(char)) {
                                    return <span key={idx}>{renderEmoji(char)}</span>;
                                  }
                                  return char;
                                })}
                              </span>
                            </div>
                          );
                        }
                        return null;
                      })()}
                      <div className="chat-preview-row">
                        <span className="chat-preview">
                          {chat.lastMessage?.senderName && (
                            <span style={{ fontWeight: 500 }}>{chat.lastMessage.senderName}: </span>
                          )}
                          {chat.lastMessage?.text || 'Нет сообщений'}
                        </span>
                        {chat.unreadCount > 0 && (
                          <span className="unread-badge">{chat.unreadCount}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showUsersList && (
        <div className="users-section">
          <div className="section-header">
            <span>Пользователи</span>
            <button className="icon-btn small" onClick={onCloseUsersList}>✕</button>
          </div>
          <div className="users-list">
            {users.map(user => (
              <div key={user.id} className="user-item">
                <div className="user-avatar-wrapper">
                  <img src={user.avatar} alt={user.username} className="user-avatar-small" />
                  <span className={`status-indicator ${user.status}`}></span>
                  {user.status_text && (
                    <span className="user-status-badge">
                      {(() => {
                        const statusText = user.status_text;
                        const firstChar = statusText.charAt(0);
                        const isEmoji = /[\p{Emoji}]/u.test(firstChar);
                        if (isEmoji) {
                          return renderEmoji(firstChar);
                        }
                        return statusText;
                      })()}
                    </span>
                  )}
                </div>
                <span className="user-name-small">{user.username}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
};

export default ChatList;
