import React from 'react';
import EmojiInlinePicker from './EmojiInlinePicker';

function MessageInput({
  inputText,
  selectedFile,
  isUploading,
  isDragOver,
  showEmojiPicker,
  emojiPickerPinned,
  replyToMessage,
  editingMessage,
  isEditMode,
  isTyping,
  socket,
  activeChatId,
  appTheme,
  serverUrl,
  messageInputRef,
  fileInputRef,
  openEmojiTimerRef,
  closeEmojiTimerRef,
  typingTimeoutRef,
  setInputText,
  setIsTyping,
  setShowEmojiPicker,
  setEmojiPickerPinned,
  setSelectedFile,
  setMessageDrafts,
  onSubmit,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  onAddEmoji,
  onStickerSend,
  onCancelReply,
  onCancelEdit,
  onFileSelect,
  onContextMenu,
  onImagePaste,
  hasInputContent,
  stripStickerMarkers,
}) {
  return (
    <div
      className={`message-form-drop-zone ${isDragOver ? 'drag-over' : ''}`}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <form className="message-form-main" style={{ position: 'relative' }} onSubmit={onSubmit} onKeyDown={(e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        onSubmit(e);
      }
    }}>
      {/* Inline picker смайлов */}
      <EmojiInlinePicker
        show={showEmojiPicker}
        onEmojiClick={(emoji) => onAddEmoji(emoji)}
        onStickerSend={onStickerSend}
        onClose={() => {
          setShowEmojiPicker(false);
          setEmojiPickerPinned(false);
        }}
        theme={appTheme}
        serverUrl={serverUrl}
      />

      {/* Inline reply preview */}
      {replyToMessage && (
        <div className="inline-reply-preview">
          <div className="inline-reply-bar">
            <span className="inline-reply-icon">↩</span>
            <span className="inline-reply-label">Ответ на сообщение от {replyToMessage.senderName}</span>
            <button type="button" className="inline-reply-cancel" onClick={onCancelReply} title="Отменить ответ">✕</button>
          </div>
          <p className="inline-reply-text">{stripStickerMarkers(replyToMessage.text)}</p>
        </div>
      )}
      {/* Индикатор режима редактирования */}
      {isEditMode && (
        <div className="edit-mode-indicator">
          <span className="edit-mode-icon">✏️</span>
          <span className="edit-mode-text">Режим редактирования</span>
          <button type="button" className="edit-mode-cancel" onClick={onCancelEdit} title="Отменить редактирование">✕</button>
        </div>
      )}
      <input
        type="file"
        ref={fileInputRef}
        onChange={onFileSelect}
        style={{ display: 'none' }}
        id="file-input-main"
      />
      <label htmlFor="file-input-main" className="file-btn-main" title="Прикрепить файл">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
        </svg>
      </label>
      {selectedFile && (
        <span className="selected-file-main">
          📎 {selectedFile.name}
          <button type="button" onClick={() => {
            setSelectedFile(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}>✕</button>
        </span>
      )}
      <div
        ref={messageInputRef}
        className={`message-input-contenteditable ${isEditMode ? 'edit-mode-active' : ''}`}
        contentEditable
        suppressContentEditableWarning
        data-placeholder="Введите сообщение..."
        onContextMenu={onContextMenu}
        onPaste={onImagePaste}
        onInput={(e) => {
          const text = e.currentTarget.textContent;
          setInputText(text);

          if (!isTyping) {
            setIsTyping(true);
            socket.emit('typing', { chatId: activeChatId, isTyping: true });
          }

          if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current);
          }

          typingTimeoutRef.current = setTimeout(() => {
            setIsTyping(false);
            socket.emit('typing', { chatId: activeChatId, isTyping: false });
          }, 1000);
        }}
        onBlur={() => {
          if (activeChatId && inputText) {
            setMessageDrafts(prev => ({
              ...prev,
              [activeChatId]: inputText
            }));
          }
        }}
        disabled={isUploading}
      />
      <div className="message-actions">
        <button
          type="button"
          className={`emoji-btn-send ${showEmojiPicker ? 'active' : ''}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setEmojiPickerPinned(prev => !prev);
            setShowEmojiPicker(prev => !prev);
            if (openEmojiTimerRef.current) {
              clearTimeout(openEmojiTimerRef.current);
              openEmojiTimerRef.current = null;
            }
            if (closeEmojiTimerRef.current) {
              clearTimeout(closeEmojiTimerRef.current);
              closeEmojiTimerRef.current = null;
            }
          }}
          title="Смайлы"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
            <line x1="9" y1="9" x2="9.01" y2="9"/>
            <line x1="15" y1="9" x2="15.01" y2="9"/>
          </svg>
        </button>
        <button type="submit" disabled={isUploading || (!hasInputContent() && !selectedFile)}>
          {isUploading ? '⏳' : '➤'}
        </button>
      </div>
    </form>
    </div>
  );
}

export default MessageInput;
