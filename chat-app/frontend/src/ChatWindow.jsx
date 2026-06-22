import React from 'react';

function ChatWindow({
  children,
  activeChat,
  messages,
  currentUser,
  typingUsers,
  activeChatId,
  pinnedMessages,
  showPinnedBar,
  pinnedBarCollapsed,
  messageReactions,
  messagesEndRef,
  onOpenChatMenu,
  onTogglePinnedBar,
  onOpenPinnedModal,
  onContextMenu,
  onRemoveReaction,
  onBotButtonClick,
  onViewUserProfile,
  onScrollToMessage,
  onImageClick,
  onOpenThread,
  onCreateNewChat,
  serverUrl,
  extractFileUuidFromUrl,
  getChatDisplayName,
  getChatIcon,
  getOnlineUsersCount,
  formatDate,
  isBotMessage,
  isStickerOnlyMessage,
  formatBotText,
  renderMessageContent,
  formatTime,
  renderMessageStatus,
  renderEmoji,
  stripStickerMarkers,
  getFileIcon,
}) {
  return (
    <main className="chat-main">
      {activeChat ? (
        <div className="chat-view-container">
          <header className="chat-header-main">
            <div className="chat-title">
              {activeChat.type === 'direct' && activeChat.participantsDetails ? (
                (() => {
                  const otherUser = activeChat.participantsDetails.find(
                    p => p.username !== currentUser?.username
                  );
                  return otherUser ? (
                    <img
                      src={otherUser.avatar || activeChat.avatar || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(otherUser.username)}
                      alt={otherUser.username}
                      className="chat-header-avatar"
                      onClick={() => {
                        onViewUserProfile({
                          id: otherUser.id,
                          username: otherUser.username,
                          avatar: otherUser.avatar,
                          status: otherUser.status
                        });
                      }}
                      style={{ cursor: 'pointer' }}
                      title="Посмотреть профиль"
                    />
                  ) : (
                    <span className="chat-icon-large">{getChatIcon(activeChat)}</span>
                  );
                })()
              ) : activeChat.type === 'general' ? (
                <div
                  onClick={() => {
                    if (currentUser?.is_admin === 1) {
                      onViewUserProfile({
                        id: 'general',
                        username: 'Общий чат',
                        avatar: activeChat.avatar,
                        isGeneralChat: true
                      });
                    }
                  }}
                  style={{ cursor: currentUser?.is_admin === 1 ? 'pointer' : 'default' }}
                  title={currentUser?.is_admin === 1 ? 'Настройки общего чата' : ''}
                >
                  {activeChat.avatar ? (
                    <img
                      src={activeChat.avatar}
                      alt="Общий чат"
                      className="chat-header-avatar"
                    />
                  ) : (
                    <span className="chat-icon-large">{getChatIcon(activeChat)}</span>
                  )}
                </div>
              ) : (
                <span className="chat-icon-large">{getChatIcon(activeChat)}</span>
              )}
              <div>
                <h2>{getChatDisplayName(activeChat)}</h2>
                <span className="chat-status">
                  {Object.keys(typingUsers).length > 0 && activeChat.type === 'direct' && (
                    <span className="typing-indicator">
                      {Object.values(typingUsers).map((u, idx, arr) => (
                        <span key={u.username}>
                          {u.username} печатает
                          {arr.length > 1 && idx < arr.length - 1 ? ', ' : ''}
                        </span>
                      ))}
                      <span className="typing-dots">
                        <span>.</span><span>.</span><span>.</span>
                      </span>
                    </span>
                  )}

                  {Object.keys(typingUsers).length === 0 && activeChat.type === 'direct' && activeChat.participantsDetails ? (
                    (() => {
                      const otherUser = activeChat.participantsDetails.find(
                        p => p.username !== currentUser?.username
                      );
                      if (otherUser) {
                        const statusText = otherUser.status_text || '';
                        const isOnline = otherUser.status === 'online';

                        if (statusText) {
                          const firstChar = statusText.charAt(0);
                          const isEmoji = /[\p{Emoji}]/u.test(firstChar);

                          if (isEmoji) {
                            const textOnly = statusText.substring(1).trim();
                            return (
                              <span className="user-status-text with-text">
                                {textOnly || firstChar}
                              </span>
                            );
                          } else {
                            return (
                              <span className="user-status-text with-text">
                                {statusText}
                              </span>
                            );
                          }
                        } else {
                          return (
                            <span className={`user-status-text ${isOnline ? 'online' : 'offline'}`}>
                              {isOnline ? 'Онлайн' : 'Офлайн'}
                            </span>
                          );
                        }
                      }
                      return null;
                    })()
                  ) : Object.keys(typingUsers).length === 0 && (
                    <span className="user-status-text online">
                      {getOnlineUsersCount(activeChat)} онлайн
                    </span>
                  )}
                </span>
              </div>
            </div>
            <button
              className="chat-menu-btn"
              onClick={onOpenChatMenu}
              title="Меню чата"
            >
              ⋮
            </button>
          </header>

          <div className="messages-container-main" key={activeChatId || 'no-chat'}>
            {showPinnedBar && pinnedMessages[activeChatId] && pinnedMessages[activeChatId].length > 0 && (
              <>
                {pinnedBarCollapsed ? (
                  <div className="pinned-messages-bar collapsed" onClick={() => onTogglePinnedBar(false)}>
                    <span className="pinned-icon">📌</span>
                  </div>
                ) : (
                  <div className="pinned-messages-bar" onClick={onOpenPinnedModal}>
                    <div className="pinned-messages-bar-content">
                      <span className="pinned-icon">📌</span>
                      <span className="pinned-text">
                        {pinnedMessages[activeChatId].length === 1
                          ? 'Закреплённое сообщение'
                          : `${pinnedMessages[activeChatId].length} закреплённых сообщения(й)`}
                      </span>
                      <button className="pinned-collapse-btn" onClick={(e) => { e.stopPropagation(); onTogglePinnedBar(true); }} title="Свернуть">
                        ▲
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
            {messages.filter(m => m.id).map((message, index) => {
              const prevMessage = index > 0 ? messages[index - 1] : null;
              const isGrouped = prevMessage && prevMessage.senderId === message.senderId;

              const isOwn = message.senderId === currentUser?.id;

              let sideChanged = false;
              if (!isGrouped && prevMessage) {
                const prevIsOwn = prevMessage.senderId === currentUser?.id;
                sideChanged = isOwn !== prevIsOwn;
              }

              const currentDate = new Date(message.timestamp).toDateString();
              const prevDate = prevMessage ? new Date(prevMessage.timestamp).toDateString() : null;
              const showDateSeparator = !prevDate || currentDate !== prevDate;

              return (
                <React.Fragment key={message.id}>
                  {showDateSeparator && (
                    <div className="date-separator">
                      <span className="date-separator-line" />
                      <span className="date-separator-text">{formatDate(message.timestamp)}</span>
                      <span className="date-separator-line" />
                    </div>
                  )}
                  <div
                    id={`message-${message.id}`}
                    className={`message-main ${message.senderId === currentUser?.id ? 'own' : ''} ${isBotMessage(message) ? 'message-bot' : ''} ${isGrouped ? 'message-grouped' : ''} ${sideChanged ? 'side-changed' : ''}`}
                    onContextMenu={(e) => onContextMenu(e, message.id, message.text, message.chatId, message.senderId, message.senderName)}
                  >
                    {!isGrouped && (
                      <img
                        src={message.senderAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(message.senderName || '?')}&background=667eea&color=fff`}
                        alt={message.senderName}
                        className="message-avatar"
                        onError={(e) => { e.target.onerror = null; e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || '?')}&background=667eea&color=fff`; }}
                      />
                    )}
                    {isGrouped && <div className="message-avatar-spacer" />}
                    <div className="message-content" data-message-id={message.id}>
                      <div className="message-bubble-wrapper">
                        {!isBotMessage(message) && message.forwarded_from && (
                          <span className="forwarded-badge">
                            ↗️ Переслано от {message.forwarded_from.sender_name}
                          </span>
                        )}
                        {!isBotMessage(message) && message.reply_to && (
                          <div
                            className="reply-quote-preview"
                            onClick={() => onScrollToMessage(message.reply_to.messageId)}
                            title="Нажмите, чтобы перейти к оригинальному сообщению"
                          >
                            <span className="reply-quote-icon">↩</span>
                            <div className="reply-quote-content">
                              <p className="reply-quote-text">{stripStickerMarkers(message.reply_to.text)}</p>
                            </div>
                          </div>
                        )}
                        {message.text && (
                          <div className="message-text-wrapper">
                            <div className="message-text-content">
                              <p className={`message-text-main${isStickerOnlyMessage(message.text) ? ' sticker-message' : ''}`} onContextMenu={(e) => onContextMenu(e, message.id, message.text, message.chatId, message.senderId, message.senderName)}>
                                {isBotMessage(message) ? formatBotText(message.text) : renderMessageContent(message.text)}
                              </p>
                              <div className="message-time-inline">
                                <span className="message-time-main">{formatTime(message.timestamp)}</span>
                                {message.edited && <span className="message-edited-indicator" title="Отредактировано">ред.</span>}
                                {renderMessageStatus(message)}
                              </div>
                            </div>
                            {!isBotMessage(message) && messageReactions[message.id]?.reactions && Object.keys(messageReactions[message.id].reactions).length > 0 && (
                              <div className="message-reactions-inline">
                                {Object.entries(messageReactions[message.id].reactions).map(([emoji, users]) => {
                                  const hasCurrentUserReaction = users.some(u => u.userId === currentUser?.id);
                                  const visibleUsers = users.slice(0, 3);
                                  const remainingCount = users.length - 3;

                                  return (
                                    <button
                                      key={emoji}
                                      className={`reaction-badge-inline ${hasCurrentUserReaction ? 'current-user' : ''}`}
                                      onClick={() => hasCurrentUserReaction ? onRemoveReaction(emoji, message.id) : null}
                                      title={users.map(u => u.username).join(', ')}
                                    >
                                      <span className="reaction-emoji-inline">{renderEmoji(emoji, '', 20)}</span>
                                      <div className="reaction-avatars-inline">
                                        {visibleUsers.map((user, idx) => (
                                          <img
                                            key={idx}
                                            src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.username)}&background=random`}
                                            alt={user.username}
                                            className="reaction-avatar-inline"
                                          />
                                        ))}
                                        {remainingCount > 0 && (
                                          <span className="reaction-remaining-inline">+{remainingCount}</span>
                                        )}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                            {message.replyCount > 0 && (
                              <button
                                className="thread-btn-inline"
                                onClick={() => onOpenThread(message.id)}
                                title={`${message.replyCount} ответ(ов)`}
                              >
                                💬 {message.replyCount}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      {isBotMessage(message) && message.buttons && message.buttons.length > 0 && (
                        <div className="bot-buttons">
                          {message.buttons.map((btn, idx) => (
                            <button
                              key={idx}
                              className="bot-button"
                              onClick={() => onBotButtonClick(btn.action)}
                            >
                              {btn.label}
                            </button>
                          ))}
                        </div>
                      )}
                      {!isBotMessage(message) && message.file && (
                        <div className="message-file-main">
                          {message.file.mimetype?.startsWith('image/') ? (
                            <img
                              src={message.file.url}
                              alt={message.file.filename}
                              onClick={() => onImageClick(message.file.url, message.file.filename)}
                              className="message-image-clickable"
                            />
                          ) : message.file.mimetype?.startsWith('audio/') ? (
                            <VoiceMessagePlayer src={message.file.url} />
                          ) : (
                            <a href={`${serverUrl}/api/download/${extractFileUuidFromUrl(message.file.url)}`} className="file-link-main" title={message.file.filename} download>
                              <span className="file-icon-main">{getFileIcon(message.file.mimetype)}</span>
                              <div className="file-info-main">
                                <span className="file-name-main">{message.file.filename}</span>
                                <span className="file-size-main">{(message.file.size / 1024).toFixed(1)} KB</span>
                              </div>
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        </div>
      ) : (
        <div className="no-chat-selected">
          <h2>Выберите чат для начала общения</h2>
          <p>Или создайте новый чат</p>
          <button onClick={onCreateNewChat}>Создать чат</button>
        </div>
      )}
      {activeChat && children}
    </main>
  );
}

function VoiceMessagePlayer({ src }) {
  const audioRef = React.useRef(null);
  const [playing, setPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);

  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onMeta = () => setDuration(audio.duration || 0);
    const onTime = () => setCurrentTime(audio.currentTime);
    const onEnd = () => { setPlaying(false); setCurrentTime(0); };
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('canplaythrough', onMeta);
    return () => {
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('canplaythrough', onMeta);
    };
  }, []);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); setPlaying(false); }
    else { audio.play().then(() => setPlaying(true)).catch(() => {}); }
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const fmt = (s) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="voice-message-player" onClick={e => e.stopPropagation()}>
      <audio ref={audioRef} src={src} preload="metadata" />
      <button className={`voice-play-btn ${playing ? 'is-playing' : ''}`} onClick={toggle}>
        {playing ? '⏸' : '▶'}
      </button>
      <div className="voice-progress-wrap">
        <div className="voice-progress-track">
          <div className="voice-progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>
      <span className="voice-duration">{playing || currentTime > 0 ? fmt(currentTime) : fmt(duration)}</span>
    </div>
  );
}

export default ChatWindow;
