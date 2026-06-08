import React from 'react';

function CalendarTasks({
  currentUser,
  activeView,
  currentMonth,
  selectedDate,
  calendarTasks,
  calendarView,
  meetingRoomBookings,
  showTaskModal,
  showMeetingModal,
  showEditMeetingModal,
  showShareTaskModal,
  showSharedTasksModal,
  editingTask,
  editingBooking,
  taskForm,
  meetingForm,
  selectedDayTasks,
  taskToShare,
  availableUsers,
  selectedUsersForShare,
  sharedTasksReceived,
  canBookMeetingRoom,
  onPrevMonth,
  onNextMonth,
  onDateClick,
  onCalendarViewChange,
  onOpenNewTask,
  onCreateTask,
  onUpdateTask,
  onEditTask,
  onDeleteTask,
  onShareTask,
  onBookingMeetingRoom,
  onEditBooking,
  onDeleteBooking,
  onUpdateBooking,
  onToggleUserForShare,
  onConfirmShareTask,
  onAcceptSharedTask,
  onDeclineSharedTask,
  onFetchUsersList,
  formatTime,
  // Additional required props (not in original list but used in JSX)
  users,
  isAdmin,
  onOpenChats,
  onOpenMeetingModal,
  setShowTaskModal,
  setShowMeetingModal,
  setShowEditMeetingModal,
  setEditingBooking,
  setShowShareTaskModal,
  setShowSharedTasksModal,
  setTaskForm,
  setMeetingForm,
  onFetchSharedTasksReceived
}) {
  return (
    <>
      {activeView === 'calendar' && (
        <main className="full-page-view">
          <div className="full-page-header">
            <div className="full-page-header-content">
              <button className="back-to-chats-btn white" onClick={onOpenChats} title="Вернуться к чатам">
                ← Чаты
              </button>
              <h2>📅 Календарь</h2>
            </div>
          </div>

          <div className="full-page-content calendar-full-page">
            {/* Переключатель вкладок */}
            <div className="calendar-view-tabs">
              <button
                className={`calendar-tab-btn ${calendarView === 'tasks' ? 'active' : ''}`}
                onClick={() => onCalendarViewChange('tasks')}
              >
                📋 Задачи
              </button>
              <button
                className={`calendar-tab-btn ${calendarView === 'meeting-room' ? 'active' : ''}`}
                onClick={() => onCalendarViewChange('meeting-room')}
              >
                🏢 Бронирование переговорной
              </button>
            </div>

            <div className="calendar-layout-wrapper">
              {/* Левая колонка - Календарь */}
              <div className="calendar-left-panel">
                <div className="calendar-header">
                  <button className="calendar-nav-btn" onClick={onPrevMonth}>◀</button>
                  <h4 className="calendar-month-title">
                    {currentMonth.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
                  </h4>
                  <button className="calendar-nav-btn" onClick={onNextMonth}>▶</button>
                </div>

                <div className="calendar-grid">
                  {/* Дни недели */}
                  {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => (
                    <div key={`weekday-${day}`} className="calendar-day-header">{day}</div>
                  ))}

                  {/* Дни месяца */}
                  {(() => {
                      const year = currentMonth.getFullYear();
                      const month = currentMonth.getMonth();
                      const firstDay = new Date(year, month, 1);
                      const lastDay = new Date(year, month + 1, 0);
                      const startDay = (firstDay.getDay() + 6) % 7;
                      const days = [];

                      for (let i = 0; i < startDay; i++) {
                        days.push(<div key={`empty-${i}`} className="calendar-day empty"></div>);
                      }

                      for (let day = 1; day <= lastDay.getDate(); day++) {
                        const date = new Date(year, month, day);
                        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const dayTasks = calendarTasks.filter(t => t.task_date === dateStr);
                        const isToday = new Date().toDateString() === date.toDateString();
                        const isSelected = selectedDate && selectedDate.toDateString() === date.toDateString();

                    const dayBirthdays = users.filter(user => {
                      if (!user.birth_date) return false;
                      const birthDate = new Date(user.birth_date);
                      return birthDate.getDate() === day && (birthDate.getMonth() + 1) === (month + 1);
                    });

                    const isWeekend = date.getDay() === 0 || date.getDay() === 6;

                    days.push(
                      <div
                        key={day}
                        className={`calendar-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${isWeekend ? 'weekend' : ''}`}
                        onClick={() => onDateClick(date)}
                      >
                        <span className="calendar-day-number">{day}</span>
                        {/* Показываем индикаторы только в режиме задач */}
                        {calendarView === 'tasks' && (
                        <div className="calendar-tasks-preview">
                          {dayBirthdays.map(birthday => (
                            <div
                              key={birthday.id}
                              className="calendar-birthday-dot"
                              title={`🎂 ${birthday.username} - День рождения!`}
                            >
                              🎂
                            </div>
                          ))}
                          {dayTasks.slice(0, 3).map(task => (
                            <div
                              key={task.id}
                              className="calendar-task-dot"
                              style={{ backgroundColor: task.color }}
                              title={task.title}
                            ></div>
                          ))}
                          {dayTasks.length > 3 && (
                            <span className="calendar-tasks-more">+{dayTasks.length - 3}</span>
                          )}
                        </div>
                        )}
                      </div>
                    );
                  }

                  return days;
                })()}
            </div>
              </div>

              {/* Правая колонка - Список задач */}
              <div className="calendar-right-panel">
                {calendarView === 'tasks' && (
                <div className="calendar-selected-day-tasks full-page-tasks">
                  <div className="selected-day-header">
                    <h5>
                      {selectedDate
                        ? `Задачи на ${selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}`
                        : 'Выберите день для просмотра задач'}
                    </h5>
                    {selectedDate && (
                      <button className="add-task-btn" onClick={onOpenNewTask}>
                        + Добавить
                      </button>
                    )}
                  </div>
                  {selectedDate && (() => {
                    const dayBirthdays = users.filter(user => {
                      if (!user.birth_date) return false;
                      const birthDate = new Date(user.birth_date);
                      return birthDate.getDate() === selectedDate.getDate() &&
                             (birthDate.getMonth() + 1) === (selectedDate.getMonth() + 1);
                    });

                    return (
                      <>
                        {dayBirthdays.length > 0 && (
                          <div className="calendar-birthdays-section">
                            <h6 className="birthdays-title">🎂 Дни рождения:</h6>
                            {dayBirthdays.map(birthday => (
                              <div key={birthday.id} className="calendar-birthday-item">
                                <img src={birthday.avatar} alt={birthday.username} className="birthday-avatar" />
                                <div className="birthday-info">
                                  <span className="birthday-name">{birthday.username}</span>
                                  <span className="birthday-age">
                                    ({selectedDate.getFullYear() - new Date(birthday.birth_date).getFullYear()} лет)
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {selectedDayTasks.length === 0 ? (
                          <p className="no-tasks-message">Нет задач на этот день</p>
                        ) : (
                          <>
                            {selectedDayTasks.map(task => (
                          <div
                            key={task.id}
                            className="calendar-task-item"
                            onClick={() => onEditTask(task)}
                          >
                            {(task.task_time || task.task_end_time) && (
                              <div className="calendar-task-time-block">
                                <div className="calendar-task-time-start">{task.task_time || '--:--'}</div>
                                {(task.task_time && task.task_end_time) && (
                                  <div className="calendar-task-time-separator">-</div>
                                )}
                                <div className="calendar-task-time-end">{task.task_end_time || '--:--'}</div>
                              </div>
                            )}
                            <div className="calendar-task-content">
                              <div className="calendar-task-title-row">
                                <div className="calendar-task-title">{task.title}</div>
                              </div>
                              {task.description && (
                                <div className="calendar-task-description">{task.description}</div>
                              )}
                            </div>
                            <div className="calendar-task-actions">
                              <button
                                className="task-share-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onShareTask(task);
                                }}
                                title="Поделиться"
                              >
                                📤
                              </button>
                              <button
                                className="task-edit-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEditTask(task);
                                }}
                                title="Редактировать"
                              >
                                ✏️
                              </button>
                              <button
                                className="task-delete-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDeleteTask(task.id);
                                }}
                                title="Удалить"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </>
                );
              })()}
            </div>
            )}

            {/* Отображение для режима бронирования переговорной */}
            {calendarView === 'meeting-room' && (
            <div className="meeting-room-bookings full-page-tasks">
              <div className="selected-day-header">
                <h5>
                  {selectedDate
                    ? `Бронь на ${selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}`
                    : 'Выберите день для просмотра бронирований'}
                </h5>
                {selectedDate && (canBookMeetingRoom || currentUser?.username === 'Root' || currentUser?.is_admin === 1) && (
                  <button className="add-task-btn" onClick={onOpenMeetingModal}>
                    + Забронировать
                  </button>
                )}
              </div>
              {selectedDate && (() => {
                // Форматируем дату в YYYY-MM-DD
                const year = selectedDate.getFullYear();
                const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
                const day = String(selectedDate.getDate()).padStart(2, '0');
                const dateStr = `${year}-${month}-${day}`;
                
                const dayBookings = meetingRoomBookings.filter(b => {
                  const bookingDate = b.meeting_date;
                  return bookingDate === dateStr;
                });
                
                return dayBookings.length > 0 ? (
                  <div className="bookings-list">
                    {dayBookings.map(booking => (
                      <div key={booking.id} className="booking-item">
                        <div className="booking-time">
                          <span className="booking-time-start">{booking.start_time}</span>
                          <span className="booking-separator">-</span>
                          <span className="booking-time-end">{booking.end_time}</span>
                        </div>
                        <div className="booking-info">
                          <h6 className="booking-title">{booking.title}</h6>
                          {booking.description && (
                            <p className="booking-description">{booking.description}</p>
                          )}
                          <span className="booking-organizer">👤 {booking.organizer_name}</span>
                        </div>
                        {/* Кнопки действий показываем только если пользователь имеет право на бронирование И является организатором ИЛИ админ */}
                        {(canBookMeetingRoom || currentUser?.username === 'Root' || currentUser?.is_admin === 1) && (
                          booking.organizer_id === currentUser?.id || isAdmin) && (
                          <div className="booking-actions">
                            <button
                              className="booking-action-btn edit"
                              onClick={() => onEditBooking(booking)}
                              title="Редактировать"
                            >
                              ✏️
                            </button>
                            <button
                              className="booking-action-btn delete"
                              onClick={() => onDeleteBooking(booking.id)}
                              title="Удалить"
                            >
                              🗑️
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="no-bookings-text">На этот день нет бронирований</p>
                );
              })()}
            </div>
                )}
              </div>
            </div>
          </div>
        </main>
      )}

      {/* Модальное окно создания/редактирования задачи */}
      {showTaskModal && (
        <div className="modal-overlay" onClick={() => setShowTaskModal(false)}>
          <div className="modal-content task-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingTask ? 'Редактировать задачу' : 'Новая задача'}</h3>
              <button onClick={() => setShowTaskModal(false)}>✕</button>
            </div>

            <form onSubmit={editingTask ? onUpdateTask : onCreateTask}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Название *</label>
                  <input
                    type="text"
                    value={taskForm.title}
                    onChange={(e) => setTaskForm(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Введите название задачи"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Дата *</label>
                  <input
                    type="date"
                    value={taskForm.taskDate}
                    onChange={(e) => setTaskForm(prev => ({ ...prev, taskDate: e.target.value }))}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Время начала</label>
                  <input
                    type="time"
                    value={taskForm.taskTime}
                    onChange={(e) => setTaskForm(prev => ({ ...prev, taskTime: e.target.value }))}
                  />
                </div>

                <div className="form-group">
                  <label>Время окончания</label>
                  <input
                    type="time"
                    value={taskForm.taskEndTime}
                    onChange={(e) => setTaskForm(prev => ({ ...prev, taskEndTime: e.target.value }))}
                  />
                </div>

                <div className="form-group">
                  <label>Цвет</label>
                  <div className="color-picker">
                    {['#667eea', '#28a745', '#dc3545', '#ffc107', '#17a2b8', '#e83e8c'].map(color => (
                      <button
                        key={color}
                        type="button"
                        className={`color-option ${taskForm.color === color ? 'active' : ''}`}
                        style={{ backgroundColor: color }}
                        onClick={() => setTaskForm(prev => ({ ...prev, color }))}
                      />
                    ))}
                  </div>
                </div>

                <div className="form-group">
                  <label>Описание</label>
                  <textarea
                    value={taskForm.description}
                    onChange={(e) => setTaskForm(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Введите описание задачи"
                    rows={4}
                  />
                </div>
              </div>

              <div className="modal-footer">
                {editingTask && (
                  <button
                    type="button"
                    className="delete-btn"
                    onClick={() => onDeleteTask(editingTask.id)}
                  >
                    Удалить
                  </button>
                )}
                <button type="button" className="cancel-btn" onClick={() => setShowTaskModal(false)}>
                  Отмена
                </button>
                <button type="submit" className="create-btn">
                  {editingTask ? 'Сохранить' : 'Создать'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Модальное окно бронирования переговорной */}
      {showMeetingModal && (
        <div className="modal-overlay" onClick={() => setShowMeetingModal(false)}>
          <div className="modal-content task-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🏢 Забронировать переговорную</h3>
              <button onClick={() => setShowMeetingModal(false)}>✕</button>
            </div>

            <form onSubmit={onBookingMeetingRoom}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Тема встречи *</label>
                  <input
                    type="text"
                    value={meetingForm.title}
                    onChange={(e) => setMeetingForm({...meetingForm, title: e.target.value})}
                    required
                    placeholder="Например: Планерка команды"
                  />
                </div>

                <div className="form-group">
                  <label>Описание</label>
                  <textarea
                    value={meetingForm.description}
                    onChange={(e) => setMeetingForm({...meetingForm, description: e.target.value})}
                    placeholder="Детали встречи..."
                    rows="3"
                  />
                </div>

                <div className="form-group">
                  <label>Дата *</label>
                  <input
                    type="date"
                    value={meetingForm.meetingDate}
                    onChange={(e) => setMeetingForm({...meetingForm, meetingDate: e.target.value})}
                    min={new Date().toISOString().split('T')[0]}
                    required
                  />
                </div>

                <div className="form-group" style={{display: 'flex', gap: '12px'}}>
                  <div style={{flex: 1}}>
                    <label>Начало *</label>
                    <input
                      type="time"
                      value={meetingForm.startTime}
                      onChange={(e) => setMeetingForm({...meetingForm, startTime: e.target.value})}
                      required
                    />
                  </div>
                  <div style={{flex: 1}}>
                    <label>Конец *</label>
                    <input
                      type="time"
                      value={meetingForm.endTime}
                      onChange={(e) => setMeetingForm({...meetingForm, endTime: e.target.value})}
                      min={meetingForm.startTime}
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Организатор</label>
                  <input
                    type="text"
                    value={meetingForm.organizer || currentUser?.username || ''}
                    onChange={(e) => setMeetingForm({...meetingForm, organizer: e.target.value})}
                    disabled
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="cancel-btn"
                  onClick={() => setShowMeetingModal(false)}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="create-btn"
                  disabled={!meetingForm.title || !meetingForm.meetingDate || !meetingForm.startTime || !meetingForm.endTime}
                >
                  Забронировать
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Модальное окно редактирования бронирования */}
      {showEditMeetingModal && (
        <div className="modal-overlay" onClick={() => { setShowEditMeetingModal(false); setEditingBooking(null); }}>
          <div className="modal-content task-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>✏️ Редактировать бронирование</h3>
              <button onClick={() => { setShowEditMeetingModal(false); setEditingBooking(null); }}>✕</button>
            </div>

            <form onSubmit={onUpdateBooking}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Тема встречи *</label>
                  <input
                    type="text"
                    value={meetingForm.title}
                    onChange={(e) => setMeetingForm({...meetingForm, title: e.target.value})}
                    required
                    placeholder="Например: Планерка команды"
                  />
                </div>

                <div className="form-group">
                  <label>Описание</label>
                  <textarea
                    value={meetingForm.description}
                    onChange={(e) => setMeetingForm({...meetingForm, description: e.target.value})}
                    placeholder="Детали встречи..."
                    rows="3"
                  />
                </div>

                <div className="form-group">
                  <label>Дата *</label>
                  <input
                    type="date"
                    value={meetingForm.meetingDate}
                    onChange={(e) => setMeetingForm({...meetingForm, meetingDate: e.target.value})}
                    min={new Date().toISOString().split('T')[0]}
                    required
                  />
                </div>

                <div className="form-group" style={{display: 'flex', gap: '12px'}}>
                  <div style={{flex: 1}}>
                    <label>Начало *</label>
                    <input
                      type="time"
                      value={meetingForm.startTime}
                      onChange={(e) => setMeetingForm({...meetingForm, startTime: e.target.value})}
                      required
                    />
                  </div>
                  <div style={{flex: 1}}>
                    <label>Конец *</label>
                    <input
                      type="time"
                      value={meetingForm.endTime}
                      onChange={(e) => setMeetingForm({...meetingForm, endTime: e.target.value})}
                      min={meetingForm.startTime}
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Организатор</label>
                  <input
                    type="text"
                    value={meetingForm.organizer}
                    disabled
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="cancel-btn"
                  onClick={() => { setShowEditMeetingModal(false); setEditingBooking(null); }}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="create-btn"
                  disabled={!meetingForm.title || !meetingForm.meetingDate || !meetingForm.startTime || !meetingForm.endTime}
                >
                  Сохранить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Модальное окно обмена задачами */}
      {showShareTaskModal && taskToShare && (
        <div className="modal-overlay" onClick={() => setShowShareTaskModal(false)}>
          <div className="modal-content share-task-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📤 Поделиться задачей</h3>
              <button onClick={() => setShowShareTaskModal(false)}>✕</button>
            </div>

            <div className="modal-body">
              <div className="share-task-preview">
                <div className="share-task-title">{taskToShare.title}</div>
                {taskToShare.description && (
                  <div className="share-task-description">{taskToShare.description}</div>
                )}
                <div className="share-task-date">
                  📅 {new Date(taskToShare.task_date).toLocaleDateString('ru-RU')}
                  {taskToShare.task_time && ` ⏰ ${taskToShare.task_time}`}
                </div>
              </div>

              <p className="share-select-title">Выберите пользователей:</p>
              <div className="share-users-list">
                {availableUsers.map(user => (
                  <div
                    key={user.id}
                    className={`share-user-item ${selectedUsersForShare.find(id => id === user.id) ? 'selected' : ''}`}
                    onClick={() => onToggleUserForShare(user.id)}
                  >
                    <img src={user.avatar} alt={user.username} className="share-user-avatar" />
                    <span className="share-user-name">{user.username}</span>
                    {selectedUsersForShare.find(id => id === user.id) && (
                      <span className="share-checkmark">✓</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowShareTaskModal(false)}>
                Отмена
              </button>
              <button
                className="create-btn"
                onClick={onConfirmShareTask}
                disabled={selectedUsersForShare.length === 0}
              >
                Отправить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно полученных задач */}
      {showSharedTasksModal && (
        <div className="modal-overlay" onClick={() => setShowSharedTasksModal(false)}>
          <div className="modal-content shared-tasks-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📥 Полученные задачи</h3>
              <button onClick={() => setShowSharedTasksModal(false)}>✕</button>
            </div>

            <div className="modal-body">
              <button className="refresh-tasks-btn" onClick={onFetchSharedTasksReceived}>
                🔄 Обновить
              </button>
              <div className="shared-tasks-list">
                {sharedTasksReceived.length === 0 ? (
                  <p className="no-shared-tasks">Нет полученных задач</p>
                ) : (
                  sharedTasksReceived.map(share => (
                    <div
                      key={share.id}
                      className={`shared-task-item ${share.status !== 'pending' ? 'disabled' : ''}`}
                    >
                      <div className="shared-task-header">
                        <img src={share.from_avatar} alt={share.from_username} className="shared-task-avatar" />
                        <div className="shared-task-info">
                          <span className="shared-task-from">От: {share.from_username}</span>
                          <span className="shared-task-title">{share.task.title}</span>
                        </div>
                      </div>
                      {share.task.description && (
                        <div className="shared-task-description">{share.task.description}</div>
                      )}
                      <div className="shared-task-date">
                        📅 {new Date(share.task.task_date).toLocaleDateString('ru-RU')}
                        {share.task.task_time && ` ⏰ ${share.task.task_time}`}
                      </div>
                      {share.status === 'pending' ? (
                        <div className="shared-task-actions">
                          <button className="accept-task-btn" onClick={() => onAcceptSharedTask(share.id)}>
                            ✓ Принять
                          </button>
                          <button className="decline-task-btn" onClick={() => onDeclineSharedTask(share.id)}>
                            ✕ Отклонить
                          </button>
                        </div>
                      ) : (
                        <div className={`shared-task-status ${share.status}`}>
                          {share.status === 'accepted' ? '✓ Принято' : '✕ Отклонено'}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button className="create-btn" onClick={() => setShowSharedTasksModal(false)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default CalendarTasks;
