import React, { useState, useEffect, useRef } from 'react';

function ThreadModal({
  messageId,
  serverUrl,
  currentUser,
  onClose,
  formatTime,
  renderMessageContent,
}) {
  const [original, setOriginal] = useState(null);
  const [replies, setReplies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    setLoading(true);
    fetch(`${serverUrl}/api/thread/${messageId}?userId=${currentUser.id}`)
      .then(r => r.json())
      .then(data => {
        setOriginal(data.original);
        setReplies(data.replies);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [messageId, serverUrl, currentUser.id]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [replies]);

  const handleSendReply = async () => {
    if (!replyText.trim() || sending || !original) return;
    setSending(true);
    try {
      const resp = await fetch(`${serverUrl}/api/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: original.chatId,
          senderId: currentUser.id,
          text: replyText.trim(),
          replyTo: { messageId: original.id, text: (original.text || '').substring(0, 300), senderName: original.senderName }
        })
      });
      const data = await resp.json();
      if (data.message) {
        setReplies(prev => [...prev, data.message]);
        setReplyText('');
      }
    } catch (e) {
      alert('Ошибка: ' + e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content thread-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>💬 Тред</h3>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body thread-modal-body" ref={listRef}>
          {loading ? (
            <div className="thread-loading">Загрузка...</div>
          ) : (
            <>
              {original && (
                <div className="thread-original-message">
                  <div className="thread-message-sender">
                    <img src={original.senderAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(original.senderName || '?')}&background=667eea&color=fff&size=28`} alt={original.senderName} className="thread-avatar" onError={(e) => { e.target.onerror = null; e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || '?')}&background=667eea&color=fff&size=28`; }} />
                    <span className="thread-sender-name">{original.senderName}</span>
                    <span className="thread-time">{formatTime(original.timestamp)}</span>
                  </div>
                  <div className="thread-message-text">
                    {renderMessageContent(original)}
                  </div>
                </div>
              )}
              <div className="thread-replies-divider">
                <span>{replies.length} ответ(ов)</span>
              </div>
              <div className="thread-replies-list">
                {replies.length === 0 ? (
                  <div className="thread-no-replies">Нет ответов</div>
                ) : (
                  replies.map(reply => (
                    <div key={reply.id} className="thread-reply-item">
                      <div className="thread-message-sender">
                        <img src={reply.senderAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(reply.senderName || '?')}&background=667eea&color=fff&size=28`} alt={reply.senderName} className="thread-avatar" onError={(e) => { e.target.onerror = null; e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || '?')}&background=667eea&color=fff&size=28`; }} />
                        <span className="thread-sender-name">{reply.senderName}</span>
                        <span className="thread-time">{formatTime(reply.timestamp)}</span>
                      </div>
                      <div className="thread-message-text">
                        {renderMessageContent(reply)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
        <div className="thread-input-area">
          <input
            type="text"
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendReply(); } }}
            placeholder="Написать ответ..."
            className="thread-input"
          />
          <button
            className="thread-send-btn"
            onClick={handleSendReply}
            disabled={!replyText.trim() || sending}
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}

export default ThreadModal;
