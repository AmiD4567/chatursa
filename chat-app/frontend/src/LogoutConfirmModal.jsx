export default function LogoutConfirmModal({ show, onClose, onConfirm }) {
  if (!show) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content confirm-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>⚠️ Выход из аккаунта</h3>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p className="confirm-message">
            Вы уверены, что хотите выйти из аккаунта?
          </p>
        </div>
        <div className="modal-footer">
          <button className="cancel-btn" onClick={onClose}>
            Отмена
          </button>
          <button className="delete-btn" onClick={onConfirm}>
            Выйти
          </button>
        </div>
      </div>
    </div>
  );
}
