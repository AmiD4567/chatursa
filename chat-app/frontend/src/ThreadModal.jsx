import React, { useState, useEffect, useRef } from 'react';
import './ThreadModal.css';
import Dialog from './Dialog';

// Окно обсуждения (треда).
// Раньше компонент существовал, но не был подключён и не работал:
// renderMessageContent получал объект вместо строки, а стили .thread-*
// отсутствовали. Ответ отправляется через REST и помечается thread: true,
// чтобы не попадать в общую ленту.
function ThreadModal({
  open,
  messageId,
  serverUrl,
  currentUser,
  onClose,
  formatTime,
  renderMessageContent,
  onReplySent,
  refreshTick = 0,
}) {
  const [original, setOriginal] = useState(null);
  const [replies, setReplies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (!open || !messageId) return;
    // При обновлении уже открытого окна не показываем загрузку заново,
    // иначе список мигал бы на каждый пришедший ответ
    setLoading((prev) => (original ? false : true));
    setError(null);
    let cancelled = false;
    fetch(`${serverUrl}/api/thread/${messageId}?userId=${currentUser.id}`)
      .then((r) => {
        if (!r.ok) throw new Error('Не удалось загрузить обсуждение');
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        setOriginal(data.original);
        setReplies(data.replies || []);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, messageId, serverUrl, currentUser.id, refreshTick]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [replies]);

  const handleSendReply = async () => {
    const trimmed = replyText.trim();
    if (!trimmed || sending || !original) return;
    setSending(true);
    setError(null);
    try {
      const resp = await fetch(`${serverUrl}/api/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: original.chatId,
          senderId: currentUser.id,
          text: trimmed,
          replyTo: {
            messageId: original.id,
            text: (original.text || '').substring(0, 300),
            senderName: original.senderName,
            thread: true,
          },
        }),
      });
      const data = await resp.json();
      if (resp.ok && data.message) {
        setReplies((prev) => [...prev, data.message]);
        setReplyText('');
        if (onReplySent) onReplySent(original.id, replies.length + 1);
      } else {
        setError(data.error || 'Сервер отклонил ответ');
      }
    } catch (e) {
      setError('Ошибка сети: ' + e.message);
    } finally {
      setSending(false);
    }
  };

  const avatarOf = (m) =>
    m.senderAvatar ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(m.senderName || '?')}&background=667eea&color=fff&size=28`;

  const renderAuthor = (m) => (
    <div className="thread-message-sender">
      <img
        src={avatarOf(m)}
        alt={m.senderName}
        className="thread-avatar"
        onError={(e) => {
          e.target.onerror = null;
          e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || '?')}&background=667eea&color=fff&size=28`;
        }}
      />
      <span className="thread-sender-name">{m.senderName}</span>
      <span className="thread-time">{formatTime(m.timestamp)}</span>
    </div>
  );

  return (
    <Dialog open={open} onClose={onClose} className="thread-modal">
      <div className="modal-header">
        <h3>Обсуждение</h3>
        <button type="button" className="modal-close-btn" aria-label="Закрыть" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="modal-body thread-modal-body" ref={listRef}>
        {loading && <div className="thread-loading">Загрузка…</div>}
        {error && !loading && <div className="thread-no-replies">{error}</div>}

        {!loading && !error && (
          <>
            {original && (
              <div className="thread-original-message">
                {renderAuthor(original)}
                <div className="thread-message-text">{renderMessageContent(original.text)}</div>
              </div>
            )}

            <div className="thread-replies-divider">
              <span>
                {replies.length} {replies.length === 1 ? 'ответ' : 'ответа'}
              </span>
            </div>

            {replies.length === 0 ? (
              <div className="thread-no-replies">Пока нет ответов</div>
            ) : (
              <div className="thread-replies-list">
                {replies.map((reply) => (
                  <div key={reply.id} className="thread-reply-item">
                    {renderAuthor(reply)}
                    <div className="thread-message-text">{renderMessageContent(reply.text)}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="thread-input-area">
        <input
          type="text"
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSendReply();
            }
          }}
          placeholder="Написать ответ…"
          className="thread-input"
        />
        <button
          type="button"
          className="thread-send-btn"
          onClick={handleSendReply}
          disabled={!replyText.trim() || sending}
          aria-label="Отправить ответ"
        >
          ➤
        </button>
      </div>
    </Dialog>
  );
}

export default ThreadModal;
