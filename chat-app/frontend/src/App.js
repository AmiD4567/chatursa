import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import EmojiInlinePicker from './EmojiInlinePicker';
import LinkPreviewCard from './LinkPreviewCard';
import { SAFE_EMOJIS } from './safe-emojis';
import { splitTextByUrls, detectUrls } from './urlUtils';
import { useReactionParticles } from './ReactionParticlesManager';
import emojiData from './emojiData.json';
import { saveMessages, getMessages, saveChats, getChats, queueOutgoing, getOutbox, removeFromOutbox } from './db';
import { initE2EEForUser, ensureSharedKey, encryptMessage, decryptMessage, getCachedSharedKey, setE2EEApiBase, getCachedGroupKey, cacheGroupKey, decryptGroupKey, generateGroupKey, encryptGroupKeyForMember, getPeerPublicKey } from './crypto';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import DisconnectedOverlay from './DisconnectedOverlay';
import InAppNotification from './InAppNotification';

const SOCKET_URL = 'http://192.168.210.48:3001';
const STORAGE_KEY = 'chat_user_data';

// CSRF токен для защиты от межсайтовой подделки запросов
let csrfToken = '';

async function fetchCsrfToken() {
  try {
    const res = await fetch(`${SOCKET_URL}/api/csrf-token`);
    if (res.ok) {
      const data = await res.json();
      csrfToken = data.csrfToken;
      return csrfToken;
    }
  } catch (e) {
    console.warn('Не удалось получить CSRF-токен:', e.message);
  }
  return null;
}
fetchCsrfToken();

function addCsrfHeader(init) {
  if (init.headers instanceof Headers) {
    if (!init.headers.has('X-CSRF-Token')) {
      init.headers.set('X-CSRF-Token', csrfToken);
    }
  } else if (Array.isArray(init.headers)) {
    init.headers.push(['X-CSRF-Token', csrfToken]);
  } else {
    init.headers = { ...(init.headers || {}), 'X-CSRF-Token': csrfToken };
  }
  return init;
}

// Автоматически добавляем CSRF-токен во все мутирующие fetch-запросы
const originalFetch = window.fetch;
window.fetch = function(input, init = {}) {
  const method = (init.method || 'GET').toUpperCase();
  const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  if (isMutating && csrfToken) {
    init = addCsrfHeader(init);
  }

  return originalFetch.call(window, input, init).then(async (res) => {
    if (res.status === 403 && isMutating) {
      const newToken = await fetchCsrfToken();
      if (newToken) {
        const retryInit = addCsrfHeader({ ...init });
        return originalFetch.call(window, input, retryInit);
      }
    }
    return res;
  });
};

const SELF_DESTRUCT_OPTIONS = [
  { label: '5 секунд', value: 5000 },
  { label: '30 секунд', value: 30000 },
  { label: '1 минута', value: 60000 },
  { label: '5 минут', value: 300000 },
  { label: '1 час', value: 3600000 },
  { label: '24 часа', value: 86400000 }
];

function getTimerLabel(ms) {
  const opt = SELF_DESTRUCT_OPTIONS.find(o => o.value === ms);
  return opt ? opt.label : '';
}

function formatTimeRemaining(expiresAt) {
  const remaining = new Date(expiresAt).getTime() - Date.now();
  if (remaining <= 0) return '0 сек';
  const secs = Math.floor(remaining / 1000);
  if (secs < 60) return `${secs} сек`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} мин`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч`;
  const days = Math.floor(hours / 24);
  return `${days} д`;
}

// Форматирование времени последнего визита
function getLastSeenText(lastSeen) {
  if (!lastSeen) return 'Офлайн';
  const now = Date.now();
  const diff = now - new Date(lastSeen).getTime();
  if (diff < 0) return 'Офлайн';
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'только что';
  const mins = Math.floor(secs / 60);
  if (mins < 5) return `${mins} мин. назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч. назад`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} д. назад`;
  return new Date(lastSeen).toLocaleDateString('ru-RU');
}

// Получить или создать идентификатор устройства (persistent в localStorage)
function getDeviceId() {
  let deviceId = localStorage.getItem('chat_device_id');
  if (!deviceId) {
    deviceId = 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('chat_device_id', deviceId);
  }
  return deviceId;
}

// Получить название устройства (браузер/платформа)
function getDeviceName() {
  const ua = navigator.userAgent || '';
  if (ua.includes('Electron')) return 'Desktop App';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
  if (ua.includes('Windows')) return 'Windows Browser';
  if (ua.includes('Mac')) return 'macOS Browser';
  if (ua.includes('Linux')) return 'Linux Browser';
  return 'Web Browser';
}

// Компонент управления устройствами (multi-device)
function DevicesSettings({ currentUser, SOCKET_URL, getDeviceId, getDeviceName }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!currentUser?.id) return;
    setLoading(true);
    fetch(`${SOCKET_URL}/api/sessions/${currentUser.id}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => { setSessions(data.sessions || []); setLoading(false); })
      .catch(() => { setError('Не удалось загрузить сессии'); setLoading(false); });
  }, [currentUser]);

  const handleLogout = async (sessionId) => {
    if (!confirm('Завершить эту сессию?')) return;
    try {
      const res = await fetch(`${SOCKET_URL}/api/sessions/${sessionId}?userId=${currentUser.id}`, { method: 'DELETE' });
      if (res.ok) {
        setSessions(prev => prev.filter(s => s.id !== sessionId));
      }
    } catch (err) {
      console.error('Ошибка завершения сессии:', err);
    }
  };

  return (
    <div className="settings-tab-content">
      <div className="setting-section">
        <h3>📱 Активные устройства</h3>
        <p className="setting-description">Устройства, с которых выполнен вход. Текущее устройство помечено 🖥️.</p>
        {loading && <p>⏳ Загрузка...</p>}
        {error && <p className="error-text">{error}</p>}
        {!loading && sessions.length === 0 && !error && <p>Нет активных сессий.</p>}
        {sessions.map(session => (
          <div key={session.id} className={`setting-item session-item ${session.is_current ? 'current-session' : ''}`}>
            <div className="setting-info">
              <span className="setting-icon">{session.is_current ? '🖥️' : '📱'}</span>
              <div>
                <div className="setting-title">
                  {session.device_name || 'Неизвестное устройство'}
                  {session.is_current ? <span className="current-badge"> (текущее)</span> : ''}
                </div>
                <div className="setting-description">
                  IP: {session.ip_address || 'N/A'} · Сокетов: {session.socket_count} · {session.login_time ? new Date(session.login_time).toLocaleString() : ''}
                </div>
              </div>
            </div>
            {!session.is_current && (
              <button className="btn-danger-small" onClick={() => handleLogout(session.id)}>Завершить</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Извлекает UUID/имя файла из URL для маршрута /api/download/:uuid
function extractFileUuidFromUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    // Берём последний сегмент пути (UUID + расширение)
    return u.pathname.split('/').filter(Boolean).pop() || '';
  } catch {
    // Fallback: если URL относительный или невалидный
    const parts = url.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  }
}

// Быстрые реакции из emojiData (категория "Реакции")
const QUICK_REACTIONS = emojiData['Реакции']?.emojis.map(e => e.emoji) || ['👍', '❤️', '😂'];

function App() {
  const [socket, setSocket] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('connecting'); // 'connecting', 'connected', 'disconnected', 'reconnecting'
  const [lastUser, setLastUser] = useState(null); // Данные последнего пользователя для быстрого входа
  const [showLoginForm, setShowLoginForm] = useState(false); // Показывать форму входа
  const [showAuthForm, setShowAuthForm] = useState(false); // Свернуто/развернуто форма входа/регистрации
  const [appVersion, setAppVersion] = useState('1.0.8');
  const [updateStatus, setUpdateStatus] = useState(null); // null | 'checking' | 'idle' | 'downloading' | 'ready' | 'installing' | 'no-update' | 'error'
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateErrorMessage, setUpdateErrorMessage] = useState('');
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);
  // Electron update info (версия + нуты)
  const [electronUpdateInfo, setElectronUpdateInfo] = useState(null); // { version, releaseNotes }
  // Browser (GitHub API) update info
  const [browserUpdateInfo, setBrowserUpdateInfo] = useState(null); // { latestVersion, currentVersion, releaseUrl }

  // Формы авторизации
  const [authMode, setAuthMode] = useState('login'); // 'login' или 'register'
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [birthDate, setBirthDate] = useState('');
  const [rememberMe, setRememberMe] = useState(false); // Запомнить меня
  const [authError, setAuthError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // In-app уведомления (Telegram-стиль)
  const [inAppNotifications, setInAppNotifications] = useState([]);
  const inAppNotificationIdRef = useRef(0);

  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [botTypingChatId, setBotTypingChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);

  // Видимость приложения (для корректного подсчёта непрочитанных)
  const [isAppVisible, setIsAppVisible] = useState(true);
  const isAppVisibleRef = useRef(true);

  const [inputText, setInputText] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [typingUsers, setTypingUsers] = useState({}); // { userId: { username, timeout } }
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [selfDestructTimer, setSelfDestructTimer] = useState(null); // null | 5000 | 30000 | 60000 | 3600000
  const [showTimerPicker, setShowTimerPicker] = useState(false);
  const [emojiPickerPinned, setEmojiPickerPinned] = useState(false);
  const openEmojiTimerRef = useRef(null);
  const closeEmojiTimerRef = useRef(null);
  const [showUsersList, setShowUsersList] = useState(false);
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1600);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState('');

  // Контекстное меню сообщений
  const [contextMenu, setContextMenu] = useState({
    visible: false,
    x: 0,
    y: 0,
    messageId: null,
    messageText: '',
    messageChatId: null,
    messageSenderId: null,
    reactionsExpanded: false,
  });

  // Контекстное меню поля ввода
  const [inputContextMenu, setInputContextMenu] = useState({
    visible: false,
    x: 0,
    y: 0
  });

  // Реакции на сообщения
  const [messageReactions, setMessageReactions] = useState({});

  // E2EE состояние
  const [e2eeEnabled, setE2eeEnabled] = useState({}); // { chatId: true/false }
  const myKeyPairRef = useRef(null);

  // Ref-карта бейджей реакций для получения DOM-позиций
  const reactionBadgeRefs = useRef({});

  // Модальное окно пересылки
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardSearchQuery, setForwardSearchQuery] = useState('');
  const [selectedForwardUser, setSelectedForwardUser] = useState(null);

  // Модальное окно отправки статьи из базы знаний
  const [showWikiShareModal, setShowWikiShareModal] = useState(false);
  const [wikiShareSearchQuery, setWikiShareSearchQuery] = useState('');
  const [selectedWikiShareUser, setSelectedWikiShareUser] = useState(null);
  const [wikiShareArticle, setWikiShareArticle] = useState(null);

  // Модальное окно редактирования сообщения (оставляем для совместимости)
  const [showEditModal, setShowEditModal] = useState(false);
  const [editMessageText, setEditMessageText] = useState('');
  const [editMessageId, setEditMessageId] = useState(null);

  // Inline-режим редактирования сообщения (ID редактируемого сообщения)
  const [editingMessage, setEditingMessage] = useState(null);

  // Индикатор режима редактирования
  const [isEditMode, setIsEditMode] = useState(false);

  // Inline-ответ на сообщение (reply)
  const [replyToMessage, setReplyToMessage] = useState(null);

  const [profileData, setProfileData] = useState({
    username: '',
    birthDate: '',
    about: '',
    avatar: '',
    mobilePhone: '',
    workPhone: '',
    statusText: ''
  });
  const [isSaving, setIsSaving] = useState(false);
  const [previewAvatar, setPreviewAvatar] = useState(null);
  const [newChatType, setNewChatType] = useState('direct');
  const [newChatName, setNewChatName] = useState('');
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [viewingUserProfile, setViewingUserProfile] = useState(null);
  const [viewUserProfileData, setViewUserProfileData] = useState(null);
  const [showPhonebook, setShowPhonebook] = useState(false);
  const [phonebookSearchQuery, setPhonebookSearchQuery] = useState('');
  const [phonebookViewMode, setPhonebookViewMode] = useState('grid'); // 'grid' или 'list'
  const [phonebookSortMode, setPhonebookSortMode] = useState('name'); // 'name' или 'none'
  const [showCalendar, setShowCalendar] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [calendarTasks, setCalendarTasks] = useState([]);
  const [calendarView, setCalendarView] = useState('tasks'); // 'tasks' или 'meeting-room'
  const [meetingRoomBookings, setMeetingRoomBookings] = useState([]);
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [showEditMeetingModal, setShowEditMeetingModal] = useState(false);
  const [modalKey, setModalKey] = useState(0);
  const [editingBooking, setEditingBooking] = useState(null);
  const [meetingForm, setMeetingForm] = useState({
    title: '',
    description: '',
    meetingDate: '',
    startTime: '',
    endTime: '',
    organizer: '',
    reminderMinutes: '15'
  });
  const [canBookMeetingRoom, setCanBookMeetingRoom] = useState(false); // Право на бронирование
  const [canEditWiki, setCanEditWiki] = useState(false); // Право на редактирование wiki
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [taskForm, setTaskForm] = useState({
    title: '',
    description: '',
    taskDate: '',
    taskTime: '',
    taskEndTime: '',
    color: '#667eea'
  });
  const [selectedDayTasks, setSelectedDayTasks] = useState([]);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [showMediaViewer, setShowMediaViewer] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [messageToDelete, setMessageToDelete] = useState(null);
  const [chatMenuPosition, setChatMenuPosition] = useState({ top: 0, right: 0 });
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef(null);
  const [showImagePreview, setShowImagePreview] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [readMessages, setReadMessages] = useState({}); // { messageId: [userIds] }
  // Глобальный Map: chatId -> Set(readerUserIds) для стабильных двойных галочек
  const readByChatRef = useRef(new Map());
  // Версия статуса прочтения — триггерит ре-рендер при получении messages_read
  const [readStatusVersion, setReadStatusVersion] = useState(0);
  const [readByPopup, setReadByPopup] = useState(null); // { messageId, readers: [{username, avatar}], x, y }

  // Закрытие readByPopup по Escape
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') setReadByPopup(null);
    };
    if (readByPopup) {
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }
  }, [readByPopup]);
  const [showManageParticipants, setShowManageParticipants] = useState(false);
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [participantSearch, setParticipantSearch] = useState('');
  const [statusEmoji, setStatusEmoji] = useState('');
  const [statusDescription, setStatusDescription] = useState('');
  const [showStatusEmojiPicker, setShowStatusEmojiPicker] = useState(false);
  const [messageDrafts, setMessageDrafts] = useState({}); // { chatId: text }
  const [prevChatId, setPrevChatId] = useState(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [messageMenuPosition, setMessageMenuPosition] = useState({ top: 0, left: 0 });
  const [showMessageMenu, setShowMessageMenu] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [showSearchMessages, setShowSearchMessages] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [chatSearchActive, setChatSearchActive] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [chatSearchResults, setChatSearchResults] = useState([]);
  const [chatSearchIndex, setChatSearchIndex] = useState(-1);
  const [userSearchResults, setUserSearchResults] = useState([]);
  const [mentionPopup, setMentionPopup] = useState({ show: false, filter: '', x: 0, y: 0 });
  const [showShareTaskModal, setShowShareTaskModal] = useState(false);
  const [taskToShare, setTaskToShare] = useState(null);
  const [availableUsers, setAvailableUsers] = useState([]);
  const [selectedUsersForShare, setSelectedUsersForShare] = useState([]);
  const [selectedMeetingParticipants, setSelectedMeetingParticipants] = useState([]);
  const [participantSearchText, setParticipantSearchText] = useState('');
  const [showParticipantModal, setShowParticipantModal] = useState(false);
  const [draftParticipants, setDraftParticipants] = useState([]);
  const [sharedTasksReceived, setSharedTasksReceived] = useState([]);
  const [showSharedTasksModal, setShowSharedTasksModal] = useState(false);
  const [showDocuments, setShowDocuments] = useState(false);
  const [chatDocuments, setChatDocuments] = useState([]);
  const [birthdaysToday, setBirthdaysToday] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [upcomingNotifications, setUpcomingNotifications] = useState({ birthdays: [], tasks: [], sharedTasks: [] });
  const [notificationTimeFilter, setNotificationTimeFilter] = useState('week'); // 'today', '3days', 'week'
  const [disappearingTasks, setDisappearingTasks] = useState([]); // Задачи с анимацией исчезновения
  const [expandedSections, setExpandedSections] = useState({ birthdays: true, tasks: true, sharedTasks: true });
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0); // Количество непрочитанных уведомлений
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [showPollModal, setShowPollModal] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pollIsAnonymous, setPollIsAnonymous] = useState(false);
  const [pollAllowsMultiple, setPollAllowsMultiple] = useState(false);
  const [pollClosesAt, setPollClosesAt] = useState('');
  const [pollHideResults, setPollHideResults] = useState(false);
  const [pollLoading, setPollLoading] = useState(false);
  const [showAnnouncements, setShowAnnouncements] = useState(false);
  const [wikiCategories, setWikiCategories] = useState([]);
  const [wikiArticles, setWikiArticles] = useState([]);
  const [wikiActiveCategory, setWikiActiveCategory] = useState(null);
  const [wikiActiveArticle, setWikiActiveArticle] = useState(null);
  const [wikiEditMode, setWikiEditMode] = useState(false);
  const [wikiEditTitle, setWikiEditTitle] = useState('');
  const [wikiEditContent, setWikiEditContent] = useState('');
  const [wikiEditCategory, setWikiEditCategory] = useState('');
  const [showWikiCategoryModal, setShowWikiCategoryModal] = useState(false);
  const [wikiEditingCategory, setWikiEditingCategory] = useState(null);
  const [wikiCategoryName, setWikiCategoryName] = useState('');
  const [wikiCategoryDesc, setWikiCategoryDesc] = useState('');
  const [wikiFileUploading, setWikiFileUploading] = useState(false);
  const [wikiFiles, setWikiFiles] = useState([]);
  const [wikiSearch, setWikiSearch] = useState('');
  const [wikiAccessLevel, setWikiAccessLevel] = useState('public');
  const [wikiAllowedUsers, setWikiAllowedUsers] = useState([]);
  const [wikiAccessSearch, setWikiAccessSearch] = useState('');
  const [wikiExpandedCategories, setWikiExpandedCategories] = useState(new Set());
  const [wikiCategoryParent, setWikiCategoryParent] = useState('');
  const [wikiCategoryEditorIds, setWikiCategoryEditorIds] = useState([]);
  const [wikiCategoryEditorSearch, setWikiCategoryEditorSearch] = useState('');
  const [showHR, setShowHR] = useState(false);
  const [hrRequests, setHrRequests] = useState([]);
  const [showHRCreate, setShowHRCreate] = useState(false);
  const [hrForm, setHrForm] = useState({ type: 'vacation', startDate: '', endDate: '', reason: '' });
  const [hrLoading, setHrLoading] = useState(false);
  const [hrViewMode, setHrViewMode] = useState('my'); // 'my' or 'pending'
  const [announcements, setAnnouncements] = useState([]);
  const [showCreateAnnouncement, setShowCreateAnnouncement] = useState(false);
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementContent, setAnnouncementContent] = useState('');
  const [announcementPriority, setAnnouncementPriority] = useState('normal');
  const [announcementLoading, setAnnouncementLoading] = useState(false);
  const [unreadAnnouncements, setUnreadAnnouncements] = useState(0);
  const [notificationSettings, setNotificationSettings] = useState({
    newMessages: true,
    birthdays: true,
    sound: true,
    botAssistant: true,        // Уведомления от помощника
    tasks: true,               // Уведомления о задачах
    meetingRoom: true          // Уведомления о бронировании переговорной
  });
  const notificationSettingsRef = useRef(notificationSettings);

  // Обновляем ref при изменении настроек
  useEffect(() => {
    notificationSettingsRef.current = notificationSettings;
  }, [notificationSettings]);
  
  // Переключение секций уведомлений
  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };
  
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState('default');
  const [showNotificationBanner, setShowNotificationBanner] = useState(false);
  const [activeView, setActiveView] = useState('chats'); // 'chats', 'phonebook', 'calendar', 'admin', 'settings'
  const [showChatList, setShowChatList] = useState(true); // На мобильных: true = список чатов, false = активный чат
  const [activeSettingsTab, setActiveSettingsTab] = useState('appearance'); // 'appearance', 'notifications', 'devices', 'about'
  const [userUiSettings, setUserUiSettings] = useState({
    themeColor: '#667eea',
    themeGradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    textSizeLevel: 1, // -1 = мин., 0 = мал., 1 = ср., 2 = бол.
    chatBackground: 0  // индекс фона чата (0 = нет)
  });

  // Тема (тёмная/светлая)
  const [appTheme, setAppTheme] = useState(() => {
    const saved = localStorage.getItem('chat_app_theme');
    return saved || 'light';
  });

  // 20 фонов чата (dark/light)
  const chatBackgrounds = [
    { id: 0, name: 'Нет', dark: 'none', light: 'none' },
    { id: 1, name: 'Закат', dark: 'linear-gradient(135deg, #1a0a00 0%, #3d1a00 50%, #1a0a00 100%)', light: 'linear-gradient(135deg, #fff5eb 0%, #ffe0b2 50%, #fff5eb 100%)' },
    { id: 2, name: 'Океан', dark: 'linear-gradient(135deg, #001220 0%, #003355 50%, #001220 100%)', light: 'linear-gradient(135deg, #e3f2fd 0%, #bbdefb 50%, #e3f2fd 100%)' },
    { id: 3, name: 'Лес', dark: 'linear-gradient(135deg, #001a00 0%, #003d00 50%, #001a00 100%)', light: 'linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 50%, #e8f5e9 100%)' },
    { id: 4, name: 'Лаванда', dark: 'linear-gradient(135deg, #1a0033 0%, #4a0072 50%, #1a0033 100%)', light: 'linear-gradient(135deg, #f3e5f5 0%, #e1bee7 50%, #f3e5f5 100%)' },
    { id: 5, name: 'Неон', dark: 'linear-gradient(135deg, #0a0020 0%, #2a0050 50%, #0a0020 100%)', light: 'linear-gradient(135deg, #e8eaf6 0%, #c5cae9 50%, #e8eaf6 100%)' },
    { id: 6, name: 'Песок', dark: 'linear-gradient(135deg, #1a1400 0%, #3d3000 50%, #1a1400 100%)', light: 'linear-gradient(135deg, #fff8e1 0%, #ffecb3 50%, #fff8e1 100%)' },
    { id: 7, name: 'Вишня', dark: 'linear-gradient(135deg, #1a0005 0%, #4d0010 50%, #1a0005 100%)', light: 'linear-gradient(135deg, #fce4ec 0%, #f8bbd0 50%, #fce4ec 100%)' },
    { id: 8, name: 'Мятный', dark: 'linear-gradient(135deg, #001a14 0%, #003d30 50%, #001a14 100%)', light: 'linear-gradient(135deg, #e0f2f1 0%, #b2dfdb 50%, #e0f2f1 100%)' },
    { id: 9, name: 'Космос', dark: 'linear-gradient(135deg, #000018 0%, #00003d 50%, #000018 100%)', light: 'linear-gradient(135deg, #e3e8f5 0%, #c0c8e8 50%, #e3e8f5 100%)' },
    { id: 10, name: 'Осень', dark: 'linear-gradient(135deg, #1a0a00 0%, #4a2000 50%, #1a0a00 100%)', light: 'linear-gradient(135deg, #fff3e0 0%, #ffe0b2 50%, #fff3e0 100%)' },
    { id: 11, name: 'Арктика', dark: 'linear-gradient(135deg, #000d1a 0%, #002040 50%, #000d1a 100%)', light: 'linear-gradient(135deg, #e0f7fa 0%, #b2ebf2 50%, #e0f7fa 100%)' },
    { id: 12, name: 'Тропики', dark: 'linear-gradient(135deg, #001a10 0%, #003d28 50%, #001a10 100%)', light: 'linear-gradient(135deg, #e0f2e0 0%, #b2dfb2 50%, #e0f2e0 100%)' },
    { id: 13, name: 'Фиалка', dark: 'linear-gradient(135deg, #0e001a 0%, #2a004d 50%, #0e001a 100%)', light: 'linear-gradient(135deg, #ede7f6 0%, #d1c4e9 50%, #ede7f6 100%)' },
    { id: 14, name: 'Янтарь', dark: 'linear-gradient(135deg, #1a1000 0%, #4a2d00 50%, #1a1000 100%)', light: 'linear-gradient(135deg, #fff8e1 0%, #ffe082 50%, #fff8e1 100%)' },
    { id: 15, name: 'Синева', dark: 'linear-gradient(135deg, #000d1a 0%, #003366 50%, #000d1a 100%)', light: 'linear-gradient(135deg, #e3f2fd 0%, #90caf9 50%, #e3f2fd 100%)' },
    { id: 16, name: 'Шоколад', dark: 'linear-gradient(135deg, #140a05 0%, #3d1f0a 50%, #140a05 100%)', light: 'linear-gradient(135deg, #efebe9 0%, #d7ccc8 50%, #efebe9 100%)' },
    { id: 17, name: 'Заря', dark: 'linear-gradient(135deg, #1a0010 0%, #4d0030 50%, #1a0010 100%)', light: 'linear-gradient(135deg, #fce4ec 0%, #f48fb1 50%, #fce4ec 100%)' },
    { id: 18, name: 'Изумруд', dark: 'linear-gradient(135deg, #001a0a 0%, #004d20 50%, #001a0a 100%)', light: 'linear-gradient(135deg, #e0f2e0 0%, #a5d6a7 50%, #e0f2e0 100%)' },
    { id: 19, name: 'Туман', dark: 'linear-gradient(135deg, #0d0d0d 0%, #2d2d2d 50%, #0d0d0d 100%)', light: 'linear-gradient(135deg, #f5f5f5 0%, #e0e0e0 50%, #f5f5f5 100%)' },
    { id: 20, name: 'Пламя', dark: 'linear-gradient(135deg, #1a0500 0%, #4d1500 50%, #1a0500 100%)', light: 'linear-gradient(135deg, #fbe9e7 0%, #ffab91 50%, #fbe9e7 100%)' },
  ];

  // Автозапуск (только Electron)
  const [autoLaunch, setAutoLaunch] = useState(false);

  // Закреплённые сообщения по чатам
  const [pinnedMessages, setPinnedMessages] = useState({}); // { chatId: [messages] }
  const [showPinnedBar, setShowPinnedBar] = useState(false);
  const [pinnedBarCollapsed, setPinnedBarCollapsed] = useState(true);
  const [showPinnedModal, setShowPinnedModal] = useState(false);

  const [isAdmin, setIsAdmin] = useState(false);
  const [adminStats, setAdminStats] = useState(null);
  const [botAnalyticsData, setBotAnalyticsData] = useState(null);
  const [botSettings, setBotSettings] = useState(null);
  const [supportRequests, setSupportRequests] = useState([]);
  const [supportActiveFilter, setSupportActiveFilter] = useState('open');
  const [adminUsers, setAdminUsers] = useState([]);
  const [activeAdminTab, setActiveAdminTab] = useState('dashboard');
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [newUserData, setNewUserData] = useState({
    username: '',
    email: '',
    password: '',
    is_admin: 0
  });
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [hostCounts, setHostCounts] = useState({}); // Подсчёт пользователей по host
  
  // Сброс пароля
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
  const [userToResetPassword, setUserToResetPassword] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  
  // Активные сессии
  const [activeSessions, setActiveSessions] = useState([]);
  const [showSessionsModal, setShowSessionsModal] = useState(false);
  
  // Файловый менеджер
  const [showFileManagerModal, setShowFileManagerModal] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [selectedFileForDelete, setSelectedFileForDelete] = useState(null);
  
  // Аудит безопасности
  const [securityLogs, setSecurityLogs] = useState([]);
  const [showSecurityLogsModal, setShowSecurityLogsModal] = useState(false);
  
  // Настройки интерфейса
  const [uiSettings, setUiSettings] = useState({
    siteName: 'Чат',
    logoUrl: '',
    primaryColor: '#667eea',
    secondaryColor: '#764ba2'
  });
  const [showUiSettingsModal, setShowUiSettingsModal] = useState(false);
  const [isSavingUiSettings, setIsSavingUiSettings] = useState(false);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const notificationPermissionRef = useRef('default');
  const messageInputRef = useRef(null);
  const activeChatIdRef = useRef(null);
  const currentUserRef = useRef(null);
  const lastBirthdayCheckRef = useRef(null);
  const socketRef = useRef(null);
  const loginFormRef = useRef(null);
  const loginTimeoutRef = useRef(null);
  const prevViewRef = useRef(null);

  // Вычисляем активный чат по ID
  const activeChat = chats.find(c => c.id === activeChatId) || null;

  // Получаем правильное имя для чата (для личных чатов - имя собеседника)
  const getChatDisplayName = (chat) => {
    if (!chat) return '';
    // Для чата с помощником возвращаем название из чата
    if (chat.id?.startsWith('bot-chat-')) {
      return chat.name || 'Помощник';
    }
    if (chat.type !== 'direct' || !chat.participantsDetails) {
      return chat.name;
    }
    // Для личного чата находим собеседника (не текущего пользователя)
    const otherUser = chat.participantsDetails.find(p => p.username !== currentUser?.username);
    return otherUser ? otherUser.username : chat.name;
  };

  // Проверка дней рождения сегодня
  const checkBirthdaysToday = () => {
    const today = new Date();
    const todayDay = today.getDate();
    const todayMonth = today.getMonth() + 1; // getMonth() возвращает 0-11
    
    const birthdays = users.filter(user => {
      if (!user.birth_date) return false;
      const birthDate = new Date(user.birth_date);
      return birthDate.getDate() === todayDay && (birthDate.getMonth() + 1) === todayMonth;
    }).map(user => ({
      id: user.id,
      username: user.username,
      avatar: user.avatar
    }));
    
    setBirthdaysToday(birthdays);

    // Показываем уведомление для дней рождения
    if (birthdays.length > 0 && Notification.permission === 'granted' && notificationSettings.birthdays) {
      const names = birthdays.map(b => b.username).join(', ');
      
      // Звук уведомления
      if (notificationSettings.sound) {
        try {
          const audio = new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU');
          audio.play().catch(() => {});
        } catch (e) {}
      }
      
      new Notification('🎂 День рождения!', {
        body: `У ${names} сегодня день рождения!`,
        icon: '/favicon.ico',
        badge: '/favicon.ico'
      });
    }
  };

  // Получение ближайших уведомлений (дни рождения и задачи)
  const getUpcomingNotifications = async (forceRefresh = false, timeFilter = null) => {
    const today = new Date();
    const upcomingBirthdays = [];
    const upcomingTasks = [];
    const sharedTasksNotifications = [];
    
    // Используем переданный фильтр или текущий
    const filter = timeFilter || notificationTimeFilter;
    
    // Определяем максимальное количество дней для фильтра
    const maxDays = filter === 'today' ? 0 : 
                    filter === '3days' ? 3 : 7;

    // Дни рождения - используем актуальный список пользователей
    const currentUsers = users || [];
    currentUsers.forEach(user => {
      if (!user.birth_date) return;
      try {
        const birthDate = new Date(user.birth_date);
        
        // Создаем дату дня рождения в этом году (без времени)
        const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const thisYearBirthday = new Date(today.getFullYear(), birthDate.getMonth(), birthDate.getDate());
        
        // Если день рождения уже прошел в этом году, берем следующий год
        if (thisYearBirthday < todayDateOnly) {
          thisYearBirthday.setFullYear(today.getFullYear() + 1);
        }
        
        // Считаем количество дней (используем даты без времени)
        const daysUntil = Math.ceil((thisYearBirthday - todayDateOnly) / (1000 * 60 * 60 * 24));
        
        if (daysUntil >= 0 && daysUntil <= maxDays) {
          upcomingBirthdays.push({
            id: user.id,
            username: user.username,
            avatar: user.avatar,
            date: thisYearBirthday,
            daysUntil: daysUntil,
            isToday: daysUntil === 0
          });
        }
      } catch (e) {
        console.error('Ошибка обработки дня рождения:', e);
      }
    });

    // Загружаем задачи из API если они еще не загружены или запрошено обновление
    if (calendarTasks.length === 0 || forceRefresh) {
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      await fetchCalendarTasks(startOfMonth, endOfMonth);
    }

    // Задачи с учетом фильтра
    const currentTasks = calendarTasks || [];
    currentTasks.forEach(task => {
      if (!task.task_date) return;
      try {
        const taskDate = new Date(task.task_date);
        const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const taskDateOnly = new Date(taskDate.getFullYear(), taskDate.getMonth(), taskDate.getDate());
        
        const daysUntil = Math.ceil((taskDateOnly - todayDate) / (1000 * 60 * 60 * 24));
        
        if (daysUntil >= 0 && daysUntil <= maxDays) {
          upcomingTasks.push({
            id: task.id,
            title: task.title,
            description: task.description,
            date: taskDate,
            task_date: task.task_date,
            task_time: task.task_time,
            color: task.color,
            daysUntil: daysUntil,
            isToday: daysUntil === 0
          });
        }
      } catch (e) {
        console.error('Ошибка обработки задачи:', e);
      }
    });

    // Загружаем полученные задачи (которыми поделились) только если запрошено обновление или список пуст
    if (forceRefresh || sharedTasksReceived.length === 0) {
      await fetchSharedTasksReceived();
    }
    const currentSharedTasks = sharedTasksReceived || [];
    currentSharedTasks.forEach(share => {
      if (!share.task.task_date) return;
      try {
        const taskDate = new Date(share.task.task_date);
        const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const taskDateOnly = new Date(taskDate.getFullYear(), taskDate.getMonth(), taskDate.getDate());
        
        const daysUntil = Math.ceil((taskDateOnly - todayDate) / (1000 * 60 * 60 * 24));
        
        if (daysUntil >= 0 && daysUntil <= maxDays && share.status === 'pending') {
          sharedTasksNotifications.push({
            id: share.id,
            shareId: share.id,
            title: share.task.title,
            description: share.task.description,
            from_username: share.from_username,
            from_avatar: share.from_avatar,
            task_date: share.task.task_date,
            task_time: share.task.task_time,
            date: taskDate,
            daysUntil: daysUntil,
            isToday: daysUntil === 0
          });
        }
      } catch (e) {
        console.error('Ошибка обработки общей задачи:', e);
      }
    });

    // Сортировка по дате
    upcomingBirthdays.sort((a, b) => a.daysUntil - b.daysUntil);
    upcomingTasks.sort((a, b) => a.daysUntil - b.daysUntil);
    sharedTasksNotifications.sort((a, b) => a.daysUntil - b.daysUntil);

    // Обновляем состояние
    setUpcomingNotifications({
      birthdays: upcomingBirthdays,
      tasks: upcomingTasks,
      sharedTasks: sharedTasksNotifications
    });
    
    // Подсчитываем количество непрочитанных уведомлений (только общие задачи)
    setUnreadNotificationsCount(sharedTasksNotifications.length);
  };

  // Запрос разрешения на уведомления и проверка статуса
  useEffect(() => {
    if ('Notification' in window) {
      // Проверяем текущее состояние разрешения
      const currentPermission = Notification.permission;
      setBrowserNotificationPermission(currentPermission);

      // Показываем баннер, если разрешение не предоставлено и не было отклонено ранее
      const bannerDismissed = localStorage.getItem('notificationBannerDismissed');
      if (currentPermission === 'default' && !bannerDismissed && isLoggedIn) {
        setShowNotificationBanner(true);
      }

      if (currentPermission === 'default') {
        Notification.requestPermission().then(permission => {
          setBrowserNotificationPermission(permission);
          notificationPermissionRef.current = permission;
          console.log('Разрешение на уведомления:', permission);
          if (permission !== 'granted') {
            setShowNotificationBanner(true);
          }
        });
      } else {
        notificationPermissionRef.current = currentPermission;
      }
    }
  }, [isLoggedIn]);

  // Применение настроек оформления при изменении userUiSettings
  useEffect(() => {
    document.documentElement.style.setProperty('--primary-color', userUiSettings.themeColor);
    // Градация размера текста: -1=мин(11px), 0=мал(13px), 1=ср(15px), 2=бол(18px)
    const sizeMap = { '-1': '11px', '0': '13px', '1': '15px', '2': '18px' };
    const emojiSizeMap = { '-1': '16px', '0': '18px', '1': '22px', '2': '28px' };
    const baseSizeMap = { '-1': '11px', '0': '13px', '1': '15px', '2': '18px' };
    const level = userUiSettings.textSizeLevel ?? 1;
    document.documentElement.style.setProperty('--font-size-base', baseSizeMap[level] || '15px');
    document.documentElement.style.setProperty('--message-font-size', sizeMap[level] || '15px');
    document.documentElement.style.setProperty('--message-emoji-size', emojiSizeMap[level] || '22px');
  }, [userUiSettings]);

  // Применение фона чата при изменении настроек или темы
  useEffect(() => {
    const bg = chatBackgrounds.find(b => b.id === (userUiSettings.chatBackground || 0));
    if (bg && bg.id !== 0) {
      const gradient = appTheme === 'light' ? bg.light : bg.dark;
      document.documentElement.style.setProperty('--chat-bg-image', gradient);
    } else {
      document.documentElement.style.setProperty('--chat-bg-image', 'none');
    }
  }, [userUiSettings.chatBackground, appTheme]);

  // Загрузка состояния автозапуска (только Electron)
  useEffect(() => {
    if (window.electronAPI?.getAutoLaunch) {
      window.electronAPI.getAutoLaunch().then(setAutoLaunch);
    }
  }, []);

  // Загрузка настроек при монтировании компонента
  useEffect(() => {
    const savedSettings = localStorage.getItem(`userUiSettings_${currentUser?.id}`);
    if (savedSettings && currentUser) {
      try {
        const parsed = JSON.parse(savedSettings);
        setUserUiSettings(parsed);
      } catch (e) {
        console.error('Ошибка загрузки настроек:', e);
      }
    }
  }, [currentUser]);

  // Автофокус на поле ввода при переключении чата + сохранение черновиков
  useEffect(() => {
    if (activeChatId && messageInputRef.current) {
      // Сохраняем черновик для предыдущего чата
      if (prevChatId && prevChatId !== activeChatId) {
        setMessageDrafts(prev => ({
          ...prev,
          [prevChatId]: inputText
        }));
      }

      // Восстанавливаем черновик для нового чата
      const draft = messageDrafts[activeChatId] || '';
      setInputText(draft);

      // Синхронизируем contentEditable div с восстановленным текстом
      if (messageInputRef.current) {
        messageInputRef.current.innerHTML = draft;
      }

      // Обновляем предыдущий chatId и ref
      setPrevChatId(activeChatId);
      activeChatIdRef.current = activeChatId;

      const timer = setTimeout(() => {
        messageInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [activeChatId]);

  // Сохранение черновика при уходе из вкладки «Чаты» (настройки, календарь и т.д.)
  useEffect(() => {
    const prevView = prevViewRef.current;
    if (prevView === 'chats' && activeView !== 'chats' && activeChatId) {
      // Сохраняем черновик текущего чата перед уходом из вкладки
      setMessageDrafts(prev => ({
        ...prev,
        [activeChatId]: inputText
      }));
    }
  }, [activeView]);

  // Автоскролл к последнему сообщению при каждом обновлении сообщений (без анимации)
  useLayoutEffect(() => {
    if (!messagesEndRef.current || !activeChatId) return;
    const container = messagesEndRef.current.parentElement;
    if (container) {
      container.scrollTop = container.scrollHeight - container.clientHeight;
    }
  }, [messages, activeChatId]);

  // Автоскролл при переходе на вкладку чатов из другой вкладки
  useEffect(() => {
    const prevView = prevViewRef.current;
    if (prevView && prevView !== 'chats' && activeView === 'chats' && activeChatId) {
      // Восстанавливаем черновик текущего чата при возврате на вкладку «Чаты»
      const draft = messageDrafts[activeChatId] || '';
      setInputText(draft);
      if (messageInputRef.current) {
        messageInputRef.current.innerHTML = draft;
      }

      // Небольшая задержка чтобы DOM успел отрендериться после переключения вкладки
      const timer = setTimeout(() => {
        const container = messagesEndRef.current?.parentElement;
        if (container) {
          container.scrollTop = container.scrollHeight - container.clientHeight;
        }
      }, 100);
      return () => clearTimeout(timer);
    }
    prevViewRef.current = activeView;
  }, [activeView, activeChatId]);

  // Закрытие панели смайлов при клике вне
  // Inline picker обрабатывает закрытие по клику вне самостоятельно

  // Отслеживание размера окна для адаптивного поведения и клавиатуры
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
      document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);

      // Сбрасываем мобильный вид при переходе через breakpoint 768px
      if (window.innerWidth > 768) {
        setShowChatList(true);
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize(); // Вызываем сразу при монтировании

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Получение версии приложения
  useEffect(() => {
    const initApp = async () => {
      if (window.electronAPI) {
        try {
          const version = await window.electronAPI.getAppVersion();
          setAppVersion(version);
        } catch (err) {
          console.error('Ошибка получения версии:', err);
        }

        // Подписка на статус видимости приложения
        if (window.electronAPI.onAppVisibility) {
          window.electronAPI.onAppVisibility((visible) => {
            setIsAppVisible(visible);
            isAppVisibleRef.current = visible;
            console.log(`app visibility: ${visible}`);
          });
        }
        if (window.electronAPI.getAppVisibilityStatus) {
          window.electronAPI.getAppVisibilityStatus();
        }
      }
    };

    initApp();
  }, []);

  // ============================================
  // Система автообновлений (Electron + Browser)
  // ============================================

  // Единый источник подписок на события Electron autoUpdater
  useEffect(() => {
    if (!window.electronAPI) return;

    const cleanupChecking = window.electronAPI.onUpdateChecking(() => {
      setUpdateStatus('checking');
    });

    const cleanupAvailable = window.electronAPI.onUpdateAvailable((info) => {
      setElectronUpdateInfo(info);
      setBrowserUpdateInfo(null);
      setUpdateStatus('available');
      // autoDownload = false, пользователь нажмёт «Скачать» вручную
    });

    const cleanupNotAvailable = window.electronAPI.onUpdateNotAvailable(() => {
      setUpdateStatus('no-update');
      setShowUpdateBanner(false);
    });

    const cleanupDownloaded = window.electronAPI.onUpdateDownloaded((info) => {
      setElectronUpdateInfo(info);
      setUpdateStatus('installing'); // Установка начнётся автоматически (main.js вызывает quitAndInstall)
    });

    const cleanupProgress = window.electronAPI.onDownloadProgress((progressObj) => {
      if (progressObj && typeof progressObj.percent === 'number') {
        setUpdateProgress(progressObj.percent);
        setUpdateStatus('downloading');
      }
    });

    const cleanupError = window.electronAPI.onUpdateError((err) => {
      console.error('Ошибка автообновления:', err);
      setUpdateErrorMessage(typeof err === 'string' ? err : err?.message || JSON.stringify(err));
      setUpdateStatus('error');
    });

    const cleanupPostponed = window.electronAPI.onUpdatePostponed(() => {
      setUpdateStatus('idle');
    });

    const cleanupInstallPrepare = window.electronAPI.onInstallPrepare(() => {
      // Бэкенд останавливается, сейчас начнётся установка
      setUpdateStatus('installing');
    });

    return () => {
      cleanupChecking?.();
      cleanupAvailable?.();
      cleanupNotAvailable?.();
      cleanupDownloaded?.();
      cleanupProgress?.();
      cleanupError?.();
      cleanupPostponed?.();
      cleanupInstallPrepare?.();
    };
  }, []);

  // Проверка обновлений (единая функция для Electron и браузера)
  const checkForUpdates = useCallback(async () => {
    setUpdateStatus('checking');
    setUpdateErrorMessage('');
    setShowUpdateBanner(false);
    setUpdateProgress(0);

    if (window.electronAPI?.checkForUpdates) {
      // Electron: используем встроенный autoUpdater
      window.electronAPI.checkForUpdates();
    } else {
      // Браузер: проверяем через GitHub API
      try {
        const res = await fetch('/api/check-update');
        const data = await res.json();
        if (data.hasUpdate) {
          setBrowserUpdateInfo(data);
          setElectronUpdateInfo(null);
          setUpdateStatus('available');
          setShowUpdateBanner(true);
        } else {
          setUpdateStatus('no-update');
        }
      } catch (err) {
        console.error('Ошибка проверки обновлений:', err);
        setUpdateStatus('error');
      }
    }
  }, []);

  // Автоматическая проверка при входе (только для браузера, Electron сам проверяет)
  useEffect(() => {
    const savedData = localStorage.getItem(STORAGE_KEY);
    if (savedData && !window.electronAPI) {
      // Браузер: проверяем через API с задержкой и интервалом
      const timer = setTimeout(() => checkForUpdates(), 5000);
      const interval = setInterval(checkForUpdates, 60 * 60 * 1000);
      return () => {
        clearTimeout(timer);
        clearInterval(interval);
      };
    }
  }, [checkForUpdates]);

  // Скачивание обновления (Electron)
  const startUpdateDownload = useCallback(() => {
    if (!window.electronAPI?.downloadUpdate) return;
    setUpdateStatus('downloading');
    window.electronAPI.downloadUpdate();
  }, []);

  // Установка загруженного обновления и перезапуск (Electron)
  const installUpdate = useCallback(() => {
    if (!window.electronAPI?.quitAndInstall) return;
    setShowUpdateBanner(false);
    window.electronAPI.quitAndInstall();
  }, []);

  // Инициализация сокета
  useEffect(() => {
    const newSocket = io(SOCKET_URL, {
      reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000
    });
    setSocket(newSocket);
    socketRef.current = newSocket;

    console.log('Сокет создан:', newSocket);
    console.log('Сокет подключён:', newSocket.connected);
    console.log('SOCKET_URL:', SOCKET_URL);

    // Таймаут для принудительного показа формы входа
    loginTimeoutRef.current = setTimeout(() => {
      if (!currentUserRef.current) {
        console.log('Таймаут входа: показываем форму');
        setIsLoggedIn(false);
        setCurrentUser(null);
        setConnectionStatus('connecting');
      }
    }, 5000); // 5 секунд на подключение

    newSocket.on('connect', () => {
      console.log('✓ Сокет подключён!');
      if (loginTimeoutRef.current) clearTimeout(loginTimeoutRef.current);
      setConnectionStatus('connected');

      // При каждом подключении (включая переподключение) отправляем user_joined
      const savedData = localStorage.getItem(STORAGE_KEY);
      if (savedData) {
        try {
          const parsed = JSON.parse(savedData);
          console.log('Переподключение: отправляем user_joined:', parsed);
          newSocket.emit('user_joined', {
            userId: parsed.userId,
            username: parsed.username,
            email: parsed.email,
            deviceId: getDeviceId(),
            deviceName: getDeviceName()
          });
        } catch (e) {
          console.error('Ошибка парсинга savedData при переподключении:', e);
        }
      }
    });

    newSocket.on('disconnect', () => {
      console.warn('⚠ Сокет отключён!');
      setConnectionStatus('disconnected');
      // Не сбрасываем isLoggedIn/currentUser — чтобы после переподключения
      // автоматически восстановить сессию без показа экрана входа
    });

    newSocket.on('reconnect', (attemptNumber) => {
      console.log('✓ Сокет переподключён после', attemptNumber, 'попыток');
      setConnectionStatus('connected');

      // Запрашиваем свежий список пользователей
      newSocket.emit('get_users');

      // Присоединяемся к активному чату
      if (activeChatIdRef.current) {
        console.log('Переподключение: присоединяемся к чату', activeChatIdRef.current);
        newSocket.emit('join_chat', activeChatIdRef.current);
      }

      // Отправляем накопленные офлайн-сообщения
      flushOutbox();
    });

    newSocket.on('reconnect_attempt', (attemptNumber) => {
      console.log('Попытка переподключения', attemptNumber);
      setConnectionStatus('reconnecting');
    });

    newSocket.on('reconnect_error', (err) => {
      console.error('Ошибка переподключения:', err.message);
    });

    newSocket.on('reconnect_failed', () => {
      console.error('Не удалось переподключить сокет');
      setConnectionStatus('disconnected');
    });

    newSocket.on('connect_error', (err) => {
      console.error('Ошибка подключения:', err.message);
    });

    // Очищаем старый ключ с паролем (безопасность)
    localStorage.removeItem('chat_credentials');

    // Проверяем сохраненные данные пользователя (для авто-входа)
    const savedData = localStorage.getItem(STORAGE_KEY);
    const savedEmail = localStorage.getItem('chat_credentials_email');
    const savedLastUser = localStorage.getItem('chat_last_user');

    console.log('Сохранённые данные:', savedData);

    // Загружаем данные последнего пользователя для отображения на экране входа
    if (savedLastUser) {
      try {
        const lastUserData = JSON.parse(savedLastUser);
        setLastUser(lastUserData);
      } catch (e) {
        console.error('Ошибка парсинга lastUser:', e);
      }
    }

    // Предзаполняем email (пароль не храним)
    if (savedEmail) {
      try {
        const creds = JSON.parse(savedEmail);
        setEmail(creds.email || '');
        setRememberMe(true);
      } catch (e) {
        console.error('Ошибка парсинга savedEmail:', e);
      }
    }

    // Отправляем событие подключения пользователя
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData);
        console.log('Отправляем user_joined:', parsed);
        newSocket.emit('user_joined', {
          userId: parsed.userId,
          username: parsed.username,
          email: parsed.email,
          deviceId: getDeviceId(),
          deviceName: getDeviceName()
        });
      } catch (e) {
        console.error('Ошибка парсинга savedData:', e);
      }
    } else {
      console.warn('Нет сохранённых данных пользователя!');
    }
    
    newSocket.on('user_joined_success', async ({ user, chats: userChats }) => {
      // Очищаем таймаут
      if (loginTimeoutRef.current) clearTimeout(loginTimeoutRef.current);
      
      // Загружаем полный профиль пользователя со статусом
      try {
        const response = await fetch(`${SOCKET_URL}/api/profile/${user.userId}`);
        if (response.ok) {
          const data = await response.json();
          const statusText = data.user.status_text || '';
          const fullUser = {
            ...user,
            status_text: statusText,
            is_admin: data.user.is_admin || 0
          };
          setCurrentUser(fullUser);
          const canBook = fullUser.username === 'Root' || data.user.can_book_meeting_room === 1;
          setCanBookMeetingRoom(canBook);
          setCanEditWiki(fullUser.is_admin === 1 || data.user.can_edit_wiki === 1);
        } else {
          setCurrentUser(user);
          setCanBookMeetingRoom(false);
          setCanEditWiki(user.is_admin === 1);
        }
      } catch (err) {
        console.error('Ошибка загрузки профиля:', err);
        setCurrentUser(user);
        setCanBookMeetingRoom(false);
        setCanEditWiki(user.is_admin === 1);
      }
      
      setIsLoggedIn(true);
      // Сбрасываем unreadCount для всех чатов при загрузке
      // (так как пользователь только что вошел и видел все сообщения)
      const chatsWithZeroUnread = userChats.map(chat => ({
        ...chat,
        unreadCount: 0
      }));
      setChats(chatsWithZeroUnread);

      // Инициализируем E2EE статус из данных сервера (групповые чаты)
      const initialE2EE = {};
      for (const chat of chatsWithZeroUnread) {
        if (chat.e2ee) {
          initialE2EE[chat.id] = true;
        }
      }
      if (Object.keys(initialE2EE).length > 0) {
        setE2eeEnabled(prev => ({ ...prev, ...initialE2EE }));
      }

      // Сохраняем список чатов в IndexedDB для офлайн-доступа
      saveChats(chatsWithZeroUnread).catch(err => console.error('[Offline] save chats error:', err));

      // Сохраняем данные пользователя для повторного входа
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        userId: user.userId,
        username: user.username,
        email: user.email,
        is_admin: user.is_admin
      }));

      // Сохраняем данные последнего пользователя для быстрого входа (с аватаром)
      localStorage.setItem('chat_last_user', JSON.stringify({
        userId: user.userId,
        username: user.username,
        avatar: user.avatar || ''
      }));

      // Проверяем статус админа
      checkAdminStatus(user.userId);

      // Инициализируем E2EE
      setE2EEApiBase(SOCKET_URL);
      initE2EEForUser(user.userId).then(result => {
        if (result) {
          myKeyPairRef.current = result.keyPair;
        }
      });



      if (userChats.length > 0) {
        // При первом входе открываем первый чат, при переподключении сохраняем текущий
        const currentActiveId = activeChatIdRef.current;
        if (currentActiveId && userChats.some(c => c.id === currentActiveId)) {
          // Чат всё ещё существует — просто присоединяемся к нему
          newSocket.emit('join_chat', currentActiveId);
        } else {
          // Первый вход или текущий чат удалили — открываем первый
          const firstChat = userChats[0];
          setActiveChatId(firstChat.id);
          activeChatIdRef.current = firstChat.id;
          newSocket.emit('join_chat', firstChat.id);
        }
      }

      // Отправляем накопленные офлайн-сообщения
      flushOutbox();
    });

    newSocket.on('chat_history', async ({ chatId, messages: chatMessages }) => {
      // Очищаем таймаут загрузки если он есть
      if (window.chatLoadTimeout) {
        clearTimeout(window.chatLoadTimeout);
        window.chatLoadTimeout = null;
      }

      // Дешифруем E2EE сообщения
      const decryptedMessages = await decryptE2EEMessages(chatMessages, chatId);

      // Сохраняем сообщения в IndexedDB для офлайн-доступа
      saveMessages(chatId, decryptedMessages).catch(err => console.error('[Offline] save error:', err));

      // Устанавливаем сообщения только для активного чата
      if (activeChatIdRef.current === chatId) {
        setMessages(decryptedMessages);

        // Инициализируем реакции из сообщений
        const reactionsData = {};
        decryptedMessages.forEach(msg => {
          if (msg.reactions) {
            reactionsData[msg.id] = { reactions: msg.reactions };
          }
        });
        setMessageReactions(reactionsData);
      }
    });

    newSocket.on('bot_typing', ({ chatId, isTyping }) => {
      setBotTypingChatId(isTyping ? chatId : null);
    });

    newSocket.on('admin_notification', ({ type, title, message, requestId }) => {
      if (type === 'support_request') {
        alert(`📞 Новое обращение в поддержку\n\n${title}\n${message}`);
        if (activeAdminTab === 'support') loadSupportRequests(supportActiveFilter || 'open');
      }
    });

    newSocket.on('new_message', async ({ message, chat, isOwnMessage }) => {
      // Расшифровываем E2EE сообщение
      if (message.e2ee && message.e2ee_nonce) {
        const decryptedText = await decryptE2EEMessageText(message, message.chatId);
        if (decryptedText !== message.text) {
          message.text = decryptedText;
        }
      }

      // Сохраняем в IndexedDB для офлайн-доступа
      saveMessages(message.chatId, [message]).catch(err => console.error('[Offline] save msg error:', err));

      // Используем currentUserRef.current и activeChatIdRef.current для актуальных значений
      const myId = currentUserRef.current?.id;
      const isMyMessage = isOwnMessage || message.senderId === myId;
      const isChatActive = message.chatId === activeChatIdRef.current;

      // Показываем уведомление если:
      // 1. Сообщение не от нас
      if (!isMyMessage) {

        // Звук уведомления
        if (notificationSettingsRef.current.sound) {
          try {
            const audio = new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU');
            audio.play().catch(() => {});
          } catch (e) {}
        }

        // In-app уведомление (Telegram-стиль) — показываем всегда
        const senderName = message.senderName || 'Чат УРСА';
        const messageBody = stripStickerMarkers(message.text) || '📎 Файл';
        showInAppNotification(senderName, messageBody, message.senderAvatar || null, message.chatId);

        // Системное уведомление (на рабочем столе) — как в Telegram + при свёрнутом окне
        const shouldShowSystemNotification = !isChatActive || !isAppVisibleRef.current;

        if (shouldShowSystemNotification && notificationSettingsRef.current.newMessages) {
          const senderName = message.senderName || 'Чат УРСА';
          const messageBody = (message.senderName ? `${message.senderName}: ` : '') + (stripStickerMarkers(message.text) || '📎 Файл');

          if (window.electronAPI) {
            window.electronAPI.sendNotification({
              title: 'Чат УРСА',
              body: messageBody,
              icon: message.senderAvatar || null,
              chatId: message.chatId
            });
          } else if (notificationPermissionRef.current === 'granted') {
            const notif = new Notification('Чат УРСА', {
              body: messageBody,
              icon: message.senderAvatar || '/favicon.ico',
              badge: '/favicon.ico',
              tag: message.chatId,
              requireInteraction: false,
              data: { chatId: message.chatId }
            });

            notif.onclick = () => {
              // Фокусируем окно через main process (работает надёжнее, чем window.focus)
              if (window.electronAPI?.focusWindow) {
                window.electronAPI.focusWindow();
              } else {
                window.focus();
              }
              const chatId = message.chatId;
              const chatToOpen = chats.find(c => c.id === chatId);
              if (chatToOpen) {
                handleSelectChat(chatToOpen);
              }
              notif.close();
            };
          }
        }
      } else {
        console.log('Уведомление НЕ показываем: своё сообщение');
      }

      setChats(prev => {
        // Проверяем, существует ли чат
        const chatExists = prev.some(c => c.id === chat.id);
        
        if (chatExists) {
          // Обновляем существующий чат
          const updated = prev.map(c => {
            if (c.id === chat.id) {
              // Используем isMyMessage вместо isOwnMessage для надёжности
              const isMessageFromMe = isOwnMessage || message.senderId === currentUserRef.current?.id;

              // Полностью игнорируем chat.unreadCount с сервера
              // Считаем непрочитанные только локально
              let newUnreadCount;

              // Логика подсчёта непрочитанных:
              // - Если чат активен И приложение видно → сообщение на экране, unreadCount = 0
              // - Если чат активен НО приложение скрыто/свёрнуто → пользователь не видит, увеличиваем счётчик
              // - Исходящие сообщения → всегда 0
              // - Входящие + чат не активен → увеличиваем счётчик
              if (!isMessageFromMe && isChatActive && isAppVisibleRef.current) {
                newUnreadCount = 0;
              } else if (isMessageFromMe) {
                newUnreadCount = 0;
              } else {
                newUnreadCount = (c.unreadCount || 0) + 1;
              }

              // Сохраняем локальные данные чата (participantsDetails и т.д.)
              return {
                ...c,  // Используем локальный объект чата, а не серверный
                unreadCount: newUnreadCount,
                lastMessage: {
                  text: stripStickerMarkers(message.text) || (message.file ? '📎 Файл' : ''),
                  timestamp: message.timestamp,
                  senderName: message.senderName,
                  senderId: message.senderId
                }
              };
            }
            return c;
          });
          return updated.sort((a, b) => {
            const aTime = a.lastMessage?.timestamp || a.createdAt;
            const bTime = b.lastMessage?.timestamp || b.createdAt;
            return new Date(bTime) - new Date(aTime);
          });
        } else {
          // Чат не существует - добавляем его (например, при пересылке в новый чат)
          console.log('Новый чат не найден в списке, добавляем:', chat);
          const newChat = {
            ...chat,
            unreadCount: isMyMessage ? 0 : 1,
            lastMessage: {
              text: stripStickerMarkers(message.text) || (message.file ? '📎 Файл' : ''),
              timestamp: message.timestamp,
              senderName: message.senderName,
              senderId: message.senderId
            }
          };
          return [...prev, newChat].sort((a, b) => {
            const aTime = a.lastMessage?.timestamp || a.createdAt;
            const bTime = b.lastMessage?.timestamp || b.createdAt;
            return new Date(bTime) - new Date(aTime);
          });
        }
      });

      // Добавляем сообщение в список, если чат активен
      // Используем activeChatIdRef.current для актуального значения
      if (message.chatId === activeChatIdRef.current) {
        setMessages(prev => [...prev, message]);
      }
    });

    newSocket.on('chat_created', ({ chat }) => {
      setChats(prev => {
        if (prev.find(c => c.id === chat.id)) return prev;
        const newChats = [...prev, chat];
        saveChats(newChats).catch(() => {});
        return newChats;
      });
      // Переключаемся на новый чат
      setActiveChatId(chat.id);
      newSocket.emit('join_chat', chat.id);
      setMessages([]);
    });

    newSocket.on('chat_updated', ({ chatId, chat }) => {
      setChats(prev => {
        const chatExists = prev.some(c => c.id === chatId);
        let result;
        
        if (chatExists) {
          // Обновляем только lastMessage и timestamp, сохраняя локальные данные
          result = prev.map(c => {
            if (c.id === chatId) {
              return {
                ...c,  // Сохраняем все локальные данные (participantsDetails и т.д.)
                lastMessage: chat.lastMessage || c.lastMessage,
                unreadCount: c.unreadCount  // Сохраняем локальный unreadCount
              };
            }
            return c;
          });
        } else {
          // Чат не существует - добавляем его
          console.log('chat_updated: новый чат не найден, добавляем:', chat);
          result = [...prev, { ...chat, unreadCount: 0 }];
        }
        saveChats(result).catch(() => {});
        return result;
      });
    });

    newSocket.on('chat_avatar_updated', ({ chatId, avatar }) => {
      setChats(prev => prev.map(c => c.id === chatId ? { ...c, avatar } : c));
    });

    newSocket.on('user_avatar_updated', ({ userId, avatar }) => {
      setMessages(prev => prev.map(m => m.senderId === userId ? { ...m, senderAvatar: avatar } : m));
      setChats(prev => prev.map(c => c.participantsDetails ? { ...c, participantsDetails: c.participantsDetails.map(p => p.id === userId ? { ...p, avatar } : p) } : c));
    });

    newSocket.on('users_list', (usersList) => {
      setUsers(usersList);
    });

    // Обработка событий календаря
    newSocket.on('task_created', ({ task }) => {
      // Обновляем задачи календаря
      setCalendarTasks(prev => {
        const exists = prev.some(t => t.id === task.id);
        if (!exists) {
          return [...prev, task];
        }
        return prev;
      });
      
      // Если выбрана дата задачи, обновляем задачи дня
      if (selectedDate) {
        const dateStr = selectedDate.toISOString().split('T')[0];
        if (task.task_date === dateStr) {
          setSelectedDayTasks(prev => {
            const exists = prev.some(t => t.id === task.id);
            if (!exists) {
              return [...prev, task].sort((a, b) => {
                const timeA = a.task_time || '00:00';
                const timeB = b.task_time || '00:00';
                return timeA.localeCompare(timeB);
              });
            }
            return prev;
          });
        }
      }
    });

    newSocket.on('task_updated', ({ task }) => {
      // Обновляем задачу в списке
      setCalendarTasks(prev => prev.map(t => t.id === task.id ? task : t));
      
      // Обновляем задачи выбранного дня
      setSelectedDayTasks(prev => prev.map(t => t.id === task.id ? task : t));
    });

    newSocket.on('task_deleted', ({ taskId }) => {
      // Удаляем задачу из списка
      setCalendarTasks(prev => prev.filter(t => t.id !== taskId));
      
      // Удаляем из задач выбранного дня
      setSelectedDayTasks(prev => prev.filter(t => t.id !== taskId));
    });

    newSocket.on('user_profile_updated', ({ userId, username, full_name, work_phone, mobile_phone, status_text }) => {
      // Обновляем список пользователей
      setUsers(prev => {
        const exists = prev.some(u => u.id === userId);
        if (exists) {
          return prev.map(u =>
            u.id === userId
              ? { ...u, full_name, work_phone, mobile_phone, status_text: status_text || '', about: u.about }
              : u
          );
        } else {
          return [...prev, {
            id: userId,
            username,
            full_name,
            work_phone,
            mobile_phone,
            status_text: status_text || '',
            about: '',
            avatar: '',
            status: 'offline'
          }];
        }
      });

      // Обновляем participantsDetails в чатах (activeChat обновится автоматически)
      setChats(prev => prev.map(chat => {
        if (chat.participantsDetails) {
          const updatedParticipants = chat.participantsDetails.map(p =>
            p.id === userId
              ? { ...p, full_name, work_phone, mobile_phone, status_text: status_text || '' }
              : p
          );
          return { ...chat, participantsDetails: updatedParticipants };
        }
        return chat;
      }));

      if (currentUserRef.current && currentUserRef.current.id === userId) {
        setCurrentUser(prev => ({ ...prev, status_text: status_text || '' }));
      }
    });

    newSocket.on('user_status_changed', ({ userId, username, status, statusText, last_seen }) => {
      // Обновляем список пользователей
      setUsers(prev => prev.map(u => {
        if (u.id === userId) {
          const updated = { ...u, status };
          if (statusText !== undefined) updated.status_text = statusText;
          if (last_seen !== undefined) updated.last_seen = last_seen;
          return updated;
        }
        return u;
      }));

      // Обновляем participantsDetails в чатах
      setChats(prev => prev.map(chat => {
        if (chat.participantsDetails) {
          const updatedParticipants = chat.participantsDetails.map(p => {
            if (p.id === userId) {
              const updated = { ...p, status };
              if (statusText !== undefined) updated.status_text = statusText;
              if (last_seen !== undefined) updated.last_seen = last_seen;
              return updated;
            }
            return p;
          });
          return { ...chat, participantsDetails: updatedParticipants };
        }
        return chat;
      }));

      // Обновляем currentUser если это тот же пользователь
      if (currentUserRef.current && currentUserRef.current.id === userId) {
        setCurrentUser(prev => {
          const updated = { ...prev, status };
          if (statusText !== undefined) updated.status_text = statusText;
          if (last_seen !== undefined) updated.last_seen = last_seen;
          return updated;
        });
      }
    });

    newSocket.on('user_typing', ({ chatId, username, isTyping: isTypingFlag }) => {
      if (chatId === activeChatIdRef.current) {
        if (isTypingFlag) {
          // Пользователь начал печатать
          setTypingUsers(prev => {
            const updated = { ...prev };
            // Удаляем предыдущий таймаут если есть
            if (updated[username]?.timeout) {
              clearTimeout(updated[username].timeout);
            }
            // Устанавливаем новый таймаут на 3 секунды
            const timeout = setTimeout(() => {
              setTypingUsers(current => {
                const newCurrent = { ...current };
                delete newCurrent[username];
                return newCurrent;
              });
            }, 3000);
            
            updated[username] = { username, timeout };
            return updated;
          });
        } else {
          // Пользователь закончил печатать
          setTypingUsers(prev => {
            const updated = { ...prev };
            if (updated[username]?.timeout) {
              clearTimeout(updated[username].timeout);
            }
            delete updated[username];
            return updated;
          });
        }
      }
    });

    // Обработка прочтения сообщений
    newSocket.on('messages_read', ({ chatId, readBy, readAt }) => {
      if (!readBy || !readAt) return;

      // Глобально отмечаем пользователя как читавшего в этом чате
      let readers = readByChatRef.current.get(chatId);
      if (!readers) {
        readers = new Set();
        readByChatRef.current.set(chatId, readers);
      }
      const wasNew = !readers.has(readBy);
      readers.add(readBy);

      // Обновляем сообщения в текущем активном чате — все кроме собственных
      if (chatId === activeChatIdRef.current) {
        setMessages(prev => prev.map(msg => {
          if (msg.senderId !== currentUserRef.current?.id && !msg.read_at) {
            return { ...msg, read_at: readAt };
          }
          return msg;
        }));
      }

      // Принудительный ре-рендер для обновления статусов на всех сообщениях чата
      if (wasNew) {
        setReadStatusVersion(v => v + 1);
      }
    });

    // Обработка удаления сообщения администратором
    newSocket.on('message_deleted', ({ id: deletedMessageId }) => {
      setMessages(prev => prev.filter(msg => msg.id !== deletedMessageId));
    });

    // Обработка редактирования сообщения
    newSocket.on('message_edited', async ({ messageId, newText, editedBy, editedAt, e2ee, e2ee_nonce }) => {
      let displayText = newText;
      if (e2ee && activeChatIdRef.current) {
        displayText = await decryptE2EEMessageText({ text: newText, e2ee: true, e2ee_nonce: e2ee_nonce }, activeChatIdRef.current);
      }
      setMessages(prev => prev.map(msg =>
        msg.id === messageId
          ? { ...msg, text: displayText, edited: true, editedAt }
          : msg
      ));
    });

    // Обработка событий группы
    newSocket.on('participant_left', ({ chatId, userId }) => {
      setChats(prev => prev.map(chat => {
        if (chat.id !== chatId || !chat.participantsDetails) return chat;
        return {
          ...chat,
          participantsDetails: chat.participantsDetails.filter(p => p.id !== userId),
          participants: chat.participantsDetails.filter(p => p.id !== userId).map(p => p.username)
        };
      }));
      setUsers(prev => prev.filter(u => u.id !== userId));
    });

    newSocket.on('participant_added', ({ chatId, userId }) => {
      // Обновим чаты принудительно (перезагрузка списка произойдёт при следующем входе)
      setChats(prev => prev.map(chat => {
        if (chat.id === chatId) {
          return { ...chat, _refresh: Date.now() };
        }
        return chat;
      }));
    });

    newSocket.on('removed_from_chat', ({ chatId }) => {
      setChats(prev => prev.filter(c => c.id !== chatId));
      if (activeChatIdRef.current === chatId) {
        setActiveChatId(null);
        setMessages([]);
      }
    });

    // Обработка @mention
    newSocket.on('user_mentioned', ({ chatId, messageId, senderName, text }) => {
      if (chatId === activeChatIdRef.current) {
        // Если мы в нужном чате — подсветим сообщение
        setTimeout(() => {
          const el = document.getElementById(`message-${messageId}`);
          if (el) {
            el.classList.add('message-highlight');
            setTimeout(() => el.classList.remove('message-highlight'), 3000);
          }
        }, 500);
      }
    });

    // === ОБРАБОТКА ОПРОСОВ ===
    newSocket.on('poll_vote', ({ poll }) => {
      setMessages(prev => prev.map(msg => {
        if (!msg.poll || msg.poll.id !== poll.id) return msg;
        return { ...msg, poll: { ...poll, votedIndices: msg.poll.votedIndices || [] } };
      }));
    });

    // === ОБРАБОТКА ОБЪЯВЛЕНИЙ ===
    newSocket.on('new_announcement', () => {
      setUnreadAnnouncements(prev => prev + 1);
      if (showAnnouncements) {
        fetchAnnouncements();
      }
    });

    // === ОБРАБОТКА РЕАКЦИЙ ===

    // Обработка добавления реакции
    newSocket.on('reaction_added', ({ messageId, emoji, userId, username, avatar }) => {
      setMessageReactions(prev => {
        const messageReactions = prev[messageId] || { reactions: {} };
        const newReactions = { ...messageReactions.reactions };

        // Сначала удаляем все существующие реакции этого пользователя
        Object.keys(newReactions).forEach(existingEmoji => {
          newReactions[existingEmoji] = newReactions[existingEmoji].filter(
            u => u.userId !== userId
          );
          // Удаляем пустые эмодзи
          if (newReactions[existingEmoji].length === 0) {
            delete newReactions[existingEmoji];
          }
        });

        // Добавляем новую реакцию с аватаркой
        if (!newReactions[emoji]) {
          newReactions[emoji] = [];
        }
        newReactions[emoji].push({ userId, username, avatar });

        return {
          ...prev,
          [messageId]: { reactions: newReactions }
        };
      });

      // Частицы запускаются в handleAddReaction — здесь не дублируем
    });

    // Обработка удаления реакции
    newSocket.on('reaction_removed', ({ messageId, emoji, userId }) => {
      setMessageReactions(prev => {
        const messageReactions = prev[messageId] || { reactions: {} };
        const newReactions = { ...messageReactions.reactions };

        if (newReactions[emoji]) {
          newReactions[emoji] = newReactions[emoji].filter(u => u.userId !== userId);
          // Удаляем эмодзи, если не осталось пользователей
          if (newReactions[emoji].length === 0) {
            delete newReactions[emoji];
          }
        }

        return {
          ...prev,
          [messageId]: { reactions: newReactions }
        };
      });
    });

    // Обработка закрепления сообщения
    newSocket.on('message_pinned', ({ chatId, messageId, message, pinnedBy, pinnedByName, pinnedAt }) => {
      console.log('📌 message_pinned received:', { chatId, messageId, hasMessage: !!message });
      if (message && chatId) {
        setPinnedMessages(prev => {
          const chatPinned = prev[chatId] || [];
          // Проверяем, нет ли уже этого сообщения в списке закрепленных для данного чата
          if (!chatPinned.find(m => String(m.id) === String(messageId))) {
            console.log('✅ Добавляем закрепленное сообщение:', messageId);
            return { ...prev, [chatId]: [message, ...chatPinned] };
          }
          console.log('⚠️ Сообщение уже закреплено:', messageId);
          return prev;
        });
        // Если это наш текущий активный чат, показываем плашку закрепленного сообщения
        if (chatId === activeChatIdRef.current) {
          console.log('📌 Активный чат совпадает, показываем плашку');
          setShowPinnedBar(true);
        } else {
          console.log('⚠️ Чат не активен:', chatId, '!=', activeChatIdRef.current);
        }
      } else {
        console.error('❌ message_pinned: нет message или chatId', { hasMessage: !!message, chatId });
      }
    });

    // Обработка открепления сообщения
    newSocket.on('message_unpinned', ({ chatId, messageId }) => {
      console.log('📍 message_unpinned received:', { chatId, messageId });
      if (chatId) {
        setPinnedMessages(prev => {
          const chatPinned = prev[chatId] || [];
          const updatedChatPinned = chatPinned.filter(m => String(m.id) !== String(messageId));
          if (chatId === activeChatIdRef.current && updatedChatPinned.length === 0) {
            setShowPinnedBar(false);
          }
          return { ...prev, [chatId]: updatedChatPinned };
        });
      }
    });

    // Получение списка закреплённых сообщений
    newSocket.on('pinned_messages_list', ({ chatId, messages: pinnedMsgs }) => {
      setPinnedMessages(prev => ({ ...prev, [chatId]: pinnedMsgs }));
      if (chatId === activeChatIdRef.current && pinnedMsgs.length > 0) {
        setShowPinnedBar(true);
      }
    });

    // Обработка ошибок при закреплении/откреплении
    newSocket.on('pin_error', ({ error }) => {
      console.error('Ошибка закрепления:', error);
      alert('Не удалось закрепить сообщение: ' + (error || 'неизвестная ошибка'));
    });

    newSocket.on('unpin_error', ({ error }) => {
      console.error('Ошибка открепления:', error);
      alert('Не удалось открепить сообщение: ' + (error || 'неизвестная ошибка'));
    });

    return () => {
      if (loginTimeoutRef.current) clearTimeout(loginTimeoutRef.current);
      newSocket.close();
    };
  }, []);

  // Применение темы к документу
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', appTheme);
    localStorage.setItem('chat_app_theme', appTheme);
  }, [appTheme]);

  // Обновляем ref при изменении currentUser
  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  // Обработчик открытия чата из уведомления (для Electron)
  useEffect(() => {
    let cleanup;
    if (window.electronAPI && window.electronAPI.onOpenChatFromNotification) {
      cleanup = window.electronAPI.onOpenChatFromNotification((chatId) => {
        console.log('Открываем чат из уведомления:', chatId);
        
        // Находим чат в списке
        const chatToOpen = chats.find(c => c.id === chatId);
        
        if (chatToOpen) {
          // Открываем чат
          handleSelectChat(chatToOpen);
        } else {
          // Если чат не найден, пробуем загрузить список чатов заново
          console.log('Чат не найден в списке, загружаем чаты...');
          if (socket) {
            socket.emit('get_chats');
          }
          // Пробуем открыть чат через небольшую задержку
          setTimeout(() => {
            const chat = chats.find(c => c.id === chatId);
            if (chat) {
              handleSelectChat(chat);
            }
          }, 500);
        }
      });
    }
    return () => { if (cleanup) cleanup(); };
  }, [chats, socket]);

  // Генерация бейджа с количеством непрочитанных сообщений для панели задач
  function generateBadgeDataUrl(count) {
    if (!count || count <= 0) return null;

    const text = count > 99 ? '99+' : String(count);
    const size = 16;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Красный круг
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#ff3333';
    ctx.fill();

    // Белая цифра
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (text.length <= 1) {
      ctx.font = 'bold 10px Arial';
    } else if (text.length === 2) {
      ctx.font = 'bold 8px Arial';
    } else {
      ctx.font = 'bold 7px Arial';
    }
    ctx.fillText(text, size / 2, size / 2 + 0.5);

    return canvas.toDataURL();
  }

  // Отправляем общее количество непрочитанных сообщений в Electron для отображения бейджа
  useEffect(() => {
    // Суммируем все непрочитанные сообщения из всех чатов
    const totalUnread = chats.reduce((sum, chat) => {
      return sum + (chat.unreadCount || 0);
    }, 0);

    console.log('[Badge] Общее количество непрочитанных:', totalUnread);
    console.log('[Badge] electronAPI существует:', !!window.electronAPI);

    if (window.electronAPI) {
      window.electronAPI.setUnreadCount(totalUnread);
      window.electronAPI.setBadgeIcon(generateBadgeDataUrl(totalUnread));
    }
  }, [chats]);

  // Проверка дней рождения после обновления списка пользователей
  useEffect(() => {
    if (users.length > 0) {
      checkBirthdaysToday();
    }
  }, [users]);

  // Отметка сообщений как прочитанные при открытии чата
  useEffect(() => {
    if (socket && activeChatId && currentUser) {
      socket.emit('mark_read', { chatId: activeChatId });
      // Загружаем закреплённые сообщения для чата
      socket.emit('get_pinned_messages', { chatId: activeChatId });
    }
  }, [socket, activeChatId, currentUser]);

  // Запрос списка пользователей при входе
  useEffect(() => {
    if (socket && isLoggedIn) {
      socket.emit('get_users');
    }
  }, [socket, isLoggedIn]);

  // Отслеживание активности пользователя (сброс idle-таймера)
  useEffect(() => {
    if (!socket || !isLoggedIn) return;

    const sendActivity = () => {
      socket.emit('user_activity');
    };

    const handleActivity = () => {
      socket.emit('user_activity');
    };

    // Ленивые события — раз в 60 секунд
    const intervalId = setInterval(sendActivity, 60000);

    // Быстрые события — при любом действии
    document.addEventListener('mousemove', handleActivity);
    document.addEventListener('keydown', handleActivity);
    document.addEventListener('click', handleActivity);
    document.addEventListener('scroll', handleActivity, { passive: true });
    document.addEventListener('touchstart', handleActivity, { passive: true });

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('mousemove', handleActivity);
      document.removeEventListener('keydown', handleActivity);
      document.removeEventListener('click', handleActivity);
      document.removeEventListener('scroll', handleActivity);
      document.removeEventListener('touchstart', handleActivity);
    };
  }, [socket, isLoggedIn]);

  // Загрузка настроек уведомлений и проверка дней рождения при загрузке страницы
  useEffect(() => {
    // Загружаем настройки из localStorage
    const saved = localStorage.getItem('notificationSettings');
    if (saved) {
      try {
        setNotificationSettings(JSON.parse(saved));
      } catch (e) {}
    }

    // Проверяем, была ли уже проверка дней рождения сегодня
    const today = new Date().toDateString();
    const lastCheck = localStorage.getItem('lastBirthdayCheck');
    
    // Если сегодня ещё не проверяли или наступила новая дата
    if (lastCheck !== today && isLoggedIn && users.length > 0) {
      // Показываем уведомление о днях рождениях
      const todayDay = new Date().getDate();
      const todayMonth = new Date().getMonth() + 1;
      
      const birthdays = users.filter(user => {
        if (!user.birth_date) return false;
        const birthDate = new Date(user.birth_date);
        return birthDate.getDate() === todayDay && (birthDate.getMonth() + 1) === todayMonth;
      });
      
      if (birthdays.length > 0 && Notification.permission === 'granted' && notificationSettings.birthdays) {
        const names = birthdays.map(b => b.username).join(', ');
        
        // Звук уведомления
        if (notificationSettings.sound) {
          try {
            const audio = new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU');
            audio.play().catch(() => {});
          } catch (e) {}
        }
        
        new Notification('🎂 День рождения!', {
          body: `У ${names} сегодня день рождения!`,
          icon: '/favicon.ico',
          badge: '/favicon.ico'
        });
        
        // Запоминаем, что сегодня уже проверяли
        localStorage.setItem('lastBirthdayCheck', today);
      }
    }
  }, [isLoggedIn, users.length]);

  // Проверка наступления новой даты (каждую минуту)
  useEffect(() => {
    const interval = setInterval(() => {
      const today = new Date().toDateString();
      if (lastBirthdayCheckRef.current !== today && isLoggedIn && users.length > 0) {
        lastBirthdayCheckRef.current = today;
        
        // Проверяем дни рождения
        const todayDay = new Date().getDate();
        const todayMonth = new Date().getMonth() + 1;
        
        const birthdays = users.filter(user => {
          if (!user.birth_date) return false;
          const birthDate = new Date(user.birth_date);
          return birthDate.getDate() === todayDay && (birthDate.getMonth() + 1) === todayMonth;
        });
        
        if (birthdays.length > 0 && Notification.permission === 'granted' && notificationSettings.birthdays) {
          const names = birthdays.map(b => b.username).join(', ');
          
          if (notificationSettings.sound) {
            try {
              const audio = new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU');
              audio.play().catch(() => {});
            } catch (e) {}
          }
          
          new Notification('🎂 День рождения!', {
            body: `У ${names} сегодня день рождения!`,
            icon: '/favicon.ico',
            badge: '/favicon.ico'
          });
          
          localStorage.setItem('lastBirthdayCheck', today);
        }
      }
    }, 60000); // Проверяем каждую минуту

    return () => clearInterval(interval);
  }, [isLoggedIn, users.length, notificationSettings]);

  // Обработка входа
  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    setIsLoading(true);

    try {
      const response = await fetch(`${SOCKET_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (response.ok) {
        // Сохраняем email для быстрого входа (пароль НЕ сохраняем)
        if (rememberMe) {
          localStorage.setItem('chat_credentials_email', JSON.stringify({
            email: email
          }));
        } else {
          localStorage.removeItem('chat_credentials_email');
        }

        // Подключаемся к сокету с данными пользователя
        socket.emit('join', {
          username: data.user.username,
          userId: data.user.id
        });
        // Очищаем форму
        setEmail('');
        setPassword('');
        // Проверяем статус админа
        checkAdminStatus(data.user.id);

        // Регистрируем push-подписку
        const pushSub = window.__pushSubscription || JSON.parse(localStorage.getItem('chat_push_subscription') || 'null');
        if (pushSub) {
          try {
            await fetch(`${SOCKET_URL}/api/push/subscribe`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: data.user.id, subscription: pushSub })
            });
          } catch (err) {
            console.warn('[Push] Ошибка регистрации подписки:', err.message);
          }
        }
      } else {
        setAuthError(data.error || 'Ошибка входа');
      }
    } catch (err) {
      setAuthError('Ошибка соединения с сервером');
    } finally {
      setIsLoading(false);
    }
  };

  // Обработка регистрации
  const handleRegister = async (e) => {
    e.preventDefault();
    setAuthError('');
    setIsLoading(true);

    if (password.length < 8) {
      setAuthError('Пароль должен быть не менее 8 символов');
      setIsLoading(false);
      return;
    }

    const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;
    if (!passwordRegex.test(password)) {
      setAuthError('Пароль должен содержать минимум 8 символов, одну заглавную букву, одну цифру и один спецсимвол');
      setIsLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setAuthError('Пароли не совпадают');
      setIsLoading(false);
      return;
    }

    if (!birthDate) {
      setAuthError('Дата рождения обязательна');
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch(`${SOCKET_URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password, confirmPassword, birthDate })
      });

      const data = await response.json();

      if (response.ok) {
        // Автоматически входим после регистрации
        const loginResponse = await fetch(`${SOCKET_URL}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });

        const loginData = await loginResponse.json();
        if (loginResponse.ok) {
          socket.emit('join', {
            username: loginData.user.username,
            userId: loginData.user.id
          });
          setUsername('');
          setEmail('');
          setPassword('');
          setConfirmPassword('');
          setBirthDate('');
          // Проверяем статус админа после регистрации
          checkAdminStatus(loginData.user.id);
        }
      } else {
        setAuthError(data.error || 'Ошибка регистрации');
      }
    } catch (err) {
      setAuthError('Ошибка соединения с сервером');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    setShowLogoutConfirm(true);
  };

  const confirmLogout = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('chat_push_subscription');

    // Отписываемся от push-уведомлений
    const pushSub = window.__pushSubscription;
    if (pushSub && pushSub.endpoint) {
      fetch(`${SOCKET_URL}/api/push/subscribe`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: pushSub.endpoint })
      }).catch(() => {});
      window.__pushSubscription = null;
    }

    setIsLoggedIn(false);
    setCurrentUser(null);
    setChats([]);
    setMessages([]);
    setActiveChatId(null);
    setShowLogoutConfirm(false);
  };

  const requestNotificationPermission = () => {
    if ('Notification' in window) {
      Notification.requestPermission().then(permission => {
        setBrowserNotificationPermission(permission);
        notificationPermissionRef.current = permission;
        console.log('Разрешение на уведомления:', permission);
        if (permission === 'granted') {
          setShowNotificationBanner(false);
          localStorage.removeItem('notificationBannerDismissed');
        }
      });
    }
  };

  const enableBrowserNotifications = () => {
    requestNotificationPermission();
  };

  const dismissNotificationBanner = () => {
    setShowNotificationBanner(false);
    localStorage.setItem('notificationBannerDismissed', 'true');
  };

  const handleOpenNotificationSettings = () => {
    // Загружаем настройки из localStorage
    const saved = localStorage.getItem('notificationSettings');
    if (saved) {
      try {
        setNotificationSettings(JSON.parse(saved));
      } catch (e) {}
    }
    setShowNotificationSettings(true);
  };

  // Проверка статуса админа и загрузка данных
  const checkAdminStatus = async (userId) => {
    const idToCheck = userId || currentUser?.id;
    if (!idToCheck) return;

    try {
      const response = await fetch(`${SOCKET_URL}/api/admin/check?userId=${idToCheck}`);
      if (response.ok) {
        const data = await response.json();
        if (data.isAdmin) {
          setIsAdmin(true);
          loadAdminStats();
        }
      }
    } catch (err) {
      console.error('Ошибка проверки админа:', err);
    }
  };

  const loadAdminStats = async () => {
    if (!currentUser) return;
    
    try {
      const response = await fetch(`${SOCKET_URL}/api/admin/stats?userId=${currentUser.id}`);
      if (response.ok) {
        const data = await response.json();
        setAdminStats(data);
      }
    } catch (err) {
      console.error('Ошибка загрузки статистики:', err);
    }
  };

  const loadBotAnalytics = async () => {
    if (!currentUser) return;
    try {
      const response = await fetch(`${SOCKET_URL}/api/bot/analytics?userId=${currentUser.id}`);
      if (response.ok) {
        const data = await response.json();
        setBotAnalyticsData(data.analytics);
      }
    } catch (err) {
      console.error('Ошибка загрузки аналитики бота:', err);
    }
  };

  const loadBotSettings = async () => {
    if (!currentUser) return;
    try {
      const response = await fetch(`${SOCKET_URL}/api/bot/settings`);
      if (response.ok) {
        const data = await response.json();
        setBotSettings(data.settings);
      }
    } catch (err) {
      console.error('Ошибка загрузки настроек бота:', err);
    }
  };

  const loadSupportRequests = async (status = 'open') => {
    if (!currentUser) return;
    try {
      const response = await fetch(`${SOCKET_URL}/api/admin/support-requests?userId=${currentUser.id}&status=${status}`);
      if (response.ok) {
        const data = await response.json();
        setSupportRequests(data.requests);
      }
    } catch (err) {
      console.error('Ошибка загрузки обращений:', err);
    }
  };

  const loadAdminUsers = async () => {
    if (!currentUser) return;

    try {
      const response = await fetch(`${SOCKET_URL}/api/admin/users?userId=${currentUser.id}`);
      if (response.ok) {
        const data = await response.json();
        setAdminUsers(data.users);
        
        // Подсчитываем количество пользователей на каждый host
        const counts = {};
        data.users.forEach(user => {
          const host = user.host || 'unknown';
          counts[host] = (counts[host] || 0) + 1;
        });
        setHostCounts(counts);
      }
    } catch (err) {
      console.error('Ошибка загрузки пользователей:', err);
    }
  };

  const handleOpenAdminPanel = () => {
    setActiveView('admin');
    checkAdminStatus();
  };

  const handleAdminTabChange = (tab) => {
    setActiveAdminTab(tab);
    if (tab === 'users') loadAdminUsers();
    if (tab === 'dashboard') loadAdminStats();
  };

  const handleDeleteUser = async (userId) => {
    if (!confirm('Вы уверены, что хотите удалить этого пользователя?')) return;

    try {
      const response = await fetch(`${SOCKET_URL}/api/admin/users/${userId}?adminId=${currentUser.id}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        loadAdminUsers();
        loadAdminStats();
      } else {
        alert('Ошибка удаления пользователя');
      }
    } catch (err) {
      console.error('Ошибка удаления:', err);
    }
  };

  const handleCreateUser = async () => {
    const { username, email, password, is_admin } = newUserData;
    
    if (!username || !email || !password) {
      alert('Заполните все обязательные поля');
      return;
    }
    
    if (password.length < 6) {
      alert('Пароль должен быть не менее 6 символов');
      return;
    }

    setIsCreatingUser(true);
    try {
      const response = await fetch(`${SOCKET_URL}/api/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          email,
          password,
          is_admin: parseInt(is_admin),
          adminId: currentUser.id
        })
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        alert('Пользователь успешно создан');
        setNewUserData({ username: '', email: '', password: '', is_admin: 0 });
        setShowCreateUserModal(false);
        loadAdminUsers();
        loadAdminStats();
      } else {
        alert(data.error || 'Ошибка создания пользователя');
      }
    } catch (err) {
      console.error('Ошибка создания:', err);
      alert('Ошибка соединения с сервером');
    } finally {
      setIsCreatingUser(false);
    }
  };

  const handleToggleAdminRights = async (userId, currentIsAdmin) => {
    const newIsAdmin = currentIsAdmin === 1 ? 0 : 1;

    try {
      const response = await fetch(`${SOCKET_URL}/api/admin/users/${userId}/rights`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_admin: newIsAdmin,
          adminId: currentUser.id
        })
      });

      if (response.ok) {
        loadAdminUsers();
      } else {
        alert('Ошибка изменения прав');
      }
    } catch (err) {
      console.error('Ошибка изменения прав:', err);
    }
  };

  // Переключение права на бронирование переговорной
  const handleToggleMeetingRoomRights = async (userId, currentCanBook) => {
    const newCanBook = currentCanBook === 1 ? 0 : 1;

    try {
      const response = await fetch(`${SOCKET_URL}/api/admin/users/${userId}/meeting-room-rights`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          can_book_meeting_room: newCanBook,
          adminId: currentUser.id
        })
      });

      if (response.ok) {
        loadAdminUsers();
        // Обновляем локальное право если это текущий пользователь
        if (userId === currentUser.id) {
          setCanBookMeetingRoom(newCanBook === 1);
        }
      } else {
        alert('Ошибка изменения права на бронирование');
      }
    } catch (err) {
      console.error('Ошибка изменения права на бронирование:', err);
    }
  };

  const handleToggleWikiRights = async (userId, currentCanEdit) => {
    const newCanEdit = currentCanEdit === 1 ? 0 : 1;

    try {
      const response = await fetch(`${SOCKET_URL}/api/admin/users/${userId}/wiki-rights`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          can_edit_wiki: newCanEdit,
          adminId: currentUser.id
        })
      });

      if (response.ok) {
        loadAdminUsers();
        if (userId === currentUser.id) {
          setCanEditWiki(newCanEdit === 1);
        }
      } else {
        alert('Ошибка изменения права на редактирование wiki');
      }
    } catch (err) {
      console.error('Ошибка изменения права на wiki:', err);
    }
  };

  // Сброс пароля пользователя
  const handleOpenResetPassword = (user) => {
    setUserToResetPassword(user);
    setNewPassword('');
    setShowResetPasswordModal(true);
  };

  const handleResetPassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      alert('Пароль должен быть не менее 6 символов');
      return;
    }

    try {
      const response = await fetch(`${SOCKET_URL}/api/admin/users/${userToResetPassword.id}/reset-password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newPassword,
          adminId: currentUser.id
        })
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        alert('Пароль успешно сброшен');
        setShowResetPasswordModal(false);
        setUserToResetPassword(null);
        setNewPassword('');
      } else {
        alert(data.error || 'Ошибка сброса пароля');
      }
    } catch (err) {
      console.error('Ошибка сброса пароля:', err);
      alert('Ошибка соединения с сервером');
    }
  };

  // Загрузка активных сессий
  const loadActiveSessions = async () => {
    if (!currentUser) return;
    
    try {
      const response = await fetch(`${SOCKET_URL}/api/admin/sessions?userId=${currentUser.id}`);
      if (response.ok) {
        const data = await response.json();
        setActiveSessions(data.sessions || []);
      }
    } catch (err) {
      console.error('Ошибка загрузки сессий:', err);
    }
  };

  const handleOpenSessions = () => {
    loadActiveSessions();
    setShowSessionsModal(true);
  };

  const handleTerminateSession = async (sessionId) => {
    if (!confirm('Завершить эту сессию?')) return;
    
    try {
      const response = await fetch(`${SOCKET_URL}/api/admin/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminId: currentUser.id })
      });
      
      if (response.ok) {
        loadActiveSessions();
      } else {
        alert('Ошибка завершения сессии');
      }
    } catch (err) {
      console.error('Ошибка завершения сессии:', err);
    }
  };

  // Загрузка файлов
  const loadUploadedFiles = async () => {
    if (!currentUser) return;
    
    try {
      const response = await fetch(`${SOCKET_URL}/api/admin/files?userId=${currentUser.id}`);
      if (response.ok) {
        const data = await response.json();
        setUploadedFiles(data.files || []);
      }
    } catch (err) {
      console.error('Ошибка загрузки файлов:', err);
    }
  };

  const handleOpenFileManager = () => {
    loadUploadedFiles();
    setShowFileManagerModal(true);
  };

  const handleDeleteFile = async (file) => {
    if (!confirm(`Удалить файл ${file.name}?`)) return;
    
    try {
      const response = await fetch(`${SOCKET_URL}/api/admin/files/${file.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminId: currentUser.id })
      });
      
      if (response.ok) {
        loadUploadedFiles();
      } else {
        alert('Ошибка удаления файла');
      }
    } catch (err) {
      console.error('Ошибка удаления файла:', err);
    }
  };

  // Загрузка логов безопасности
  const loadSecurityLogs = async () => {
    if (!currentUser) return;
    
    try {
      const response = await fetch(`${SOCKET_URL}/api/admin/security-logs?userId=${currentUser.id}`);
      if (response.ok) {
        const data = await response.json();
        setSecurityLogs(data.logs || []);
      }
    } catch (err) {
      console.error('Ошибка загрузки логов:', err);
    }
  };

  const handleOpenSecurityLogs = () => {
    loadSecurityLogs();
    setShowSecurityLogsModal(true);
  };

  // Загрузка настроек интерфейса
  const loadUiSettings = async () => {
    try {
      const response = await fetch(`${SOCKET_URL}/api/admin/ui-settings`);
      if (response.ok) {
        const data = await response.json();
        if (data.settings) {
          setUiSettings(data.settings);
        }
      }
    } catch (err) {
      console.error('Ошибка загрузки настроек:', err);
    }
  };

  const handleSaveUiSettings = async () => {
    setIsSavingUiSettings(true);
    
    try {
      const response = await fetch(`${SOCKET_URL}/api/admin/ui-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(uiSettings)
      });
      
      if (response.ok) {
        alert('Настройки сохранены');
        setShowUiSettingsModal(false);
        // Применяем настройки
        document.documentElement.style.setProperty('--primary-color', uiSettings.primaryColor);
        document.documentElement.style.setProperty('--secondary-color', uiSettings.secondaryColor);
        document.title = uiSettings.siteName;
      } else {
        alert('Ошибка сохранения настроек');
      }
    } catch (err) {
      console.error('Ошибка сохранения настроек:', err);
      alert('Ошибка соединения с сервером');
    } finally {
      setIsSavingUiSettings(false);
    }
  };

  const handleOpenUiSettings = () => {
    loadUiSettings();
    setShowUiSettingsModal(true);
  };

  const handleOpenPhonebook = () => {
    // Запрашиваем актуальный список пользователей перед открытием телефонной книги
    if (socket) {
      socket.emit('get_users');
    }
    setActiveView('phonebook');
  };

  const handleOpenCalendar = () => {
    setActiveView('calendar');
    // Устанавливаем текущую дату
    const today = new Date();
    setSelectedDate(today);

    // Загружаем задачи для текущего месяца
    const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
    fetchCalendarTasks(startOfMonth, endOfMonth);
    
    // Загружаем бронирования переговорной
    fetchMeetingRoomBookings(startOfMonth, endOfMonth);
  };

  const [pbiReports, setPbiReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [reportPermissions, setReportPermissions] = useState([]);
  const [showReportPermEditor, setShowReportPermEditor] = useState(false);

  const loadReportPermissions = async (reportId) => {
    try {
      const res = await fetch(`${SOCKET_URL}/api/pbi-reports/${reportId}/permissions`, {
        headers: { 'X-User-Id': currentUser?.id || '' }
      });
      if (res.ok) setReportPermissions(await res.json());
    } catch (e) {
      console.error('Ошибка загрузки разрешений:', e);
    }
  };

  const handleOpenReports = async () => {
    setActiveView('reports');
    try {
      const res = await fetch(`${SOCKET_URL}/api/pbi-reports`, {
        headers: { 'X-User-Id': currentUser?.id || '' }
      });
      if (res.ok) setPbiReports(await res.json());
    } catch (e) {
      console.error('Ошибка загрузки отчётов:', e);
    }
  };

  const [kpiData, setKpiData] = useState(null);
  const [kpiEditMode, setKpiEditMode] = useState(false);
  const [kpiDraft, setKpiDraft] = useState({});
  const [kpiRefreshing, setKpiRefreshing] = useState(false);
  const [kpiPeriod, setKpiPeriod] = useState('all');

  const KPI_PERIODS = {
    sales_today: 'today',
    sales_yesterday: 'yesterday',
    sales_month: 'month',
    frs_cash: 'yesterday',
    frs_transfer: 'yesterday',
    frs_other: 'yesterday'
  };

  const PERIOD_TABS = [
    { key: 'all', label: 'Все' },
    { key: 'today', label: 'Сегодня' },
    { key: 'yesterday', label: 'Вчера' },
    { key: 'month', label: 'Месяц' },
    { key: 'manual', label: 'Вручную' }
  ];

  function kpiPeriodFilter(kpi) {
    if (kpiPeriod === 'all') return true;
    const p = KPI_PERIODS[kpi.id] || 'manual';
    return p === kpiPeriod || (kpiPeriod !== 'manual' && p === 'manual');
  }

  const handleOpenKpi = async () => {
    setActiveView('kpi');
    setKpiEditMode(false);
    try {
      const res = await fetch(`${SOCKET_URL}/api/kpi`, {
        headers: { 'X-User-Id': currentUser?.id || '' }
      });
      if (res.ok) setKpiData(await res.json());
    } catch (e) {
      console.error('Ошибка загрузки KPI:', e);
    }
  };

  const handleKpiSave = async () => {
    const entries = [];
    for (const [kpiId, val] of Object.entries(kpiDraft)) {
      if (val.value !== undefined && val.value !== '') {
        entries.push({ kpi_id: kpiId, value: Number(val.value), plan_value: val.plan_value !== undefined ? Number(val.plan_value) : null });
      }
    }
    try {
      const res = await fetch(`${SOCKET_URL}/api/kpi`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': currentUser?.id || '' },
        body: JSON.stringify({ entries })
      });
      if (res.ok) {
        setKpiEditMode(false);
        handleOpenKpi();
      } else {
        alert('Ошибка сохранения');
      }
    } catch (e) {
      console.error('Ошибка сохранения KPI:', e);
    }
  };

  const handleKpiEdit = () => {
    const draft = {};
    if (kpiData) {
      for (const group of Object.values(kpiData.groups)) {
        for (const item of group) {
          draft[item.id] = { value: item.value ?? '', plan_value: item.plan_value ?? '' };
        }
      }
    }
    setKpiDraft(draft);
    setKpiEditMode(true);
  };

  const handleKpiRefresh = async () => {
    setKpiRefreshing(true);
    try {
      const res = await fetch(`${SOCKET_URL}/api/kpi/refresh`, {
        method: 'POST',
        headers: { 'X-User-Id': currentUser?.id || '' }
      });
      if (res.ok) {
        await handleOpenKpi();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Ошибка обновления');
      }
    } catch (e) {
      console.error('Ошибка обновления KPI:', e);
      alert('Ошибка обновления КПЭ');
    } finally {
      setKpiRefreshing(false);
    }
  };

  // Обновление задач текущего дня после загрузки календаря
  useEffect(() => {
    if (activeView === 'calendar' && selectedDate && calendarTasks.length > 0) {
      const year = selectedDate.getFullYear();
      const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const day = String(selectedDate.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      
      const dayTasks = calendarTasks.filter(t => t.task_date === dateStr);
      setSelectedDayTasks(dayTasks.sort((a, b) => {
        const timeA = a.task_time || '00:00';
        const timeB = b.task_time || '00:00';
        return timeA.localeCompare(timeB);
      }));
    }
  }, [calendarTasks, activeView]);

  const handleOpenChats = () => {
    setActiveView('chats');
    setShowChatList(true); // На мобильных — показываем список чатов
  };

  const handleOpenSettings = () => {
    setActiveView('settings');
    setActiveSettingsTab('about');
  };

  const handleSaveUserUiSettings = () => {
    // Сохраняем настройки в localStorage для текущего пользователя
    if (currentUser?.id) {
      localStorage.setItem(`userUiSettings_${currentUser.id}`, JSON.stringify(userUiSettings));
    }
    // Настройки применяются автоматически через useEffect
  };

  const handleSaveNotificationSettings = () => {
    localStorage.setItem('notificationSettings', JSON.stringify(notificationSettings));
    alert('Настройки уведомлений сохранены!');
  };

  const handleOpenProfile = async () => {
    if (!currentUser) return;

    try {
      const response = await fetch(`${SOCKET_URL}/api/profile/${currentUser.id}`);
      if (response.ok) {
        const data = await response.json();
        const statusText = data.user.status_text || '';
        // Разделяем статус на смайл и описание
        const firstChar = statusText.charAt(0);
        const isEmoji = firstChar && /[\p{Emoji}]/u.test(firstChar);
        const emoji = isEmoji ? firstChar : '';
        const description = isEmoji ? statusText.substring(1).trim() : statusText;
        
        setProfileData({
          username: data.user.username || '',
          birthDate: data.user.birth_date || '',
          about: data.user.about || '',
          avatar: data.user.avatar || '',
          mobilePhone: data.user.mobile_phone || '',
          workPhone: data.user.work_phone || '',
          statusText: statusText
        });
        setStatusEmoji(emoji);
        setStatusDescription(description);
        // Обновляем текущего пользователя
        setCurrentUser(prev => ({
          ...prev,
          about: data.user.about || prev.about,
          status_text: statusText
        }));
      }
    } catch (err) {
      console.error('Ошибка загрузки профиля:', err);
    }
    setShowProfileModal(true);
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      const response = await fetch(`${SOCKET_URL}/api/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          username: profileData.username || null,
          birthDate: profileData.birthDate || null,
          about: profileData.about || null,
          mobilePhone: profileData.mobilePhone || null,
          workPhone: profileData.workPhone || null,
          statusText: profileData.statusText || null
        })
      });

      if (response.ok) {
        const data = await response.json();
        setCurrentUser(prev => ({
          ...prev,
          ...data.user,
          about: data.user.about || prev.about,
          status_text: data.user.status_text || ''
        }));
        setShowProfileModal(false);
      } else {
        const error = await response.json();
        alert(error.error || 'Ошибка сохранения');
      }
    } catch (err) {
      console.error('Ошибка сохранения профиля:', err);
      alert('Ошибка соединения с сервером');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUploadAvatar = async (e) => {
    const file = e.target.files[0];
    if (!file || !currentUser) return;
    
    const formData = new FormData();
    formData.append('avatar', file);
    formData.append('userId', currentUser.id);
    
    try {
      const response = await fetch(`${SOCKET_URL}/api/upload-avatar`, {
        method: 'POST',
        body: formData
      });
      
      if (response.ok) {
        const data = await response.json();
        setProfileData(prev => ({ ...prev, avatar: data.avatar }));
        setCurrentUser(prev => ({ ...prev, avatar: data.avatar }));
        setMessages(prev => prev.map(m => m.senderId === currentUser.id ? { ...m, senderAvatar: data.avatar } : m));
      } else {
        alert('Ошибка загрузки аватара');
      }
    } catch (err) {
      console.error('Ошибка загрузки аватара:', err);
      alert('Ошибка соединения с сервером');
    }
  };

  const handleRemoveAvatar = async () => {
    if (!currentUser || !confirm('Удалить аватар?')) return;
    try {
      const res = await fetch(`${SOCKET_URL}/api/remove-avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id })
      });
      if (res.ok) {
        setProfileData(prev => ({ ...prev, avatar: '' }));
        setCurrentUser(prev => ({ ...prev, avatar: '' }));
        setMessages(prev => prev.map(m => m.senderId === currentUser.id ? { ...m, senderAvatar: '' } : m));
      } else {
        alert('Ошибка удаления аватара');
      }
    } catch (err) {
      console.error('Ошибка удаления аватара:', err);
      alert('Ошибка соединения с сервером');
    }
  };

  // Скролл вниз к последнему сообщению
  const scrollToBottom = () => {
    if (!messagesEndRef.current) return;
    const container = messagesEndRef.current.parentElement;
    if (container) {
      container.scrollTop = container.scrollHeight - container.clientHeight;
    }
  };

  const handleSelectChat = async (chat) => {
    setActiveChatId(chat.id);
    activeChatIdRef.current = chat.id;
    setActiveView('chats'); // Переключаемся на вид чатов

    // На мобильных — переключаемся на вид чата
    setShowChatList(false);

    // Очищаем индикаторы печати при смене чата
    setTypingUsers({});

    // Проверяем подключение сокета
    if (!socket || !socket.connected) {
      console.warn('Сокет не подключён, пытаемся загрузить сообщения через API...');

      // Загружаем сообщения через HTTP API
      try {
        const response = await fetch(`${SOCKET_URL}/api/messages/${chat.id}?userId=${currentUser?.id}`);
        if (response.ok) {
          const data = await response.json();
          setMessages(data.messages || []);
          // Сохраняем в IndexedDB для офлайн-доступа
          saveMessages(chat.id, data.messages || []).catch(() => {});
        } else {
          console.error('Ошибка загрузки сообщений через API, пробуем IndexedDB...');
          // Fallback на IndexedDB (офлайн-режим)
          try {
            const offlineMessages = await getMessages(chat.id);
            if (offlineMessages.length > 0) {
              setMessages(offlineMessages);
            } else {
              setMessages([]);
            }
          } catch (dbErr) {
            console.error('Ошибка загрузки из IndexedDB:', dbErr);
            setMessages([]);
          }
        }
      } catch (err) {
        console.error('Ошибка загрузки сообщений:', err);
        // Fallback на IndexedDB (сервер недоступен)
        try {
          const offlineMessages = await getMessages(chat.id);
          if (offlineMessages.length > 0) {
            console.log(`[Offline] Загружено ${offlineMessages.length} сообщений из кэша`);
            setMessages(offlineMessages);
          } else {
            setMessages([]);
          }
        } catch (dbErr) {
          console.error('Ошибка загрузки из IndexedDB:', dbErr);
          setMessages([]);
        }
      }
    } else {
      // Сокет подключён, используем WebSocket
      socket.emit('join_chat', chat.id);
      socket.emit('mark_read', { chatId: chat.id });

      // Устанавливаем таймаут на случай если chat_history не придёт
      const loadTimeout = setTimeout(async () => {
        if (activeChatIdRef.current === chat.id) {
          try {
            const res = await fetch(`${SOCKET_URL}/api/messages/${chat.id}?userId=${currentUser?.id}`);
            if (res.ok) {
              const data = await res.json();
              if (activeChatIdRef.current === chat.id) {
                setMessages(data.messages || []);
              }
            } else {
              // Fallback на IndexedDB если сервер ответил ошибкой
              const offlineMessages = await getMessages(chat.id);
              if (offlineMessages.length > 0 && activeChatIdRef.current === chat.id) {
                setMessages(offlineMessages);
              }
            }
          } catch (err) {
            console.error('Ошибка загрузки через API fallback:', err);
            // Fallback на IndexedDB если сервер недоступен
            const offlineMessages = await getMessages(chat.id);
            if (offlineMessages.length > 0 && activeChatIdRef.current === chat.id) {
              console.log(`[Offline] Загружено ${offlineMessages.length} сообщений из кэша (timeout)`);
              setMessages(offlineMessages);
            }
          }
        }
      }, 3000);

      // Сохраняем ID таймаута для очистки при необходимости
      window.chatLoadTimeout = loadTimeout;
    }

    // Сбрасываем счетчик непрочитанных для этого чата
    setChats(prev => prev.map(c =>
      c.id === chat.id ? { ...c, unreadCount: 0 } : c
    ));
    // Сбрасываем поиск при переключении чата
    setShowSearchMessages(false);
    setSearchQuery('');
    setSearchResults([]);
    setCurrentSearchIndex(0);
  };

  // Поиск по сообщениям и пользователям (во всех чатах)
  const handleSearchMessages = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setUserSearchResults([]);
      setIsSearching(false);
      return;
    }
    
    setIsSearching(true);
    const query = searchQuery.toLowerCase().trim();
    const userResults = [];
    let messages = [];
    
    // 1. Ищем пользователей
    users.forEach(user => {
      const username = (user.username || '').toLowerCase();
      const fullName = (user.fullName || '').toLowerCase();
      
      if (username.includes(query) || fullName.includes(query)) {
        userResults.push({
          ...user,
          type: 'user',
          searchIndex: userResults.length
        });
      }
    });
    
    // 2. Ищем сообщения через сервер (SQL LIKE)
    try {
      const response = await fetch(`${SOCKET_URL}/api/search/messages?userId=${currentUser?.id}&query=${encodeURIComponent(query)}`);
      if (response.ok) {
        const data = await response.json();
        messages = (data.messages || []).map(msg => ({
          ...msg,
          type: 'message'
        }));
      }
    } catch (err) {
      console.error('Ошибка поиска сообщений:', err);
    }

    // Объединяем результаты: сначала пользователи, потом сообщения
    const allResults = [...userResults, ...messages];
    setSearchResults(allResults);
    setUserSearchResults(userResults);
    setCurrentSearchIndex(0);
    setIsSearching(false);
  };

  const handleSearchResultClick = (result) => {
    if (result.type === 'user') {
      const existingChat = chats.find(c =>
        c.type === 'direct' &&
        c.participantsDetails &&
        c.participantsDetails.some(p => p.id === result.id)
      );
      if (existingChat) {
        handleSelectChat(existingChat);
      } else {
        createDirectChat(result.id);
      }
      handleCloseSearch();
      return;
    }
    const chatId = result.chatId || result.chat?.id;
    if (!chatId) return;
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;
    if (activeChatId !== chatId) {
      handleSelectChat(chat);
    }
    handleCloseSearch();
    const retryScroll = (attempts = 40) => {
      if (attempts <= 0) return;
      const el = document.getElementById(`message-${result.id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('message-highlight');
        setTimeout(() => el.classList.remove('message-highlight'), 2000);
      } else {
        setTimeout(() => retryScroll(attempts - 1), 250);
      }
    };
    setTimeout(() => retryScroll(), 300);
  };

  const handleSearchNext = () => {
    if (searchResults.length === 0) return;
    const nextIndex = (currentSearchIndex + 1) % searchResults.length;
    const nextResult = searchResults[nextIndex];
    
    setCurrentSearchIndex(nextIndex);
    
    // Если это пользователь
    if (nextResult.type === 'user') {
      const existingChat = chats.find(c => 
        c.type === 'direct' && 
        c.participantsDetails && 
        c.participantsDetails.some(p => p.id === nextResult.id)
      );
      
      if (existingChat) {
        handleSelectChat(existingChat);
      } else {
        createDirectChat(nextResult.id);
      }
      setTimeout(() => scrollToUser(nextResult.id), 100);
    } else {
      // Если это сообщение
      if (nextResult.chatId !== activeChatId) {
        handleSelectChat(chats.find(c => c.id === nextResult.chatId));
      }
      setTimeout(() => scrollToMessage(nextResult.id), 100);
    }
  };

  const handleSearchPrev = () => {
    if (searchResults.length === 0) return;
    const prevIndex = (currentSearchIndex - 1 + searchResults.length) % searchResults.length;
    const prevResult = searchResults[prevIndex];
    
    setCurrentSearchIndex(prevIndex);
    
    // Если это пользователь
    if (prevResult.type === 'user') {
      const existingChat = chats.find(c => 
        c.type === 'direct' && 
        c.participantsDetails && 
        c.participantsDetails.some(p => p.id === prevResult.id)
      );
      
      if (existingChat) {
        handleSelectChat(existingChat);
      } else {
        createDirectChat(prevResult.id);
      }
      setTimeout(() => scrollToUser(prevResult.id), 100);
    } else {
      // Если это сообщение
      if (prevResult.chatId !== activeChatId) {
        handleSelectChat(chats.find(c => c.id === prevResult.chatId));
      }
      setTimeout(() => scrollToMessage(prevResult.id), 100);
    }
  };

  const scrollToMessage = (messageId) => {
    const element = document.getElementById(`message-${messageId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Подсветка сообщения
      element.classList.add('message-highlight');
      setTimeout(() => {
        element.classList.remove('message-highlight');
      }, 2000);
    }
  };

  const scrollToUser = (userId) => {
    // Ищем элемент чата с этим пользователем в sidebar
    const chatElement = document.querySelector(`[data-user-id="${userId}"]`);
    if (chatElement) {
      chatElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Подсветка чата
      chatElement.classList.add('chat-highlight');
      setTimeout(() => {
        chatElement.classList.remove('chat-highlight');
      }, 2000);
    }
  };

  const createDirectChat = async (userId) => {
    if (!socket) return;
    
    const user = users.find(u => u.id === userId);
    if (!user) return;
    
    // Создаём чат через сокет
    socket.emit('create_chat', {
      type: 'direct',
      participants: [userId],
      userId: currentUser.id
    });
  };

  const handleCloseSearch = () => {
    setShowSearchMessages(false);
    setSearchQuery('');
    setSearchResults([]);
    setCurrentSearchIndex(0);
  };

  // Per-chat search
  const handleChatSearch = async (query) => {
    if (!query.trim() || !activeChatId || !currentUser) {
      setChatSearchResults([]);
      setChatSearchIndex(-1);
      return;
    }
    try {
      const resp = await fetch(`${SOCKET_URL}/api/search/messages?userId=${currentUser.id}&chatId=${activeChatId}&query=${encodeURIComponent(query.trim())}`);
      if (resp.ok) {
        const data = await resp.json();
        setChatSearchResults(data.messages || []);
        setChatSearchIndex(data.messages?.length > 0 ? 0 : -1);
      }
    } catch (err) {
      console.error('Ошибка поиска:', err);
    }
  };

  const handleChatSearchNext = () => {
    if (chatSearchResults.length === 0) return;
    const next = (chatSearchIndex + 1) % chatSearchResults.length;
    setChatSearchIndex(next);
    scrollToSearchResult(chatSearchResults[next]);
  };

  const handleChatSearchPrev = () => {
    if (chatSearchResults.length === 0) return;
    const prev = (chatSearchIndex - 1 + chatSearchResults.length) % chatSearchResults.length;
    setChatSearchIndex(prev);
    scrollToSearchResult(chatSearchResults[prev]);
  };

  const scrollToSearchResult = (result) => {
    if (result.chatId !== activeChatIdRef.current) return;
    const el = document.getElementById(`message-${result.id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('message-highlight');
      setTimeout(() => el.classList.remove('message-highlight'), 2000);
    }
  };

  const toggleChatSearch = () => {
    setChatSearchActive(prev => !prev);
    if (chatSearchActive) {
      setChatSearchQuery('');
      setChatSearchResults([]);
      setChatSearchIndex(-1);
    }
  };

  // Проверка, есть ли контент в поле ввода (текст или эмодзи-изображения)
  const hasInputContent = () => {
    if (inputText.trim()) return true;
    // Проверяем наличие изображений (эмодзи) в contentEditable div
    if (messageInputRef.current && messageInputRef.current.querySelectorAll('img.emoji').length > 0) return true;
    return false;
  };

  // Определение контекста @mention
  const getMentionContext = () => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !messageInputRef.current || !messageInputRef.current.contains(sel.anchorNode)) {
      return null;
    }
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    const offset = range.startOffset;

    // Получаем текст от начала узла до курсора
    let textBefore = '';
    if (node.nodeType === Node.TEXT_NODE) {
      textBefore = node.textContent.slice(0, offset);
    } else {
      textBefore = node.textContent ? node.textContent.slice(0, offset) : '';
    }

    // Ищем последний @ перед курсором
    const atIdx = textBefore.lastIndexOf('@');
    if (atIdx === -1) return null;
    // Проверяем, что перед @ пробел или начало строки
    if (atIdx > 0 && textBefore[atIdx - 1] !== ' ' && textBefore[atIdx - 1] !== '\n') return null;

    const filter = textBefore.slice(atIdx + 1);
    // Если после @ уже есть пробел — не показываем
    if (filter.includes(' ')) return null;

    // Позиция для попапа
    let popupX = 0, popupY = 0;
    try {
      const caretRange = document.createRange();
      caretRange.setStart(node, offset);
      caretRange.setEnd(node, offset);
      const rect = caretRange.getBoundingClientRect();
      popupX = rect.left;
      popupY = rect.bottom + 4;
    } catch (e) {
      const inputRect = messageInputRef.current.getBoundingClientRect();
      popupX = inputRect.left;
      popupY = inputRect.top - 200;
    }

    return { filter, x: popupX, y: popupY };
  };

  const handleMentionSelect = (username) => {
    if (!messageInputRef.current) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    const offset = range.startOffset;

    // Находим начало @фильтр
    let text = node.textContent || '';
    const textBefore = text.slice(0, offset);
    const atIdx = textBefore.lastIndexOf('@');
    if (atIdx === -1) return;

    // Удаляем текст @фильтр
    const afterText = text.slice(offset);
    const newText = text.slice(0, atIdx);
    node.textContent = newText + afterText;

    // Создаём mention span
    const span = document.createElement('span');
    span.className = 'mention';
    span.contentEditable = false;
    span.textContent = '@' + username;

    // Вставляем span на место удалённого текста
    const textRange = document.createRange();
    textRange.setStart(node, atIdx);
    textRange.setEnd(node, atIdx);
    textRange.deleteContents();
    textRange.insertNode(span);

    // Добавляем пробел после mention
    const space = document.createTextNode('\u00A0');
    span.parentNode.insertBefore(space, span.nextSibling);

    // Ставим курсор после пробела
    const newRange = document.createRange();
    newRange.setStartAfter(space);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);

    setInputText(getMessageText());
    setMentionPopup({ show: false, filter: '', x: 0, y: 0 });
  };

  const handleInputKeyDown = (e) => {
    if (mentionPopup.show) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const participants = (activeChat?.participantsDetails || []).filter(
          p => p.id !== currentUser?.id && p.username.toLowerCase().includes(mentionPopup.filter.toLowerCase())
        );
        if (participants.length > 0) {
          handleMentionSelect(participants[0].username);
        }
        return;
      }
      if (e.key === 'Escape') {
        setMentionPopup({ show: false, filter: '', x: 0, y: 0 });
        e.preventDefault();
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      handleSendMessage(e);
    }
  };

  // Получение текста сообщения (включая эмодзи из изображений)
  const getMessageText = () => {
    if (!messageInputRef.current) return inputText;
    
    let text = '';
    const nodes = messageInputRef.current.childNodes;
    
    nodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'IMG' && node.classList.contains('emoji')) {
        text += node.alt || '';
      } else if (node.nodeType === Node.ELEMENT_NODE && node.dataset && node.dataset.sticker === 'true') {
        text += '\x00STICKER\x00' + (node.dataset.file || node.alt || '') + '\x00STICKER\x00';
      } else {
        text += node.textContent || '';
      }
    });
    
    return text;
  };

  // E2EE: получить общий ключ для чата
  const ensureE2EEForChat = async (chatId) => {
    const cached = getCachedSharedKey(chatId);
    if (cached) return cached;
    const cachedGroup = getCachedGroupKey(chatId);
    if (cachedGroup) return cachedGroup;
    if (!myKeyPairRef.current || !currentUser) return null;
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return null;

    if (chat.type === 'direct') {
      const otherUser = chat.participantsDetails?.find(p => p.username !== currentUser?.username);
      if (!otherUser) return null;
      return ensureSharedKey(chatId, otherUser.id, myKeyPairRef.current.privateKey);
    }

    if (chat.type === 'group') {
      try {
        const res = await fetch(`${SOCKET_URL}/api/e2ee/group-key/${chatId}?userId=${currentUser.id}`);
        if (!res.ok) return null;
        const data = await res.json();
        if (!data.encryptedKey) return null;
        const parsed = JSON.parse(data.encryptedKey);
        const groupKey = await decryptGroupKey(myKeyPairRef.current.privateKey, parsed.encryptedKey, parsed.nonce, parsed.encryptedBy);
        if (groupKey) {
          cacheGroupKey(chatId, groupKey);
          return groupKey;
        }
      } catch (err) {
        console.error('[E2EE] group key fetch error:', err);
      }
      return null;
    }

    return null;
  };

  // E2EE: зашифровать текст для чата
  const prepareE2EEMessage = async (chatId, text) => {
    // E2EE не применяется к чатам с ботом (команды бота передаются в открытом виде)
    if (chatId.startsWith('bot-chat-')) return { text, e2ee: false };
    if (!e2eeEnabled[chatId] || !text) return { text, e2ee: false };
    const sharedKey = await ensureE2EEForChat(chatId);
    if (!sharedKey) {
      console.warn('[E2EE] Нет общего ключа для чата', chatId);
      return { text, e2ee: false };
    }
    const { ciphertext, nonce } = await encryptMessage(sharedKey, text);
    return { text: ciphertext, e2ee: true, e2ee_nonce: nonce, e2ee_ephemeral: '' };
  };

  // E2EE: расшифровать сообщение
  const decryptE2EEMessageText = async (message, chatId) => {
    if (!message.e2ee) return message.text;
    const cachedKey = getCachedSharedKey(chatId);
    const sharedKey = cachedKey || await ensureE2EEForChat(chatId);
    if (!sharedKey || !message.e2ee_nonce) {
      console.warn('[E2EE] Нет ключа для расшифровки', chatId);
      return message.text;
    }
    const plaintext = await decryptMessage(sharedKey, message.text, message.e2ee_nonce);
    return plaintext || message.text;
  };

  // E2EE: расшифровать массив сообщений
  const decryptE2EEMessages = async (messages, chatId) => {
    const hasE2EE = messages.some(m => m.e2ee);
    if (!hasE2EE) return messages;
    const sharedKey = getCachedSharedKey(chatId) || await ensureE2EEForChat(chatId);
    if (!sharedKey) return messages;
    return Promise.all(messages.map(async (msg) => {
      if (!msg.e2ee || !msg.e2ee_nonce) return msg;
      const plaintext = await decryptMessage(sharedKey, msg.text, msg.e2ee_nonce);
      if (plaintext !== null) return { ...msg, text: plaintext };
      return msg;
    }));
  };

  // Отправка сообщения с поддержкой офлайн-режима
  const sendOrQueueMessage = (msgData) => {
    if (socket && socket.connected) {
      socket.emit('send_message', msgData);
    } else {
      // Офлайн: сохраняем в очередь отправки
      const offlineMsg = {
        ...msgData,
        _offline: true,
        _localId: Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
      };
      queueOutgoing(offlineMsg).catch(err => console.error('[Offline] queue error:', err));
      console.log('[Offline] Сообщение сохранено в очередь:', offlineMsg._localId);
    }
  };

  // Отправка всех накопленных офлайн-сообщений
  const flushOutbox = async () => {
    if (!socket || !socket.connected) return;
    try {
      const queue = await getOutbox();
      if (queue.length === 0) return;
      console.log(`[Offline] Отправка ${queue.length} накопленных сообщений...`);
      for (const msg of queue) {
        socket.emit('send_message', msg);
        await removeFromOutbox(msg.id);
      }
      console.log('[Offline] Очередь отправлена');
    } catch (err) {
      console.error('[Offline] Ошибка отправки очереди:', err);
    }
  };

  // Показ in-app уведомления (Telegram-стиль)
  const showInAppNotification = (title, body, icon, chatId) => {
    const id = ++inAppNotificationIdRef.current;
    setInAppNotifications(prev => [...prev.slice(-4), { id, title, body, icon, chatId }]);
  };

  // Закрыть in-app уведомление
  const dismissInAppNotification = (id) => {
    setInAppNotifications(prev => prev.filter(n => n.id !== id));
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!socket || (!hasInputContent() && !selectedFile) || !activeChatId) return;

    const messageText = getMessageText();

    if (selectedFile) {
      setIsUploading(true);
      const formData = new FormData();
      formData.append('file', selectedFile);

      try {
        const response = await fetch(`${SOCKET_URL}/upload`, {
          method: 'POST',
          body: formData
        });
        const fileData = await response.json();

        const e2eePrepared = await prepareE2EEMessage(activeChatId, messageText);
        const expiresAt = selfDestructTimer ? new Date(Date.now() + selfDestructTimer).toISOString() : null;
        sendOrQueueMessage({
          chatId: activeChatId,
          text: e2eePrepared.text,
          ...(e2eePrepared.e2ee ? { e2ee: true, e2ee_nonce: e2eePrepared.e2ee_nonce, e2ee_ephemeral: e2eePrepared.e2ee_ephemeral } : {}),
          replyTo: replyToMessage ? { messageId: replyToMessage.id, text: replyToMessage.text, senderName: replyToMessage.senderName } : null,
          ...(expiresAt ? { expiresAt } : {}),
          file: {
            filename: fileData.filename,
            url: fileData.url,
            size: fileData.size,
            mimetype: fileData.mimetype
          }
        });
        setSelfDestructTimer(null);
      } catch (error) {
        console.error('Ошибка загрузки файла:', error);
      } finally {
        setIsUploading(false);
        setSelectedFile(null);
        setReplyToMessage(null);
        setInputText('');
        // Очищаем contentEditable div
        if (messageInputRef.current) {
          messageInputRef.current.innerHTML = '';
        }
        // Очищаем черновик после отправки
        setMessageDrafts(prev => {
          const newDrafts = { ...prev };
          delete newDrafts[activeChatId];
          return newDrafts;
        });
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    } else if (editingMessage) {
      // Inline-режим редактирования: отправляем edit_message с текстом из поля ввода
      const newText = messageText.trim();
      const editE2EE = await prepareE2EEMessage(activeChatId, newText);
      socket.emit('edit_message', {
        messageId: editingMessage,
        newText: editE2EE.text,
        ...(editE2EE.e2ee ? { e2ee: true, e2ee_nonce: editE2EE.e2ee_nonce } : {})
      });
      setEditingMessage(null);
      setIsEditMode(false);
      setInputText('');
      if (messageInputRef.current) {
        messageInputRef.current.innerHTML = '';
      }
      setMessageDrafts(prev => {
        const newDrafts = { ...prev };
        delete newDrafts[activeChatId];
        return newDrafts;
      });
    } else {
      const e2eePrepared = await prepareE2EEMessage(activeChatId, messageText);
      const expiresAt = selfDestructTimer ? new Date(Date.now() + selfDestructTimer).toISOString() : null;
      sendOrQueueMessage({
        chatId: activeChatId,
        text: e2eePrepared.text,
        ...(e2eePrepared.e2ee ? { e2ee: true, e2ee_nonce: e2eePrepared.e2ee_nonce, e2ee_ephemeral: e2eePrepared.e2ee_ephemeral } : {}),
        replyTo: replyToMessage ? { messageId: replyToMessage.id, text: replyToMessage.text, senderName: replyToMessage.senderName } : null,
        ...(expiresAt ? { expiresAt } : {})
      });
      setSelfDestructTimer(null);
      setReplyToMessage(null);
      setInputText('');
      // Очищаем contentEditable div
      if (messageInputRef.current) {
        messageInputRef.current.innerHTML = '';
      }
      // Очищаем черновик после отправки
      setMessageDrafts(prev => {
        const newDrafts = { ...prev };
        delete newDrafts[activeChatId];
        return newDrafts;
      });
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  // Создание опроса
  const handleCreatePoll = async () => {
    const question = pollQuestion.trim();
    const options = pollOptions.map(o => o.trim()).filter(Boolean);
    if (!question || options.length < 2 || !activeChatId || !currentUser) return;
    setPollLoading(true);
    try {
      const res = await fetch(`${SOCKET_URL}/api/polls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: activeChatId,
          userId: currentUser.id,
          question,
          options,
          isAnonymous: pollIsAnonymous,
          allowsMultiple: pollAllowsMultiple,
          closesAt: pollClosesAt ? new Date(pollClosesAt).toISOString() : null,
          hideResultsUntilClose: pollHideResults
        })
      });
      if (res.ok) {
        setShowPollModal(false);
        setPollQuestion('');
        setPollOptions(['', '']);
        setPollIsAnonymous(false);
        setPollAllowsMultiple(false);
        setPollClosesAt('');
        setPollHideResults(false);
      } else {
        const text = await res.text();
        try { const j = JSON.parse(text); alert('Ошибка: ' + (j.error || text)); } catch { alert('Ошибка сервера: ' + text.substring(0, 200)); }
      }
    } catch (err) {
      console.error('Ошибка создания опроса:', err);
      alert('Ошибка сети: ' + err.message);
    } finally {
      setPollLoading(false);
    }
  };

  const handlePollVote = async (pollId, optionIndex) => {
    if (!currentUser) return;
    try {
      const res = await fetch(`${SOCKET_URL}/api/polls/${pollId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id, optionIndex })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.poll) {
          setMessages(prev => prev.map(msg =>
            msg.poll && msg.poll.id === pollId
              ? { ...msg, poll: data.poll }
              : msg
          ));
        }
      }
    } catch (err) {
      console.error('Ошибка голосования:', err);
    }
  };

  // Объявления
  const fetchAnnouncements = async () => {
    if (!currentUser) return;
    try {
      const res = await fetch(`${SOCKET_URL}/api/announcements?userId=${currentUser.id}`);
      if (res.ok) {
        const data = await res.json();
        setAnnouncements(data.announcements || []);
      }
    } catch (err) {
      console.error('Ошибка загрузки объявлений:', err);
    }
  };

  const handleCreateAnnouncement = async () => {
    if (!currentUser || !announcementTitle.trim() || !announcementContent.trim()) return;
    setAnnouncementLoading(true);
    try {
      const res = await fetch(`${SOCKET_URL}/api/announcements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          title: announcementTitle.trim(),
          content: announcementContent.trim(),
          priority: announcementPriority
        })
      });
      if (res.ok) {
        setShowCreateAnnouncement(false);
        setAnnouncementTitle('');
        setAnnouncementContent('');
        setAnnouncementPriority('normal');
        fetchAnnouncements();
      }
    } catch (err) {
      console.error('Ошибка создания объявления:', err);
    } finally {
      setAnnouncementLoading(false);
    }
  };

  const handleMarkAnnouncementRead = async (announcementId) => {
    if (!currentUser) return;
    try {
      await fetch(`${SOCKET_URL}/api/announcements/${announcementId}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id })
      });
      setAnnouncements(prev => prev.map(a =>
        a.id === announcementId ? { ...a, isRead: true, myReadAt: new Date().toISOString() } : a
      ));
    } catch (err) {
      console.error('Ошибка отметки прочтения:', err);
    }
  };

  // Wiki / База знаний
  const loadWikiData = async () => {
    try {
      const [catRes, artRes] = await Promise.all([
        fetch(`${SOCKET_URL}/api/wiki/categories`),
        fetch(`${SOCKET_URL}/api/wiki/articles?userId=${currentUser?.id}`)
      ]);
      if (catRes.ok) {
        const catData = await catRes.json();
        setWikiCategories(catData.categories || []);
      }
      if (artRes.ok) {
        const artData = await artRes.json();
        setWikiArticles(artData.articles || []);
      }
    } catch (err) {
      console.error('Ошибка загрузки Wiki:', err);
    }
  };

  const wikiSaveArticle = async () => {
    if (!currentUser || !wikiEditTitle.trim()) return;
    try {
      const body = {
        title: wikiEditTitle.trim(),
        content: wikiEditContent,
        categoryId: wikiEditCategory || null,
        userId: currentUser.id
      };

      if (isAdmin) {
        body.accessLevel = wikiAccessLevel;
        if (wikiAccessLevel === 'selected') {
          body.allowedUsers = wikiAllowedUsers;
        }
      }

      if (wikiActiveArticle) {
        await fetch(`${SOCKET_URL}/api/wiki/articles/${wikiActiveArticle.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      } else {
        await fetch(`${SOCKET_URL}/api/wiki/articles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      }
      setWikiEditMode(false);
      setWikiActiveArticle(null);
      setWikiAccessLevel('public');
      setWikiAllowedUsers([]);
      loadWikiData();
    } catch (err) {
      console.error('Ошибка сохранения статьи:', err);
    }
  };

  const wikiDeleteArticle = async (articleId) => {
    try {
      const res = await fetch(`${SOCKET_URL}/api/wiki/articles/${articleId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id })
      });
      if (!res.ok) {
        const err = await res.json();
        alert('Ошибка: ' + (err.error || 'Доступ запрещён'));
        return;
      }
      setWikiActiveArticle(null);
      loadWikiData();
    } catch (err) {
      console.error('Ошибка удаления статьи:', err);
    }
  };

  const wikiLoadFiles = async (articleId) => {
    try {
      const res = await fetch(`${SOCKET_URL}/api/wiki/articles/${articleId}/files`);
      const data = await res.json();
      if (data.success) setWikiFiles(data.files || []);
    } catch (err) {
      console.error('Ошибка загрузки файлов:', err);
    }
  };

  const wikiUploadFile = async (articleId, file) => {
    setWikiFileUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('userId', currentUser.id);
      const res = await fetch(`${SOCKET_URL}/api/wiki/articles/${articleId}/files`, {
        method: 'POST',
        body: formData
      });
      if (!res.ok) {
        const text = await res.text();
        try { const j = JSON.parse(text); alert('Ошибка: ' + (j.error || text)); } catch { alert('Ошибка: ' + text.substring(0, 200)); }
        setWikiFileUploading(false);
        return;
      }
      const data = await res.json();
      if (data.success) {
        setWikiFiles(prev => [...prev, data.file]);
      } else {
        alert('Ошибка загрузки: ' + (data.error || 'Неизвестная ошибка'));
      }
    } catch (err) {
      console.error('Ошибка загрузки файла:', err);
      try {
        const text = await err.text?.() || '';
        alert('Ошибка загрузки файла' + (text ? ': ' + text.substring(0, 100) : ''));
      } catch {
        alert('Ошибка загрузки файла');
      }
    } finally {
      setWikiFileUploading(false);
    }
  };

  const wikiOpenArticle = async (article) => {
    setWikiActiveArticle(article);
    await wikiLoadFiles(article.id);
  };

  const openWikiArticleById = async (articleId) => {
    let article = wikiArticles.find(a => a.id === articleId);
    if (!article) {
      await loadWikiData();
      article = wikiArticles.find(a => a.id === articleId);
    }
    if (article) {
      setActiveView('wiki');
      wikiOpenArticle(article);
    }
  };

  const wikiDeleteFile = async (articleId, fileId) => {
    try {
      const res = await fetch(`${SOCKET_URL}/api/wiki/articles/${articleId}/files/${fileId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id })
      });
      const data = await res.json();
      if (data.success) {
        setWikiFiles(prev => prev.filter(f => f.id !== fileId));
      }
    } catch (err) {
      console.error('Ошибка удаления файла:', err);
    }
  };

  const getCategoryIds = (categoryId) => {
    const ids = [categoryId];
    const findChildren = (parentId) => {
      wikiCategories.filter(c => c.parent_id === parentId).forEach(child => {
        ids.push(child.id);
        findChildren(child.id);
      });
    };
    findChildren(categoryId);
    return ids;
  };

  const isCategoryEditable = (categoryId) => {
    if (isAdmin) return true;
    if (!categoryId || !currentUser) return false;
    let id = categoryId;
    while (id) {
      const cat = wikiCategories.find(c => c.id === id);
      if (cat && cat.editors && cat.editors.includes(currentUser.id)) return true;
      id = cat ? cat.parent_id : null;
    }
    return false;
  };

  const isAnyCategoryEditor = !isAdmin && currentUser && wikiCategories.some(c => isCategoryEditable(c.id));

  const wikiDeleteCategoryRecursive = async (categoryId) => {
    const children = wikiCategories.filter(c => c.parent_id === categoryId);
    for (const child of children) {
      await wikiDeleteCategoryRecursive(child.id);
    }
    try {
      const res = await fetch(`${SOCKET_URL}/api/wiki/categories/${categoryId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id })
      });
      if (!res.ok) {
        const err = await res.json();
        alert('Ошибка: ' + (err.error || 'Доступ запрещён'));
      }
    } catch (err) {
      console.error('Ошибка удаления категории:', err);
    }
  };

  const wikiCreateCategory = async () => {
    if (!wikiCategoryName.trim()) return;
    try {
      const res = await fetch(`${SOCKET_URL}/api/wiki/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: wikiCategoryName.trim(),
          description: wikiCategoryDesc.trim(),
          parentId: wikiCategoryParent || null,
          userId: currentUser.id
        })
      });
      if (!res.ok) {
        const err = await res.json();
        alert('Ошибка: ' + (err.error || 'Доступ запрещён'));
        return;
      }
      setShowWikiCategoryModal(false);
      setWikiCategoryName('');
      setWikiCategoryDesc('');
      setWikiCategoryParent('');
      setWikiEditingCategory(null);
      loadWikiData();
    } catch (err) {
      console.error('Ошибка создания категории:', err);
    }
  };

  const wikiUpdateCategory = async () => {
    if (!wikiEditingCategory || !wikiCategoryName.trim()) return;
    try {
      const body = {
        name: wikiCategoryName.trim(),
        description: wikiCategoryDesc.trim(),
        parentId: wikiCategoryParent || null,
        userId: currentUser.id
      };
      if (isAdmin) body.editorIds = wikiCategoryEditorIds;
      const res = await fetch(`${SOCKET_URL}/api/wiki/categories/${wikiEditingCategory.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const err = await res.json();
        alert('Ошибка: ' + (err.error || 'Доступ запрещён'));
        return;
      }
      setShowWikiCategoryModal(false);
      setWikiCategoryName('');
      setWikiCategoryDesc('');
      setWikiCategoryParent('');
      setWikiCategoryEditorIds([]);
      setWikiEditingCategory(null);
      loadWikiData();
    } catch (err) {
      console.error('Ошибка обновления категории:', err);
    }
  };

  const wikiDeleteCategory = async (categoryId) => {
    if (!confirm('Удалить категорию, все подкатегории и все статьи в них?')) return;
    await wikiDeleteCategoryRecursive(categoryId);
    const childIds = getCategoryIds(categoryId);
    if (wikiActiveCategory && childIds.includes(wikiActiveCategory)) {
      setWikiActiveCategory(null);
      setWikiActiveArticle(null);
    }
    loadWikiData();
  };

  // HR / Заявления
  const loadHrRequests = async () => {
    if (!currentUser) return;
    try {
      const res = await fetch(`${SOCKET_URL}/api/hr/requests?userId=${currentUser.id}`);
      if (res.ok) {
        const data = await res.json();
        setHrRequests(data.requests || []);
      }
    } catch (err) {
      console.error('Ошибка загрузки заявлений:', err);
    }
  };

  const handleCreateHrRequest = async () => {
    if (!currentUser || !hrForm.startDate || !hrForm.endDate) return;
    setHrLoading(true);
    try {
      const res = await fetch(`${SOCKET_URL}/api/hr/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...hrForm, userId: currentUser.id })
      });
      if (res.ok) {
        setShowHRCreate(false);
        setHrForm({ type: 'vacation', startDate: '', endDate: '', reason: '' });
        loadHrRequests();
      }
    } catch (err) {
      console.error('Ошибка создания заявления:', err);
    } finally {
      setHrLoading(false);
    }
  };

  const handleApproveHrRequest = async (requestId, status, comment) => {
    if (!currentUser) return;
    try {
      await fetch(`${SOCKET_URL}/api/hr/requests/${requestId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id, status, comment: comment || '' })
      });
      loadHrRequests();
    } catch (err) {
      console.error('Ошибка обработки заявления:', err);
    }
  };

  // Обработчик вставки изображений из буфера обмена (Ctrl+V, Ctrl+Shift+V и т.д.)
  const handleImagePaste = async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    let imageBlob = null;
    let imageType = 'image/png';

    // Ищем изображение в буфере обмена
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        imageBlob = item.getAsFile();
        imageType = item.type;
        break;
      }
    }

    if (!imageBlob) return;

    // Предотвращаем стандартную вставку изображения в contentEditable
    e.preventDefault();

    // Конвертируем Blob в File с именем по умолчанию
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = imageType.split('/')[1] || 'png';
    const fileName = `pasted-image-${timestamp}.${ext}`;
    const pastedFile = new File([imageBlob], fileName, { type: imageType });

    // Устанавливаем как выбранный файл (аналогично прикреплению через кнопку)
    setSelectedFile(pastedFile);

    // Очищаем поле ввода от вставленного изображения
    if (messageInputRef.current) {
      messageInputRef.current.innerHTML = '';
    }
    setInputText('');
  };

  // Drag-and-drop обработчики файлов
  const preventDefault = (e) => e.preventDefault();

  const handleDragOver = (e) => {
    preventDefault(e);
  };

  const handleDragEnter = (e) => {
    preventDefault(e);
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    // Проверяем, что курсор действительно покинул drop-зону
    const relatedTarget = e.relatedTarget;
    if (relatedTarget && e.currentTarget.contains(relatedTarget)) return;
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    preventDefault(e);
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      setSelectedFile(files[0]);
    }
  };

  const handleTyping = (e) => {
    setInputText(e.target.value);

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
  };

  // Функция для конвертации emoji в unified code
  const emojiToUnified = (emoji) => {
    if (!emoji) return '';
    try {
      // Разбиваем emoji на code points и конвертируем в hex
      const codePoints = [...emoji].map(char => {
        const code = char.codePointAt(0);
        // Исключаем variation selectors (FE00-FE0F)
        if (code >= 0xFE00 && code <= 0xFE0F) return null;
        // Исключаем Combining Enclosing Keycap
        if (code === 0x20E3) return null;
        // Исключаем skin tone modifiers
        if (code >= 0x1F3FB && code <= 0x1F3FF) return null;
        return code.toString(16); // lowercase для emoji-datasource
      }).filter(Boolean); // Убираем null значения

      let result = codePoints.join('-');

      // Для символов из диапазонов Miscellaneous Symbols (U+2600–U+26FF)
      // и Dingbats (U+2700–U+27BF), которые не являются полноценными emoji,
      // требуется добавление Variation Selector-16 (-fe0f) для корректного
      // отображения в стиле Apple. Без VS16 файл не существует в CDN.
      if (codePoints.length === 1) {
        const code = parseInt(codePoints[0], 16);
        if ((code >= 0x2600 && code <= 0x26FF) || (code >= 0x2700 && code <= 0x27BF)) {
          result += '-fe0f';
        }
      }

      return result;
    } catch (e) {
      console.warn('Failed to convert emoji to unified:', e);
      return '';
    }
  };

  // Функция для рендеринга emoji как изображения (стиль Apple)
  const renderEmoji = (emoji, className = '', size = 20) => {
    if (!emoji) return null;

    // Конвертируем emoji в unified format
    const unified = emojiToUnified(emoji);
    const emojiUrl = `https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.0.1/img/apple/64/${unified}.png`;

    return (
      <img
        src={emojiUrl}
        alt={emoji}
        className={className}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          display: 'inline-block',
          verticalAlign: 'middle',
          objectFit: 'contain',
        }}
        loading="lazy"
      />
    );
  };

  // Функция для оборачивания эмодзи в тексте в изображения Apple
  const wrapEmojisInText = (text) => {
    if (!text) return text;
    
    // Regex для поиска эмодзи в тексте
    const emojiRegex = /\p{Extended_Pictographic}/gu;
    
    // Заменяем каждый эмодзи на изображение
    const parts = [];
    let lastIndex = 0;
    let match;
    
    // Сбрасываем regex
    emojiRegex.lastIndex = 0;
    
    while ((match = emojiRegex.exec(text)) !== null) {
      // Добавляем текст до эмодзи
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      
      // Конвертируем эмодзи в URL изображения Apple
      const emoji = match[0];
      const unified = emojiToUnified(emoji);
      const emojiUrl = `https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.0.1/img/apple/64/${unified}.png`;
      
      // Добавляем эмодзи как изображение
      parts.push(
        <img
          key={match.index}
          src={emojiUrl}
          alt={emoji}
          className="emoji"
          style={{
            width: 'var(--message-emoji-size, 20px)',
            height: 'var(--message-emoji-size, 20px)',
            verticalAlign: 'middle',
            display: 'inline-block'
          }}
          onError={(e) => {
            // Если изображение не загрузилось, показываем текстовый эмодзи
            console.error('Failed to load emoji image:', emojiUrl);
            e.target.style.display = 'none';
            e.target.parentNode.insertBefore(document.createTextNode(emoji), e.target.nextSibling);
          }}
        />
      );
      
      lastIndex = match.index + match[0].length;
    }
    
    // Добавляем оставшийся текст
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }
    
    return parts.length > 0 ? parts : text;
  };

  const stripStickerMarkers = (text) => {
    if (!text) return text;
    const marker = '\x00STICKER\x00';
    const parts = text.split(marker);
    let result = '';
    for (let i = 0; i < parts.length; i += 2) {
      result += parts[i];
    }
    return result || '🎨 Стикер';
  };

  const stickerUrl = (file) => {
    const parts = file.split('/').map(p => encodeURIComponent(p).replace(/%20/g, ' '));
    const path = '/stickers/' + parts.join('/');
    return SOCKET_URL + path;
  };

  const isStickerOnlyMessage = (text) => {
    if (!text) return false;
    const marker = '\x00STICKER\x00';
    return text.startsWith(marker) && text.endsWith(marker) && text.split(marker).filter(Boolean).length === 1;
  };

  const renderMessageContent = (text) => {
    if (!text) return text;
    const marker = '\x00STICKER\x00';

    // Handle sticker messages
    if (text.includes(marker)) {
      const parts = text.split(marker);
      const result = [];
      let key = 0;
      for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 1) {
          const stickerFile = parts[i];
          result.push(
            <img key={`stk-${key++}`} className="sticker-inline" data-sticker="true"
                 src={stickerUrl(stickerFile)} alt=""
                 style={{ width: 'var(--message-emoji-size, 28px)', height: 'var(--message-emoji-size, 28px)',
                          objectFit: 'contain', verticalAlign: 'middle' }}
                 onError={(e) => { e.target.style.display = 'none'; }} />
          );
        } else if (parts[i]) {
          const wrapped = wrapEmojisInText(parts[i]);
          if (typeof wrapped === 'string') {
            result.push(wrapped);
          } else {
            wrapped.forEach(w => result.push(w));
          }
        }
      }
      return result;
    }

    // Regular text: split by URLs, render text parts normally and URLs as clickable links
    const urlParts = splitTextByUrls(text);
    const elements = [];
    let key = 0;

    for (const part of urlParts) {
      if (part.type === 'url') {
        elements.push(
          <a key={`link-${key++}`} href={part.content} target="_blank" rel="noopener noreferrer" className="message-link-inline">
            {part.content}
          </a>
        );
      } else {
        const wikiLinkRegex = /wiki:\/\/(\S+)/g;
        let lastIdx = 0;
        let match;
        let hasWikiLinks = false;
        const textParts = [];

        while ((match = wikiLinkRegex.exec(part.content)) !== null) {
          hasWikiLinks = true;
          if (match.index > lastIdx) {
            textParts.push(part.content.substring(lastIdx, match.index));
          }
          const articleId = match[1];
          textParts.push({ type: 'wiki', articleId, full: match[0] });
          lastIdx = match.index + match[0].length;
        }
        if (hasWikiLinks) {
          if (lastIdx < part.content.length) {
            textParts.push(part.content.substring(lastIdx));
          }
          for (const tp of textParts) {
            if (typeof tp === 'string') {
              const wrapped = wrapEmojisInText(tp);
              if (typeof wrapped === 'string') {
                elements.push(wrapped);
              } else {
                wrapped.forEach(w => elements.push(w));
              }
            } else if (tp.type === 'wiki') {
              elements.push(
                <span key={`wiki-${key++}`} className="wiki-link-inline" onClick={() => openWikiArticleById(tp.articleId)} title="Открыть в базе знаний">
                  📖 Статья в базе знаний
                </span>
              );
            }
          }
        } else {
          const wrapped = wrapEmojisInText(part.content);
          if (typeof wrapped === 'string') {
            elements.push(wrapped);
          } else {
            wrapped.forEach(w => elements.push(w));
          }
        }
      }
    }

    return elements.length > 0 ? elements : text;
  };

  const renderLinkPreviews = (text) => {
    if (!text) return null;
    const marker = '\x00STICKER\x00';
    // Don't render previews for sticker-only messages
    if (text.startsWith(marker) && text.endsWith(marker)) return null;

    // Strip sticker markers for URL detection in mixed messages
    const cleanText = text.split(marker).filter((_, i) => i % 2 === 0).join('');
    const urls = detectUrls(cleanText);
    if (urls.length === 0) return null;

    const uniqueUrls = [...new Set(urls.map(u => u.url.startsWith('http') ? u.url : `https://${u.url}`))];
    return (
      <div className="message-link-preview-wrapper">
        {uniqueUrls.map((url, i) => (
          <LinkPreviewCard key={`prev-${i}`} url={url} socketUrl={SOCKET_URL} />
        ))}
      </div>
    );
  };

  const handleAddEmoji = (emojiObject) => {
    let isSticker = false;
    let emoji = null;
    let stickerFile = null;

    if (typeof emojiObject === 'string') {
      emoji = emojiObject;
    } else if (emojiObject && typeof emojiObject === 'object') {
      if (emojiObject.type === 'sticker') {
        isSticker = true;
        emoji = emojiObject.emoji;
        stickerFile = emojiObject.file;
      } else {
        emoji = emojiObject.emoji || emojiObject;
      }
    }

    if (!emoji) return;

    if (messageInputRef.current) {

      if (isSticker) {
        const img = document.createElement('img');
        img.src = stickerUrl(stickerFile);
        img.alt = emoji;
        img.className = 'sticker-inline';
        img.style.width = '64px';
        img.style.height = '64px';
        img.style.objectFit = 'contain';
        img.style.verticalAlign = 'middle';
        img.style.display = 'inline-block';
        img.dataset.sticker = 'true';
        img.dataset.file = stickerFile;

        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && messageInputRef.current.contains(sel.anchorNode)) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          range.insertNode(img);
          range.setStartAfter(img);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          messageInputRef.current.appendChild(img);
          messageInputRef.current.focus();
        }
      } else {
        const unified = emojiToUnified(emoji);
        // Обычный эмодзи — как <img> из Apple CDN
        const emojiUrl = `https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.0.1/img/apple/64/${unified}.png`;

        const img = document.createElement('img');
        img.src = emojiUrl;
        img.alt = emoji;
        img.className = 'emoji';
        img.style.width = '20px';
        img.style.height = '20px';
        img.style.verticalAlign = 'middle';
        img.style.display = 'inline-block';
        img.style.margin = '0 2px';

        // Вставляем на позицию курсора (если она внутри contentEditable)
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && messageInputRef.current.contains(sel.anchorNode)) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          range.insertNode(img);
          // Перемещаем caret после вставленного emoji
          range.setStartAfter(img);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          // Fallback: добавляем в конец
          messageInputRef.current.appendChild(img);
          messageInputRef.current.focus();
        }
      }

      // Обновляем inputText с учётом emoji из <img> тегов и стикеров
      setInputText(getMessageText());
    } else {
      // Fallback для обычного input
      setInputText(prev => prev + emoji);
    }
  };

  const handleStickerSend = (stickerObj) => {
    if (!socket || !activeChatId) return;
    const text = '\x00STICKER\x00' + stickerObj.file + '\x00STICKER\x00';
    sendOrQueueMessage({
      chatId: activeChatId,
      text: text,
      replyTo: replyToMessage ? { messageId: replyToMessage.id, text: replyToMessage.text, senderName: replyToMessage.senderName } : null
    });
    setReplyToMessage(null);
  };

  const handleViewUserProfile = async (user) => {
    try {
      const response = await fetch(`${SOCKET_URL}/api/profile/${user.id}`);
      if (response.ok) {
        const data = await response.json();
        setViewUserProfileData(data.user);
      } else {
        setViewUserProfileData(user);
      }
    } catch (err) {
      console.error('Ошибка загрузки профиля:', err);
      setViewUserProfileData(user);
    }
    setViewingUserProfile(true);
  };

  // Загрузка аватара помощника (только для админов)
  const handleUploadHelperAvatar = async (e, helperData) => {
    const file = e.target.files[0];
    if (!file || !currentUser) return;

    const formData = new FormData();
    formData.append('avatar', file);
    formData.append('userId', currentUser.id);

    try {
      const response = await fetch(`${SOCKET_URL}/api/upload-helper-avatar`, {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        const data = await response.json();
        // Обновляем аватар в просмотре профиля
        setViewUserProfileData(prev => ({ ...prev, avatar: data.avatar }));
        // Обновляем аватар в списке чатов
        setChats(prev => prev.map(chat => {
          if (chat.participantsDetails) {
            return {
              ...chat,
              participantsDetails: chat.participantsDetails.map(p =>
                p.id === helperData.id ? { ...p, avatar: data.avatar } : p
              )
            };
          }
          return chat;
        }));
        alert('Аватар помощника успешно обновлён!');
      } else {
        const errorData = await response.json();
        alert(`Ошибка: ${errorData.error || 'Не удалось загрузить аватар'}`);
      }
    } catch (err) {
      console.error('Ошибка загрузки аватара помощника:', err);
      alert('Ошибка соединения с сервером');
    }
  };

  // Загрузка аватара общего чата (только для админов)
  const handleUploadGeneralChatAvatar = async (e) => {
    const file = e.target.files[0];
    if (!file || !currentUser) return;

    const formData = new FormData();
    formData.append('avatar', file);
    formData.append('userId', currentUser.id);

    try {
      const response = await fetch(`${SOCKET_URL}/api/upload-general-chat-avatar`, {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        const data = await response.json();
        // Обновляем аватар в списке чатов
        setChats(prev => prev.map(chat => {
          if (chat.id === 'general') {
            return { ...chat, avatar: data.avatar };
          }
          return chat;
        }));
        // Обновляем активный чат если это общий чат
        if (activeChat?.id === 'general') {
          setActiveChat(prev => ({ ...prev, avatar: data.avatar }));
        }
        alert('Аватар общего чата успешно обновлён!');
      } else {
        const errorData = await response.json();
        alert(`Ошибка: ${errorData.error || 'Не удалось загрузить аватар'}`);
      }
    } catch (err) {
      console.error('Ошибка загрузки аватара общего чата:', err);
      alert('Ошибка соединения с сервером');
    }
  };

  // Загрузка аватара группового чата (любой участник)
  const handleUploadGroupChatAvatar = async (e, chatId) => {
    const file = e.target.files[0];
    if (!file || !currentUser) return;

    const formData = new FormData();
    formData.append('avatar', file);
    formData.append('chatId', chatId);
    formData.append('userId', currentUser.id);

    try {
      const response = await fetch(`${SOCKET_URL}/api/upload-group-chat-avatar`, {
        method: 'POST',
        body: formData
      });
      if (!response.ok) {
        const err = await response.json();
        alert('Ошибка: ' + (err.error || 'Не удалось загрузить аватар'));
      }
    } catch (err) {
      console.error('Ошибка загрузки аватара группы:', err);
      alert('Ошибка соединения с сервером');
    }
  };

  // Открытие аватара в полном размере
  const handleOpenAvatar = (avatarSrc, userName) => {
    if (avatarSrc && avatarSrc.startsWith('http')) {
      setAvatarUrl(avatarSrc);
      setShowAvatarModal(true);
    }
  };

  // Открытие контекстного меню сообщения
  const handleContextMenu = (e, messageId, messageText, chatId, senderId, senderName) => {
    e.preventDefault();

    if (!messageId) {
      console.warn('Контекстное меню не открыто: отсутствует ID сообщения');
      return;
    }

    // Размеры окна и примерные размеры меню
    const menuWidth = 200;
    const menuHeight = 350;
    const margin = 8;

    let x = e.clientX;
    let y = e.clientY;

    // Корректировка, чтобы меню не выходило за правую границу
    if (x + menuWidth > window.innerWidth - margin) {
      x = window.innerWidth - menuWidth - margin;
    }
    // Корректировка, чтобы меню не выходило за левую границу
    if (x < margin) {
      x = margin;
    }
    // Корректировка, чтобы меню не выходило за нижнюю границу
    if (y + menuHeight > window.innerHeight - margin) {
      y = window.innerHeight - menuHeight - margin;
    }
    // Корректировка, чтобы меню не выходило за верхнюю границу
    if (y < margin) {
      y = margin;
    }

    setContextMenu({
      visible: true,
      x,
      y,
      messageId,
      messageText,
      messageChatId: chatId,
      messageSenderId: senderId,
      messageSenderName: senderName || '',
      reactionsExpanded: false,
    });
  };

  // Закрытие контекстного меню
  const closeContextMenu = () => {
    setContextMenu({ visible: false, x: 0, y: 0, messageId: null, messageText: '', messageChatId: null, messageSenderId: null, reactionsExpanded: false });
  };

  /** Переключатель развёрнутого состояния реакций */
  const toggleReactionsExpand = useCallback(() => {
    setContextMenu(prev => ({ ...prev, reactionsExpanded: !prev.reactionsExpanded }));
  }, []);

  // Открытие контекстного меню поля ввода
  const handleInputContextMenu = (e) => {
    e.preventDefault();
    
    const menuWidth = 180;
    const menuHeight = 140;
    const margin = 8;

    let x = e.clientX;
    let y = e.clientY;

    if (x + menuWidth > window.innerWidth - margin) {
      x = window.innerWidth - menuWidth - margin;
    }
    if (x < margin) {
      x = margin;
    }
    if (y + menuHeight > window.innerHeight - margin) {
      y = window.innerHeight - menuHeight - margin;
    }
    if (y < margin) {
      y = margin;
    }

    setInputContextMenu({
      visible: true,
      x,
      y
    });
  };

  // Закрытие контекстного меню поля ввода
  const closeInputContextMenu = () => {
    setInputContextMenu({ ...inputContextMenu, visible: false });
  };

  // Закрытие контекстного меню при клике вне его и поля ввода
  useEffect(() => {
    if (!inputContextMenu.visible) return;

    const handleMouseDown = (e) => {
      const menuEl = document.querySelector('.input-context-menu');
      if (!menuEl) return;

      const isInsideInput = messageInputRef.current && messageInputRef.current.contains(e.target);
      const isInsideMenu = menuEl.contains(e.target);

      if (!isInsideInput && !isInsideMenu) {
        closeInputContextMenu();
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [inputContextMenu.visible]);

  // === ОТВЕТ НА СООБЩЕНИЕ (REPLY) ===

  // Открыть ответ на сообщение
  const openReply = (messageId, messageText, senderName) => {
    setReplyToMessage({
      id: messageId,
      text: (messageText || '').substring(0, 300),
      senderName: senderName || ''
    });
    closeContextMenu();
    setTimeout(() => {
      if (messageInputRef.current) {
        messageInputRef.current.focus();
      }
    }, 100);
  };

  // Отменить ответ
  const cancelReply = () => {
    setReplyToMessage(null);
  };

  // === INLINE РЕДАКТИРОВАНИЕ СООБЩЕНИЯ (как reply) ===

  // Открыть inline-редактирование сообщения
  const openEditMessage = (messageId, messageText, senderName) => {
    setEditingMessage(messageId);
    setIsEditMode(true);
    closeContextMenu();
    
    setInputText('');
    if (messageInputRef.current) {
      messageInputRef.current.innerHTML = (messageText || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      messageInputRef.current?.focus();
    }
  };

  // Отменить редактирование сообщения
  const cancelEditMessage = () => {
    setEditingMessage(null);
    setIsEditMode(false);
    setInputText('');
    if (messageInputRef.current) {
      messageInputRef.current.innerHTML = '';
    }
  };

  // === ОБРАБОТКА РЕАКЦИЙ ===

  // Добавить или удалить реакцию
  const handleAddReaction = (emoji, messageId, rect) => {
    if (!socket) {
      console.error('Сокет не подключён!');
      return;
    }

    // Отправляем реакцию на сервер
    socket.emit('add_reaction', {
      messageId,
      emoji
    });

    // Закрываем контекстное меню
    closeContextMenu();

    // Запускаем частицы если есть позиция
    if (rect) {
      spawnReactionParticles(emoji, rect, messageId);
    }
  };

  // Удалить реакцию текущего пользователя
  const handleRemoveReaction = (emoji, messageId) => {
    if (!socket) return;

    socket.emit('remove_reaction', {
      messageId,
      emoji
    });
  };

  /** Запуск частиц реакции из контекста */
  const reactionParticles = useReactionParticles();

  /** Найти бейдж реакции в DOM и вернуть его rect */
  function findReactionBadgeRect(messageId) {
    try {
      const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
      if (messageEl) {
        const reactionBadge = messageEl.querySelector('.reaction-badge-inline');
        if (reactionBadge) {
          return reactionBadge.getBoundingClientRect();
        }
      }
    } catch (err) {
      console.warn('[App] Ошибка при поиске бейджа реакции:', err);
    }
    return null;
  }

  /** Запуск частиц с гарантированным ожиданием DOM-ререндера */
  function spawnReactionParticles(emoji, startRect, messageId) {
    console.log('[App] spawnReactionParticles:', emoji, 'startRect:', startRect, 'messageId:', messageId);

    // Если startRect невалиден — ничего не делаем
    if (!startRect || !startRect.width || !startRect.height) {
      console.warn('[App] spawnReactionParticles: invalid startRect, skipping');
      return;
    }

    /** Пытаемся найти endRect, с retry через rAF если не нашли */
    function trySpawn(endRect, attempt = 0) {
      // Если бейдж всё ещё не найден и это первая попытка — пробуем ещё раз через rAF
      if (!endRect && attempt < 3) {
        console.log(`[App] spawnReactionParticles: badge not found, retry ${attempt + 1}/3`);
        requestAnimationFrame(() => {
          setTimeout(() => {
            const nextEndRect = findReactionBadgeRect(messageId);
            trySpawn(nextEndRect, attempt + 1);
          }, 50); // небольшой запас после rAF для гарантированного layout
        });
        return;
      }

      // Если так и не нашли — fallback на startRect (анимация "разлетись-вернись")
      const finalEndRect = endRect || startRect;

      console.log('[App] spawnReactionParticles: spawning with', {
        emoji,
        startRect,
        endRect: finalEndRect,
      });

      reactionParticles.spawn?.(emoji, startRect, finalEndRect);
    }

    // Первая попытка — сразу (бейдж может уже существовать)
    const initialEndRect = findReactionBadgeRect(messageId);
    trySpawn(initialEndRect, 0);
  }

  // Копирование сообщения
  const handleCopyMessage = () => {
    if (contextMenu.messageText) {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = contextMenu.messageText;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      } catch (err) {
        console.warn('Не удалось скопировать текст:', err);
      }
    }
    closeContextMenu();
  };

  // Вырезание текста из поля ввода
  const handleCutText = async () => {
    try {
      // Получаем выделенный текст
      const selection = window.getSelection();
      if (!selection || !selection.toString()) {
        console.warn('Нет выделенного текста');
        closeInputContextMenu();
        return;
      }

      const selectedText = selection.toString();

      // Копируем в буфер обмена
      await navigator.clipboard.writeText(selectedText);

      // Удаляем выделенный текст
      document.execCommand('delete');

      console.log('Текст вырезан');
    } catch (err) {
      console.warn('Не удалось вырезать текст:', err);
    }
    closeInputContextMenu();
  };

  // Копирование текста из поля ввода
  const handleCopyText = async () => {
    try {
      const selection = window.getSelection();
      if (!selection || !selection.toString()) {
        console.warn('Нет выделенного текста');
        closeInputContextMenu();
        return;
      }

      const selectedText = selection.toString();
      await navigator.clipboard.writeText(selectedText);
      console.log('Текст скопирован');
    } catch (err) {
      console.warn('Не удалось скопировать текст:', err);
    }
    closeInputContextMenu();
  };

  // Вставка текста в поле ввода
  const handlePasteText = async () => {
    try {
      const text = await navigator.clipboard.readText();
      
      // Вставляем текст в позицию курсора
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;

      const range = selection.getRangeAt(0);
      range.deleteContents();
      const textNode = document.createTextNode(text);
      range.insertNode(textNode);

      // Перемещаем курсор после вставленного текста
      range.setStartAfter(textNode);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);

      // Обновляем состояние inputText
      if (messageInputRef.current) {
        const newText = messageInputRef.current.textContent;
        setInputText(newText);
      }

      console.log('Текст вставлен');
    } catch (err) {
      console.warn('Не удалось вставить текст:', err);
    }
    closeInputContextMenu();
  };

  // Редактирование сообщения
  const handleEditMessage = () => {
    if (!contextMenu.messageText || !contextMenu.messageId) return;
    
    // Проверяем, что это сообщение текущего пользователя
    if (contextMenu.messageSenderId !== currentUser?.id) {
      alert('Вы можете редактировать только свои сообщения');
      return;
    }
    
    setEditMessageText(contextMenu.messageText);
    setEditMessageId(contextMenu.messageId);
    setShowEditModal(true);
    closeContextMenu();
  };

  // Сохранение отредактированного сообщения
  const handleSaveEditMessage = () => {
    if (!socket || !editMessageId || !editMessageText.trim()) return;
    
    socket.emit('edit_message', {
      messageId: editMessageId,
      newText: editMessageText.trim()
    });
    
    setShowEditModal(false);
    setEditMessageText('');
    setEditMessageId(null);
  };

  // Отмена редактирования
  const handleCancelEdit = () => {
    setShowEditModal(false);
    setEditMessageText('');
    setEditMessageId(null);
  };

  // Отправка пересланного сообщения
  const handleSendForwardedMessage = () => {
    if (!selectedForwardUser || !contextMenu.messageId) {
      console.error('Нет получателя или messageId:', { selectedForwardUser, contextMessageId: contextMenu.messageId });
      return;
    }

    if (!socket) {
      console.error('Сокет не подключён!');
      return;
    }

    if (!socket.connected) {
      console.error('Сокет не подключён (connected=false)!');
      return;
    }

    console.log('Пересылка сообщения:', {
      messageId: contextMenu.messageId,
      targetUserId: selectedForwardUser.id,
      targetUsername: selectedForwardUser.username
    });

    // Эмитим событие пересылки сообщения
    socket.emit('forward_message', {
      messageId: contextMenu.messageId,
      targetUserId: selectedForwardUser.id,
      targetChatId: null // Сервер сам определит чат
    });

    setShowForwardModal(false);
    setForwardSearchQuery('');
    setSelectedForwardUser(null);
  };

  // Отправка статьи из базы знаний пользователю
  const handleSendWikiShare = () => {
    if (!selectedWikiShareUser || !wikiShareArticle || !socket) return;
    socket.emit('wiki_share', {
      articleId: wikiShareArticle.id,
      articleTitle: wikiShareArticle.title,
      targetUserId: selectedWikiShareUser.id
    });
    setShowWikiShareModal(false);
    setWikiShareSearchQuery('');
    setSelectedWikiShareUser(null);
    setWikiShareArticle(null);
  };

  // Пересылка сообщения из меню правой кнопки мыши
  const handleForwardMessage = (message) => {
    if (!message || !message.id) {
      alert('Ошибка: нет сообщения для пересылки');
      return;
    }

    // Устанавливаем messageId в contextMenu для использования в handleSendForwardedMessage
    setContextMenu({ ...contextMenu, messageId: message.id, messageText: message.text, visible: false });
    setShowForwardModal(true);
    setForwardSearchQuery('');
    setSelectedForwardUser(null);
  };

  const handleViewProfileBySender = async (senderName, senderAvatar) => {
    // Ищем пользователя по имени в списке пользователей
    const user = users.find(u => u.username === senderName);
    if (user) {
      handleViewUserProfile(user);
    } else {
      // Если не нашли в списке, используем базовые данные
      setViewUserProfileData({
        username: senderName,
        avatar: senderAvatar,
        full_name: null,
        email: null,
        birth_date: null,
        about: null
      });
      setViewingUserProfile(true);
    }
  };

  const handleChatTitleClick = (chat) => {
    // Для личных чатов показываем профиль другого пользователя
    if (chat.type === 'direct' && chat.participantsDetails) {
      const otherUser = chat.participantsDetails.find(p => p.username !== currentUser?.username);
      if (otherUser) {
        handleViewUserProfile({
          id: otherUser.id,
          username: otherUser.username,
          avatar: otherUser.avatar,
          status: otherUser.status
        });
      }
    }
  };

  // Функции календаря
  const fetchCalendarTasks = async (startDate, endDate) => {
    if (!currentUser) return;

    try {
      // Форматируем даты в локальном формате YYYY-MM-DD
      const formatDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      const params = new URLSearchParams({
        userId: currentUser.id,
        startDate: formatDate(startDate),
        endDate: formatDate(endDate)
      });
      const response = await fetch(`${SOCKET_URL}/api/calendar/tasks?${params}`);
      if (response.ok) {
        const data = await response.json();
        setCalendarTasks(data.tasks);

        // Обновляем задачи для выбранного дня
        if (selectedDate) {
          const dateStr = formatDate(selectedDate);
          const newTasks = data.tasks.filter(t => t.task_date === dateStr);
          setSelectedDayTasks(newTasks.sort((a, b) => {
            const timeA = a.task_time || '00:00';
            const timeB = b.task_time || '00:00';
            return timeA.localeCompare(timeB);
          }));
        }
      }
    } catch (err) {
      console.error('Ошибка загрузки задач:', err);
    }
  };

  // Загрузка бронирований переговорной
  const fetchMeetingRoomBookings = async (startDate, endDate) => {
    try {
      const formatDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      const params = new URLSearchParams({
        startDate: formatDate(startDate),
        endDate: formatDate(endDate)
      });
      const response = await fetch(`${SOCKET_URL}/api/meeting-room/bookings?${params}`);
      if (response.ok) {
        const data = await response.json();
        setMeetingRoomBookings(data.bookings);
      }
    } catch (err) {
      console.error('Ошибка загрузки бронирований:', err);
    }
  };

  // Редактирование бронирования
  const handleEditBooking = (booking) => {
    setEditingBooking(booking);
    setMeetingForm({
      title: booking.title,
      description: booking.description || '',
      meetingDate: booking.meeting_date,
      startTime: booking.start_time,
      endTime: booking.end_time,
      organizer: booking.organizer_name,
      reminderMinutes: booking.reminder_minutes ? String(booking.reminder_minutes) : ''
    });
    setSelectedMeetingParticipants((booking.participants_list || []).map(p => p.user_id));
    setParticipantSearchText('');
    fetchAvailableUsers();
    setShowEditMeetingModal(true);
  };

  // Удаление бронирования
  const handleDeleteBooking = async (bookingId) => {
    if (!confirm('Вы уверены, что хотите удалить это бронирование?')) return;

    try {
      const response = await fetch(`${SOCKET_URL}/api/meeting-room/bookings/${bookingId}?adminId=${currentUser.id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        // Обновляем список бронирований
        const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
        const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
        fetchMeetingRoomBookings(startOfMonth, endOfMonth);
        alert('Бронирование удалено!');
      } else {
        const data = await response.json();
        alert(data.error || 'Ошибка при удалении');
      }
    } catch (err) {
      console.error('Ошибка удаления:', err);
      alert('Ошибка сервера');
    }
  };

  // Обновление бронирования
  const handleUpdateBooking = async (e) => {
    e.preventDefault();

    try {
      const response = await fetch(`${SOCKET_URL}/api/meeting-room/bookings/${editingBooking.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: meetingForm.title,
          description: meetingForm.description,
          meetingDate: meetingForm.meetingDate,
          startTime: meetingForm.startTime,
          endTime: meetingForm.endTime,
          participants: selectedMeetingParticipants,
          reminderMinutes: meetingForm.reminderMinutes || null
        })
      });

      if (response.ok) {
        // Обновляем список бронирований
        const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
        const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
        fetchMeetingRoomBookings(startOfMonth, endOfMonth);

        setMeetingForm({
          title: '',
          description: '',
          meetingDate: '',
          startTime: '',
          endTime: '',
          organizer: '',
          reminderMinutes: '15'
        });
        setSelectedMeetingParticipants([]);
        setParticipantSearchText('');
        setEditingBooking(null);
        setShowEditMeetingModal(false);
        alert('Бронирование обновлено!');
      } else {
        const data = await response.json();
        alert(data.error || 'Ошибка при обновлении');
      }
    } catch (err) {
      console.error('Ошибка обновления:', err);
      alert('Ошибка сервера');
    }
  };

  const handlePrevMonth = () => {
    const newMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
    setCurrentMonth(newMonth);
    setSelectedDate(null);
    setSelectedDayTasks([]);
    const startOfMonth = new Date(newMonth.getFullYear(), newMonth.getMonth(), 1);
    const endOfMonth = new Date(newMonth.getFullYear(), newMonth.getMonth() + 1, 0);
    fetchCalendarTasks(startOfMonth, endOfMonth);
    fetchMeetingRoomBookings(startOfMonth, endOfMonth);
  };

  const handleNextMonth = () => {
    const newMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    setCurrentMonth(newMonth);
    setSelectedDate(null);
    setSelectedDayTasks([]);
    const startOfMonth = new Date(newMonth.getFullYear(), newMonth.getMonth(), 1);
    const endOfMonth = new Date(newMonth.getFullYear(), newMonth.getMonth() + 1, 0);
    fetchCalendarTasks(startOfMonth, endOfMonth);
    fetchMeetingRoomBookings(startOfMonth, endOfMonth);
  };

  const handleDateClick = (date) => {
    setSelectedDate(date);
    // Форматируем дату в локальном формате YYYY-MM-DD
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    
    const dayTasks = calendarTasks.filter(t => t.task_date === dateStr);
    setSelectedDayTasks(dayTasks.sort((a, b) => {
      const timeA = a.task_time || '00:00';
      const timeB = b.task_time || '00:00';
      return timeA.localeCompare(timeB);
    }));
  };

  const handleOpenNewTaskModal = () => {
    const date = selectedDate || new Date();
    // Форматируем дату в локальном формате YYYY-MM-DD
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    setTaskForm({
      title: '',
      description: '',
      taskDate: dateStr,
      taskTime: '',
      taskEndTime: '',
      color: '#667eea'
    });
    setEditingTask(null);
    setShowTaskModal(true);
  };

  const handleCreateTask = async (e) => {
    e.preventDefault();
    if (!currentUser || !taskForm.title || !taskForm.taskDate) return;

    try {
      const response = await fetch(`${SOCKET_URL}/api/calendar/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          ...taskForm
        })
      });

      if (response.ok) {
        setShowTaskModal(false);
        const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
        const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
        fetchCalendarTasks(startOfMonth, endOfMonth);
      }
    } catch (err) {
      console.error('Ошибка создания задачи:', err);
    }
  };

  const handleUpdateTask = async (e) => {
    e.preventDefault();
    if (!editingTask) return;

    try {
      const response = await fetch(`${SOCKET_URL}/api/calendar/tasks/${editingTask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskForm)
      });

      if (response.ok) {
        setShowTaskModal(false);
        const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
        const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
        fetchCalendarTasks(startOfMonth, endOfMonth);
      }
    } catch (err) {
      console.error('Ошибка обновления задачи:', err);
    }
  };

  const handleEditTask = (task) => {
    setEditingTask(task);
    setTaskForm({
      title: task.title,
      description: task.description || '',
      taskDate: task.task_date,
      taskTime: task.task_time || '',
      taskEndTime: task.task_end_time || '',
      color: task.color
    });
    setShowTaskModal(true);
  };

  const handleDeleteTask = async (taskId) => {
    if (!confirm('Удалить эту задачу?')) return;

    try {
      const response = await fetch(`${SOCKET_URL}/api/calendar/tasks/${taskId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setShowTaskModal(false);
        const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
        const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
        fetchCalendarTasks(startOfMonth, endOfMonth);
      }
    } catch (err) {
      console.error('Ошибка удаления задачи:', err);
    }
  };

  // Обмен задачами
  const handleShareTask = (task) => {
    setTaskToShare(task);
    setShowShareTaskModal(true);
    fetchAvailableUsers();
  };

  const fetchAvailableUsers = async () => {
    try {
      const response = await fetch(`${SOCKET_URL}/api/users`);
      if (response.ok) {
        const data = await response.json();
        setAvailableUsers(data.users.filter(u => u.id !== currentUser?.id));
      }
    } catch (err) {
      console.error('Ошибка получения пользователей:', err);
    }
  };

  const fetchUsersList = async () => {
    try {
      const response = await fetch(`${SOCKET_URL}/api/users`);
      if (response.ok) {
        const data = await response.json();
        if (currentUser) {
          setUsers(data.users.filter(u => u.id !== currentUser.id));
        } else {
          setUsers(data.users);
        }
      }
    } catch (err) {
      console.error('Ошибка загрузки пользователей:', err);
    }
  };

  const toggleUserForShare = (userId) => {
    setSelectedUsersForShare(prev =>
      prev.find(id => id === userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const toggleDraftParticipant = (userId) => {
    setDraftParticipants(prev =>
      prev.find(id => id === userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const handleOpenParticipantModal = () => {
    setDraftParticipants([...selectedMeetingParticipants]);
    setParticipantSearchText('');
    setShowParticipantModal(true);
  };

  const handleCloseParticipantModal = () => {
    setShowParticipantModal(false);
    setDraftParticipants([]);
  };

  const handleConfirmParticipants = () => {
    setSelectedMeetingParticipants([...draftParticipants]);
    setShowParticipantModal(false);
  };

  const handleSelectAllParticipants = () => {
    const allIds = availableUsers
      .filter(u => u.id !== currentUser?.id)
      .map(u => u.id);
    setDraftParticipants(allIds);
  };

  const handleDeselectAllParticipants = () => {
    setDraftParticipants([]);
  };

  const confirmShareTask = async () => {
    if (!taskToShare || selectedUsersForShare.length === 0 || !currentUser) return;

    try {
      const response = await fetch(`${SOCKET_URL}/api/calendar/tasks/${taskToShare.id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromUserId: currentUser.id,
          toUserIds: selectedUsersForShare
        })
      });

      if (response.ok) {
        setShowShareTaskModal(false);
        setTaskToShare(null);
        setSelectedUsersForShare([]);
      }
    } catch (err) {
      console.error('Ошибка отправки задачи:', err);
    }
  };

  const fetchSharedTasksReceived = async () => {
    if (!currentUser) return;

    try {
      const response = await fetch(`${SOCKET_URL}/api/calendar/tasks/shared/received?userId=${currentUser.id}`);
      if (response.ok) {
        const data = await response.json();
        setSharedTasksReceived(data.shares);
      }
    } catch (err) {
      console.error('Ошибка получения задач:', err);
    }
  };

  const handleAcceptSharedTask = async (shareId) => {
    if (!currentUser) return;

    console.log('Принятие задачи:', { shareId, userId: currentUser.id });

    try {
      const response = await fetch(`${SOCKET_URL}/api/calendar/tasks/shared/${shareId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id })
      });

      console.log('Ответ сервера:', response.status);
      const data = await response.json();
      console.log('Данные ответа:', data);

      if (response.ok) {
        console.log('Задача принята успешно');
        // Обновляем список полученных задач
        fetchSharedTasksReceived();
        // Обновляем задачи в календаре
        const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
        const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
        fetchCalendarTasks(startOfMonth, endOfMonth);
      } else {
        console.error('Ошибка сервера:', data);
      }
    } catch (err) {
      console.error('Ошибка принятия задачи:', err);
    }
  };

  const handleDeclineSharedTask = async (shareId) => {
    if (!currentUser) return;

    console.log('Отклонение задачи:', { shareId, userId: currentUser.id });

    try {
      const response = await fetch(`${SOCKET_URL}/api/calendar/tasks/shared/${shareId}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id })
      });

      console.log('Ответ сервера:', response.status);
      const data = await response.json();
      console.log('Данные ответа:', data);

      if (response.ok) {
        console.log('Задача отклонена успешно');
        fetchSharedTasksReceived();
      } else {
        console.error('Ошибка сервера:', data);
      }
    } catch (err) {
      console.error('Ошибка отклонения задачи:', err);
    }
  };

  // Обработчики для модального окна уведомлений
  const handleAcceptSharedTaskInNotifications = async (shareId) => {
    if (!currentUser) return;

    // Сначала добавляем задачу в список исчезающих для анимации
    setDisappearingTasks(prev => [...prev, shareId]);
    
    // Ждем завершения анимации (300мс)
    await new Promise(resolve => setTimeout(resolve, 300));

    try {
      const response = await fetch(`${SOCKET_URL}/api/calendar/tasks/shared/${shareId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id })
      });

      if (response.ok) {
        // Сначала обновляем список полученных задач
        await fetchSharedTasksReceived();

        // Затем обновляем задачи в календаре
        const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
        const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
        await fetchCalendarTasks(startOfMonth, endOfMonth);

        // Обновляем уведомления
        await getUpcomingNotifications();

        console.log('Задача принята и обновлена в календаре');
      }
    } catch (err) {
      console.error('Ошибка принятия задачи:', err);
    } finally {
      // Очищаем список исчезающих задач
      setDisappearingTasks([]);
    }
  };

  const handleDeclineSharedTaskInNotifications = async (shareId) => {
    if (!currentUser) return;

    // Сначала добавляем задачу в список исчезающих для анимации
    setDisappearingTasks(prev => [...prev, shareId]);
    
    // Ждем завершения анимации (300мс)
    await new Promise(resolve => setTimeout(resolve, 300));

    try {
      const response = await fetch(`${SOCKET_URL}/api/calendar/tasks/shared/${shareId}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id })
      });

      if (response.ok) {
        // Сначала обновляем список полученных задач
        await fetchSharedTasksReceived();

        // Обновляем уведомления
        await getUpcomingNotifications();

        console.log('Задача отклонена');
      }
    } catch (err) {
      console.error('Ошибка отклонения задачи:', err);
    } finally {
      // Очищаем список исчезающих задач
      setDisappearingTasks([]);
    }
  };

  // Функции меню чата
  const handleOpenChatMenu = (e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setChatMenuPosition({
      top: rect.bottom + 8,
      right: window.innerWidth - rect.right
    });
    setShowChatMenu(true);
  };

  const handleViewUserInfo = () => {
    if (activeChat && activeChat.type === 'direct' && activeChat.participantsDetails) {
      const otherUser = activeChat.participantsDetails.find(p => p.username !== currentUser?.username);
      if (otherUser) {
        handleViewUserProfile({
          id: otherUser.id,
          username: otherUser.username,
          avatar: otherUser.avatar,
          status: otherUser.status
        });
      }
    }
    setShowChatMenu(false);
  };

  const handleViewMedia = () => {
    setShowMediaViewer(true);
    setShowChatMenu(false);
  };

  const handleViewDocuments = () => {
    // Собираем все документы из сообщений чата
    if (activeChat && messages.length > 0) {
      const docs = messages
        .filter(msg => msg.file && msg.file.url)
        .filter(msg => {
          const mimetype = msg.file.mimetype || '';
          const filename = msg.file.filename || '';
          // Фильтруем по типам документов
          const documentTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'text/plain',
            'text/csv',
            'application/rtf',
            'application/x-rtf'
          ];
          const isDocument = documentTypes.some(type => mimetype.includes(type));
          const isTextFile = filename.match(/\.(txt|doc|docx|pdf|xls|xlsx|ppt|pptx|csv|rtf)$/i);
          return isDocument || isTextFile;
        })
        .map(msg => ({
          id: msg.id,
          filename: msg.file.filename,
          url: msg.file.url,
          mimetype: msg.file.mimetype,
          size: msg.file.size,
          timestamp: msg.timestamp,
          senderName: msg.senderName
        }))
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      setChatDocuments(docs);
    } else {
      setChatDocuments([]);
    }
    setShowDocuments(true);
    setShowChatMenu(false);
  };

  const handleToggleE2EE = async () => {
    if (!activeChatId) return;
    const newVal = !e2eeEnabled[activeChatId];
    setE2eeEnabled(prev => ({ ...prev, [activeChatId]: newVal }));
    if (newVal && activeChat?.type === 'group' && myKeyPairRef.current) {
      try {
        const participants = activeChat.participantsDetails?.filter(p => p.username !== currentUser?.username) || [];
        if (participants.length === 0) return;
        const groupKey = await generateGroupKey();
        const keys = [];
        for (const p of participants) {
          const pubKeyB64 = await getPeerPublicKey(p.id);
          if (!pubKeyB64) continue;
          const result = await encryptGroupKeyForMember(groupKey, myKeyPairRef.current.privateKey, pubKeyB64);
          if (result) {
            keys.push({
              userId: p.id,
              encryptedKey: JSON.stringify({
                encryptedKey: result.encryptedKey,
                nonce: result.nonce,
                encryptedBy: currentUser.id
              })
            });
          }
        }
        if (keys.length > 0) {
          await fetch(`${SOCKET_URL}/api/e2ee/group-key`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId: activeChatId, keys })
          });
          cacheGroupKey(activeChatId, groupKey);
        }
      } catch (err) {
        console.error('[E2EE] group key init error:', err);
        setE2eeEnabled(prev => ({ ...prev, [activeChatId]: false }));
      }
    }
    setShowChatMenu(false);
  };

  const handleDeleteMessage = (message) => {
    setMessageToDelete(message);
    setShowDeleteConfirm(true);
    setShowChatMenu(false);
  };

  // Закрепление сообщения
  const handlePinMessage = (messageId) => {
    if (!socket) {
      console.error('handlePinMessage: socket не подключён');
      alert('Невозможно закрепить сообщение: нет подключения к серверу');
      return;
    }
    if (!messageId) {
      console.error('handlePinMessage: messageId не передан');
      alert('Невозможно закрепить сообщение: отсутствует ID сообщения');
      return;
    }
    socket.emit('pin_message', { messageId });
  };

  // Открепление сообщения
  const handleUnpinMessage = (messageId) => {
    if (!socket) {
      console.error('handleUnpinMessage: socket не подключён');
      alert('Невозможно открепить сообщение: нет подключения к серверу');
      return;
    }
    if (!messageId) {
      console.error('handleUnpinMessage: messageId не передан');
      alert('Невозможно открепить сообщение: отсутствует ID сообщения');
      return;
    }
    socket.emit('unpin_message', { messageId });
  };

  // Открытие панели закреплённых сообщений
  const handleOpenPinnedModal = () => {
    setShowPinnedModal(true);
  };

  const confirmDeleteMessage = async () => {
    if (!messageToDelete) return;

    // Валидация: проверяем что messageToDelete.id и currentUser.id определены
    if (!messageToDelete?.id) {
      alert('Невозможно удалить сообщение: отсутствует ID сообщения');
      setShowDeleteConfirm(false);
      setMessageToDelete(null);
      return;
    }
    if (!currentUser?.id) {
      alert('Невозможно удалить сообщение: пользователь не авторизован');
      setShowDeleteConfirm(false);
      setMessageToDelete(null);
      return;
    }

    try {
      const response = await fetch(`${SOCKET_URL}/api/admin/messages/${messageToDelete.id}?userId=${currentUser.id}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Ошибка удаления сообщения:', errorData.error);
        alert('Ошибка: ' + (errorData.error || 'Не удалось удалить сообщение'));
      }
      // Сообщение будет удалено из списка через socket событие message_deleted
    } catch (err) {
      console.error('Ошибка удаления сообщения:', err);
      alert('Ошибка при удалении сообщения');
    } finally {
      setShowDeleteConfirm(false);
      setMessageToDelete(null);
    }
  };

  const handleDeleteChat = () => {
    setShowDeleteConfirm(true);
    setShowChatMenu(false);
  };

  const confirmDeleteChat = async () => {
    if (!activeChat) return;

    try {
      const response = await fetch(`${SOCKET_URL}/api/chats/${activeChat.id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setChats(prev => prev.filter(c => c.id !== activeChat.id));
        setActiveChatId(null);
        setMessages([]);
      }
    } catch (err) {
      console.error('Ошибка удаления чата:', err);
    } finally {
      setShowDeleteConfirm(false);
    }
  };

  // Управление участниками группы
  const handleManageParticipants = () => {
    setShowManageParticipants(true);
    setShowChatMenu(false);
  };

  const handleRemoveParticipant = async (targetUserId) => {
    if (!activeChat || !currentUser) return;
    try {
      const resp = await fetch(`${SOCKET_URL}/api/chats/${activeChat.id}/participants/${targetUserId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requesterId: currentUser.id })
      });
      if (resp.ok) {
        setChats(prev => prev.map(chat => {
          if (chat.id !== activeChat.id || !chat.participantsDetails) return chat;
          return {
            ...chat,
            participantsDetails: chat.participantsDetails.filter(p => p.id !== targetUserId),
            participants: chat.participantsDetails.filter(p => p.id !== targetUserId).map(p => p.username)
          };
        }));
      } else {
        const err = await resp.json();
        alert(err.error || 'Ошибка удаления участника');
      }
    } catch (err) {
      console.error('Ошибка удаления участника:', err);
    }
  };

  // Выход из группы
  const handleLeaveGroup = () => {
    setShowLeaveConfirm(true);
    setShowChatMenu(false);
  };

  const confirmLeaveGroup = async () => {
    if (!activeChat || !currentUser) return;
    try {
      const resp = await fetch(`${SOCKET_URL}/api/chats/${activeChat.id}/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id })
      });
      if (resp.ok) {
        setChats(prev => prev.filter(c => c.id !== activeChat.id));
        setActiveChatId(null);
        setMessages([]);
      } else {
        const err = await resp.json();
        alert(err.error || 'Ошибка выхода из группы');
      }
    } catch (err) {
      console.error('Ошибка выхода из группы:', err);
    } finally {
      setShowLeaveConfirm(false);
    }
  };

  // Добавление участника в группу
  const handleAddParticipant = async (targetUserId) => {
    if (!activeChat || !currentUser) return;
    try {
      const resp = await fetch(`${SOCKET_URL}/api/chats/${activeChat.id}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: targetUserId, requesterId: currentUser.id })
      });
      if (resp.ok) {
        const data = await resp.json();
        setChats(prev => prev.map(chat => {
          if (chat.id !== activeChat.id) return chat;
          return data.chat;
        }));
        setShowAddParticipant(false);
        setParticipantSearch('');
      } else {
        const err = await resp.json();
        alert(err.error || 'Ошибка добавления участника');
      }
    } catch (err) {
      console.error('Ошибка добавления участника:', err);
    }
  };

  const handleMessageMenuClick = (e, message) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setMessageMenuPosition({
      top: rect.bottom + 8,
      left: rect.right - 150
    });
    setSelectedMessage(message);
    setShowMessageMenu(true);
  };

  // Закрытие меню при клике вне
  useEffect(() => {
    const handleClickOutside = (e) => {
      // Закрываем меню чата при клике вне меню
      if (showChatMenu) {
        const chatMenu = document.querySelector('.chat-menu-dropdown');
        if (chatMenu && !chatMenu.contains(e.target)) {
          setShowChatMenu(false);
        }
      }
      // Закрываем меню сообщения только по клику левой кнопкой мыши вне меню
      if (showMessageMenu && e.button === 0) {
        const messageMenu = document.querySelector('.message-menu-dropdown');
        if (messageMenu && !messageMenu.contains(e.target)) {
          setShowMessageMenu(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showChatMenu, showMessageMenu]);

  // Получение всех медиафайлов из чата
  const getChatMediaFiles = () => {
    if (!activeChat) return [];
    return messages
      .filter(m => m.file && m.file.mimetype?.startsWith('image/'))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  };

  // Форматирование размера файла
  const formatFileSize = (bytes) => {
    if (!bytes) return '';
    const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
    if (bytes === 0) return '0 Б';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
  };

  // Предпросмотр изображения
  const handleImageClick = (imageUrl, filename) => {
    setPreviewImage({ url: imageUrl, filename });
    setShowImagePreview(true);
  };

  const handleCloseImagePreview = () => {
    setShowImagePreview(false);
    setPreviewImage(null);
  };

  // Закрытие по ESC и клику вне контекстного меню
  useEffect(() => {
    const handleEscKey = (e) => {
      if (e.key === 'Escape') {
        if (showImagePreview) handleCloseImagePreview();
        if (showChatMenu) setShowChatMenu(false);
        if (showAddMenu) setShowAddMenu(false);
        if (showMediaViewer) setShowMediaViewer(false);
        if (contextMenu.visible) closeContextMenu();
        if (showEmojiPicker) {
          setShowEmojiPicker(false);
          setEmojiPickerPinned(false);
        }
      }
    };

    const handleClickOutside = (e) => {
      if (contextMenu.visible && !e.target.closest('.message-context-menu')) {
        closeContextMenu();
      }
      if (showEmojiPicker && !emojiPickerPinned && !e.target.closest('.emoji-btn-send') && !e.target.closest('.emoji-picker-area')) {
        setShowEmojiPicker(false);
      }
      if (showAddMenu && addMenuRef.current && !addMenuRef.current.contains(e.target)) {
        setShowAddMenu(false);
      }
    };

    document.addEventListener('keydown', handleEscKey);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleEscKey);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showImagePreview, showChatMenu, showAddMenu, showMediaViewer, contextMenu.visible, showEmojiPicker, emojiPickerPinned]);

  // Обновляем список пользователей при открытии модалки создания чата
  useEffect(() => {
    if (showNewChatModal) {
      fetchUsersList();
    }
  }, [showNewChatModal]);

  const handleCreateChat = () => {
    if (newChatType === 'direct' && selectedUsers.length === 1) {
      socket.emit('create_chat', {
        type: 'direct',
        participants: [selectedUsers[0].username]
      });
    } else if (newChatType === 'group' && selectedUsers.length > 0) {
      socket.emit('create_chat', {
        type: 'group',
        name: newChatName || 'Групповой чат',
        participants: selectedUsers.map(u => u.username)
      });
    }
    setShowNewChatModal(false);
    setNewChatName('');
    setSelectedUsers([]);
    setUserSearchQuery('');
  };

  const toggleUserSelection = (user) => {
    setSelectedUsers(prev => {
      const isSelected = prev.find(u => u.id === user.id);
      const newSelectedUsers = isSelected
        ? prev.filter(u => u.id !== user.id)
        : [...prev, user];
      
      // Автоматически выбираем тип чата в зависимости от количества пользователей
      if (newSelectedUsers.length === 1) {
        setNewChatType('direct');
      } else if (newSelectedUsers.length > 1) {
        setNewChatType('group');
      }
      
      return newSelectedUsers;
    });
  };

  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Форматирование даты сообщения — возвращает читаемую строку
  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    const isToday = date.toDateString() === now.toDateString();
    const isYesterday = date.toDateString() === yesterday.toDateString();

    if (isToday) return 'Сегодня';
    if (isYesterday) return 'Вчера';

    return date.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  };

  // Форматирование даты/времени для поиска сообщений
  const formatSearchTime = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    const isToday = date.toDateString() === now.toDateString();
    const isYesterday = date.toDateString() === yesterday.toDateString();
    const timeStr = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    if (isToday) return timeStr;
    if (isYesterday) return `Вчера, ${timeStr}`;
    
    return `${date.toLocaleDateString('ru-RU', { day: 'numeric', month: '2-digit' })}, ${timeStr}`;
  };

  // Отображение статуса доставки сообщения
  const showReadByPopup = async (messageId, e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    try {
      const resp = await fetch(`${SOCKET_URL}/api/messages/${messageId}/read-by`);
      if (resp.ok) {
        const data = await resp.json();
        setReadByPopup({ messageId, readers: data.readers, x: rect.left, y: rect.bottom + 4 });
      }
    } catch (err) {
      console.error('Ошибка загрузки читателей:', err);
    }
  };

  const renderMessageStatus = (message) => {
    void readStatusVersion;

    if (message.senderId !== currentUser?.id) return null;

    const isRead = message.read_at || (readByChatRef.current.get(message.chatId)?.size > 0);

    if (isRead) {
      return (
        <span className="message-status read" onClick={(e) => showReadByPopup(message.id, e)} title="Кто прочитал">
          ✓✓
        </span>
      );
    }

    return <span className="message-status">✓</span>;
  };

  // Форматирование текста бота (поддержка markdown-подобного синтаксиса)
  // Конфигурация marked для wiki
  marked.setOptions({
    breaks: true,
    gfm: true
  });

  const renderMarkdown = (text) => {
    if (!text) return '';
    const raw = marked.parse(text);
    return DOMPurify.sanitize(raw);
  };

  const formatBotText = (text) => {
    if (!text) return text;
    
    const lines = text.split('\n');
    
    const openDirectChat = (username) => {
      if (socket) {
        socket.emit('create_chat', { type: 'direct', participants: [username] });
      }
    };
    
    // Хелпер для обработки ссылок вида [text](user:username) внутри текстовой строки
    const renderTextWithUserLinks = (text, key) => {
      const parts = text.split(/(\[[^\]]*\]\(user:[^)]*\))/g);
      return parts.map((part, i) => {
        const match = part.match(/^\[([^\]]*)\]\(user:([^)]*)\)$/);
        if (match) {
          const displayName = match[1];
          const username = match[2];
          return (
            <a
              key={`${key}-link-${i}`}
              href="#"
              onClick={(e) => {
                e.preventDefault();
                openDirectChat(username);
              }}
              style={{ color: '#667eea', cursor: 'pointer', textDecoration: 'underline' }}
            >
              {displayName}
            </a>
          );
        }
        return part;
      });
    };
    
    return lines.map((line, lineIndex) => {
      let formattedLine = line;
      
      // Обработка заголовков (*** текст ***)
      if (formattedLine.startsWith('***') && formattedLine.endsWith('***')) {
        return <h4 key={lineIndex} style={{ margin: '10px 0 5px', color: '#667eea' }}>{formattedLine.slice(3, -3)}</h4>;
      }
      
      // Обработка жирного текста (**текст**) и ссылок [text](user:username)
      const parts = formattedLine.split(/(\*\*.*?\*\*)/g);
      const formattedParts = parts.flatMap((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          const innerText = part.slice(2, -2);
          return [<strong key={`bold-${lineIndex}-${i}`}>{renderTextWithUserLinks(innerText, `bold-${lineIndex}-${i}`)}</strong>];
        }
        return renderTextWithUserLinks(part, `text-${lineIndex}-${i}`);
      });
      
      // Обработка списков
      if (formattedLine.trim().startsWith('• ')) {
        return <div key={lineIndex} style={{ marginLeft: '20px' }}>{formattedParts}</div>;
      }
      
      // Обработка нумерованных списков
      const numberedMatch = formattedLine.match(/^(\d+)\.\s+(.*)/);
      if (numberedMatch) {
        return <div key={lineIndex} style={{ marginLeft: '20px' }}><strong>{numberedMatch[1]}.</strong> {numberedMatch[2]}</div>;
      }
      
      // Пустые строки
      if (formattedLine.trim() === '') {
        return <br key={lineIndex} />;
      }
      
      // Обычный текст
      return <span key={lineIndex}>{formattedParts}</span>;
    });
  };

  // Форматирование шагов онбординга
  const renderOnboardingSteps = (steps) => {
    if (!steps || !Array.isArray(steps)) return null;
    
    return (
      <div className="onboarding-steps">
        {steps.map((step, idx) => (
          <div key={idx} className="onboarding-step">
            <div className="onboarding-step-title">{step.title}</div>
            <div className="onboarding-step-desc">{step.desc}</div>
          </div>
        ))}
      </div>
    );
  };

  // Проверка, является ли сообщение от помощника
  const isBotMessage = (message) => {
    return message.senderName === 'Помощник' || message.senderId?.includes('helper-bot');
  };

  // Обработка клика по кнопке бота
  const handleBotButtonClick = (action) => {
    if (!socket || !activeChatId) return;

    // Отправляем команду боту
    socket.emit('send_message', {
      chatId: activeChatId,
      text: action
    });

    // Закрываем мобильное меню если открыто
    if (windowWidth <= 1600) {
      setShowChatMenu(false);
    }
  };

  const formatLastMessageTime = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'только что';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} мин`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} ч`;
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'numeric' });
  };

  const getFileIcon = (mimetype) => {
    if (mimetype?.startsWith('image/')) return <span className="emoji-animated">🖼️</span>;
    if (mimetype?.startsWith('video/')) return <span className="emoji-animated">🎬</span>;
    if (mimetype?.startsWith('audio/')) return <span className="emoji-animated">🎵</span>;
    if (mimetype?.includes('pdf')) return <span className="emoji-animated">📄</span>;
    return <span className="emoji-animated">📎</span>;
  };

  const getChatIcon = (chat) => {
    if (chat.type === 'general') return <span className="emoji-animated">🌐</span>;
    if (chat.type === 'direct') return <span className="emoji-animated">👤</span>;
    if (chat.type === 'group') return <span className="emoji-animated">👥</span>;
    return <span className="emoji-animated">💬</span>;
  };

  const getOnlineUsersCount = (chat) => {
    if (!chat.participantsDetails) return 0;
    return chat.participantsDetails.filter(p => p.status === 'online').length;
  };

  // Экран авторизации
  if (!isLoggedIn || (isLoggedIn && !currentUser)) {
    // Определяем путь к видео в зависимости от окружения
    const videoSrc = window.location.protocol === 'file:'
      ? 'videos/background.mp4'
      : '/videos/background.mp4';

    return (
      <div className="login-container">
        {/* Видео-фон */}
        <video
          className="login-video-bg"
          autoPlay
          loop
          muted
          playsInline
        >
          <source src={videoSrc} type="video/mp4" />
        </video>
        {/* Затемнение поверх видео */}
        <div className="login-video-overlay"></div>

        <div className="login-box auth-box">
          <h1>🍦 Чат УРСА</h1>

          {/* Сообщение о загрузке если isLoggedIn но нет currentUser */}
          {isLoggedIn && !currentUser && (
            <div className="loading-user-info">
              <p>Загрузка данных пользователя...</p>
              <button 
                className="auth-btn" 
                onClick={() => {
                  localStorage.removeItem(STORAGE_KEY);
                  localStorage.removeItem('chat_last_user');
                  setIsLoggedIn(false);
                  setCurrentUser(null);
                  setConnectionStatus('connecting');
                }}
                style={{ marginTop: '16px' }}
              >
                Войти вручную
              </button>
            </div>
          )}

          {/* Карточка последнего пользователя */}
          {lastUser && (
            <div className="last-user-card">
              <div className="last-user-avatar">
                {lastUser.avatar ? (
                  <img src={lastUser.avatar} alt={lastUser.username} onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || lastUser.username || 'U')}`; }} />
                ) : (
                  <div className="last-user-avatar-placeholder">
                    {lastUser.username.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="last-user-info">
                <div className="last-user-name">{lastUser.username}</div>
                <div className="last-user-label">Последний вход</div>
              </div>
              <div className="last-user-actions">
                <button 
                  className="last-user-login-btn"
                  onClick={() => {
                    // Показываем форму входа с предзаполненным email
                    const savedEmail = localStorage.getItem('chat_credentials_email');
                    if (savedEmail) {
                      try {
                        const creds = JSON.parse(savedEmail);
                        setEmail(creds.email || '');
                      } catch (e) {
                        console.error('Ошибка парсинга savedEmail:', e);
                      }
                    }
                    setPassword('');
                    setShowLoginForm(true);
                    setShowAuthForm(true);
                  }}
                >
                  Войти
                </button>
              </div>
            </div>
          )}

          {/* Разделитель и форма входа */}
          {true && (
            <>
              {lastUser && !showLoginForm && (
                <div className="auth-divider">
                  <span>или</span>
                </div>
              )}

              {/* Кнопка для разворачивания/сворачивания формы */}
              <button
                className="auth-form-toggle-btn"
                onClick={() => setShowAuthForm(!showAuthForm)}
              >
                {showAuthForm ? 'Скрыть форму входа' : 'Вход / Регистрация'}
                <svg
                  className={`auth-form-toggle-icon ${showAuthForm ? 'rotated' : ''}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>

              {/* Сворачиваемая форма входа/регистрации */}
              {showAuthForm && (
                <>
                  <div className="auth-tabs">
                    <button
                      className={authMode === 'login' ? 'active' : ''}
                      onClick={() => { setAuthMode('login'); setAuthError(''); }}
                    >
                      Вход
                    </button>
                    <button
                      className={authMode === 'register' ? 'active' : ''}
                      onClick={() => { setAuthMode('register'); setAuthError(''); }}
                    >
                      Регистрация
                    </button>
                  </div>

              {authMode === 'login' ? (
            <form onSubmit={handleLogin} className="auth-form" ref={loginFormRef}>
              <p className="auth-subtitle">Введите данные для входа</p>

              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Пароль</label>
                <div className="password-input-wrapper">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                        <line x1="1" y1="1" x2="23" y2="23"></line>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="form-group remember-me-group">
                <label className="remember-me-label">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  <span>Запомнить меня</span>
                </label>
              </div>

              {authError && <div className="auth-error">{authError}</div>}

              <button type="submit" disabled={isLoading} className="auth-btn">
                {isLoading ? 'Вход...' : 'Войти'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="auth-form">
              <p className="auth-subtitle">Создайте аккаунт</p>

              <div className="form-group">
                <label>ФИО</label>
                <input
                  type="text"
                  placeholder="Иванов Иван Иванович"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  maxLength={100}
                />
              </div>

              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Пароль</label>
                <div className="password-input-wrapper">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Минимум 8 символов"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                        <line x1="1" y1="1" x2="23" y2="23"></line>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label>Подтверждение пароля</label>
                <div className="password-input-wrapper">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="Повторите пароль"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    tabIndex={-1}
                  >
                    {showConfirmPassword ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                        <line x1="1" y1="1" x2="23" y2="23"></line>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label>Дата рождения <span style={{ color: '#ff6b6b' }}>*</span></label>
                <input
                  type="date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  required
                  max={new Date().toISOString().split('T')[0]}
                />
              </div>

              {authError && <div className="auth-error">{authError}</div>}

              <button type="submit" disabled={isLoading} className="auth-btn">
                {isLoading ? 'Регистрация...' : 'Зарегистрироваться'}
              </button>
            </form>
          )}
                </>
              )}
            </>
          )}
        </div>
        <div className="login-footer">
          <span>© 2026 Created By Pantyuhov DI</span>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Оверлей потери связи */}
      {connectionStatus !== 'connected' && connectionStatus !== 'connecting' && <DisconnectedOverlay />}

      {/* In-app уведомления (Telegram-стиль) */}
      <InAppNotification
        notifications={inAppNotifications}
        onDismiss={dismissInAppNotification}
        onSelectChat={handleSelectChat}
        renderEmoji={renderEmoji}
      />

      {/* Баннер уведомления о включении уведомлений */}
      {showNotificationBanner && browserNotificationPermission !== 'granted' && (
        <div className="notification-banner">
          <div className="notification-banner-content">
            <span className="notification-banner-icon">🔔</span>
            <div className="notification-banner-text">
              <strong>Включите уведомления браузера</strong>
              <p>Чтобы получать уведомления о новых сообщениях, включите их в настройках браузера</p>
            </div>
          </div>
          <div className="notification-banner-actions">
            <button className="notification-banner-btn" onClick={enableBrowserNotifications}>
              Включить
            </button>
            <button className="notification-banner-dismiss" onClick={dismissNotificationBanner}>
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Модальное окно установки обновления */}
      {updateStatus === 'ready' && electronUpdateInfo && window.electronAPI && (
        <div className="modal-overlay">
          <div className="modal-content update-install-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📦 Обновление готово</h3>
            </div>
            <div className="modal-body">
              <p>Доступна новая версия <strong>v{electronUpdateInfo.version}</strong>.</p>
              <p>Установить сейчас или отложить?</p>
            </div>
            <div className="modal-footer">
              <button type="button" className="cancel-btn" onClick={() => setUpdateStatus('idle')}>
                Позже
              </button>
              <button type="button" className="create-btn" onClick={installUpdate}>
                Установить сейчас
              </button>
            </div>
          </div>
        </div>
      )}
      {updateStatus === 'installing' && window.electronAPI && (
        <div className="modal-overlay">
          <div className="modal-content update-install-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>⏳ Подготовка к установке...</h3>
            </div>
            <div className="modal-body">
              <p>Останавливается серверная часть приложения.</p>
              <p className="update-hint">Пожалуйста, подождите — установка начнётся автоматически.</p>
              <div className="update-spinner" style={{ margin: '16px auto' }}></div>
            </div>
          </div>
        </div>
      )}
      {updateStatus === 'downloading' && electronUpdateInfo && window.electronAPI && (
        <div className="update-progress-toast">
          <span>📦 Загрузка обновления... {Math.round(updateProgress)}%</span>
          <div className="update-progress-bar-inline">
            <div className="update-progress-fill-inline" style={{ width: `${Math.round(updateProgress)}%` }}></div>
          </div>
        </div>
      )}
      {browserUpdateInfo && updateStatus === 'available' && !window.electronAPI && (
        <div className="update-banner">
          <div className="update-banner-content">
            <span className="update-banner-icon">📦</span>
            <div className="update-banner-text">
              <strong>Доступно обновление v{browserUpdateInfo.latestVersion}</strong>
              <p>
                {browserUpdateInfo.releaseName || `Версия v${browserUpdateInfo.latestVersion}`}
                {browserUpdateInfo.publishedAt && <> · {new Date(browserUpdateInfo.publishedAt).toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' })}</>}
              </p>
            </div>
          </div>
          <div className="update-banner-actions">
            <button className="update-banner-btn" onClick={() => { window.open(browserUpdateInfo.releaseUrl, '_blank'); setBrowserUpdateInfo(null); setUpdateStatus(null); }}>
              Скачать
            </button>
            <button className="update-banner-dismiss" onClick={() => { setBrowserUpdateInfo(null); setUpdateStatus(null); }}>
              Позже
            </button>
          </div>
        </div>
      )}

      {/* Боковая панель с кнопками */}
      <aside className="sidebar-buttons">
        <div className="user-info" onClick={handleOpenProfile} style={{ cursor: 'pointer' }} title={currentUser?.username}>
          <div className="user-avatar-wrapper">
            <img src={currentUser?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser?.username || 'U')}`} alt={currentUser?.username} className="user-avatar" onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || 'U')}`; }} />
          </div>
          <span className="user-name-sidebar">{currentUser?.username}</span>
        </div>
        <div className="buttons-column">
          {/* Статус */}
          <button
            className={`nav-sidebar-btn ${showStatusPicker ? 'active' : ''}`}
            onClick={() => {
              // Не меняем activeView, сразу открываем модальное окно
              const currentStatus = currentUser?.status_text || '';
              if (currentStatus) {
                const chars = Array.from(currentStatus);
                const firstChar = chars[0] || '';
                const isEmoji = /[\p{Emoji}]/u.test(firstChar);
                if (isEmoji) {
                  setStatusEmoji(firstChar);
                  setStatusDescription(chars.slice(1).join('').trim());
                } else {
                  setStatusEmoji('');
                  setStatusDescription(currentStatus);
                }
              } else {
                setStatusEmoji('');
                setStatusDescription('');
              }
              setShowStatusPicker(true);
            }}
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

          {/* Уведомления */}
          <button
            className={`nav-sidebar-btn ${showNotifications ? 'active' : ''}`}
            onClick={async () => {
              await getUpcomingNotifications(true);
              setShowNotifications(true);
              setUnreadNotificationsCount(0);
            }}
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

          {/* Чаты */}
          <button
            className={`nav-sidebar-btn ${activeView === 'chats' ? 'active' : ''}`}
            onClick={handleOpenChats}
            title="Чаты"
          >
            <div className="nav-btn-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <span className="nav-btn-label">Чаты</span>
          </button>

          {/* Телефоны */}
          <button
            className={`nav-sidebar-btn ${activeView === 'phonebook' ? 'active' : ''}`}
            onClick={handleOpenPhonebook}
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

          {/* Календарь */}
          <button
            className={`nav-sidebar-btn ${activeView === 'calendar' ? 'active' : ''}`}
            onClick={handleOpenCalendar}
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

          {/* Показатели */}
          <button
            className={`nav-sidebar-btn ${activeView === 'kpi' ? 'active' : ''}`}
            onClick={handleOpenKpi}
            title="Показатели"
          >
            <div className="nav-btn-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="20" x2="18" y2="10"/>
                <line x1="12" y1="20" x2="12" y2="4"/>
                <line x1="6" y1="20" x2="6" y2="14"/>
              </svg>
            </div>
            <span className="nav-btn-label">Показатели</span>
          </button>

          {/* База знаний */}
          <button
            className={`nav-sidebar-btn ${activeView === 'wiki' ? 'active' : ''}`}
            onClick={async () => {
              await loadWikiData();
              setActiveView('wiki');
            }}
            title="База знаний"
          >
            <div className="nav-btn-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                <line x1="8" y1="7" x2="16" y2="7"/>
                <line x1="8" y1="11" x2="14" y2="11"/>
              </svg>
            </div>
            <span className="nav-btn-label">База знаний</span>
          </button>

          {/* HR / Заявления — скрыто */}
          {/* Объявления — скрыто */}

          {/* Настройки */}
          <button
            className={`nav-sidebar-btn ${activeView === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveView('settings')}
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

          {/* Админ */}
          {isAdmin && (
            <button
              className={`nav-sidebar-btn ${activeView === 'admin' ? 'active' : ''}`}
              onClick={() => setActiveView('admin')}
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

          {/* Выйти */}
          <button
            className="nav-sidebar-btn logout-btn"
            onClick={handleLogout}
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

      {/* Модальное окно подтверждения выхода */}
      {showLogoutConfirm && (
        <div className="modal-overlay" onClick={() => setShowLogoutConfirm(false)}>
          <div className="modal-content confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>⚠️ Выход из аккаунта</h3>
              <button onClick={() => setShowLogoutConfirm(false)}>✕</button>
            </div>

            <div className="modal-body">
              <p className="confirm-message">
                Вы уверены, что хотите выйти из аккаунта?
              </p>
            </div>

            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowLogoutConfirm(false)}>
                Отмена
              </button>
              <button className="delete-btn" onClick={confirmLogout}>
                Выйти
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно уведомлений */}
      {showNotifications && (
        <div className="modal-overlay" onClick={() => setShowNotifications(false)}>
          <div className="modal-content notifications-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🔔 Уведомления</h3>
              <button onClick={() => setShowNotifications(false)}>✕</button>
            </div>

            <div className="notifications-filter">
              <button
                className={`notification-filter-btn ${notificationTimeFilter === 'today' ? 'active' : ''}`}
                onClick={() => {
                  setNotificationTimeFilter('today');
                  getUpcomingNotifications(true, 'today');
                }}
              >
                Сегодня
              </button>
              <button
                className={`notification-filter-btn ${notificationTimeFilter === '3days' ? 'active' : ''}`}
                onClick={() => {
                  setNotificationTimeFilter('3days');
                  getUpcomingNotifications(true, '3days');
                }}
              >
                3 дня
              </button>
              <button
                className={`notification-filter-btn ${notificationTimeFilter === 'week' ? 'active' : ''}`}
                onClick={() => {
                  setNotificationTimeFilter('week');
                  getUpcomingNotifications(true, 'week');
                }}
              >
                Неделя
              </button>
            </div>

            <div className="modal-body notifications-body">
              {/* Дни рождения */}
              <div className="notifications-section">
                <div className="notifications-section-header" onClick={() => toggleSection('birthdays')} style={{ cursor: 'pointer' }}>
                  <div className="section-header-left">
                    <h4>🎂 Дни рождения</h4>
                    <span className="notifications-count">{upcomingNotifications.birthdays.length}</span>
                  </div>
                  <span className={`section-toggle-icon ${expandedSections.birthdays ? 'expanded' : ''}`}>
                    {expandedSections.birthdays ? '−' : '+'}
                  </span>
                </div>
                {expandedSections.birthdays && (
                  <>
                    {upcomingNotifications.birthdays.length === 0 ? (
                      <p className="notifications-empty">Нет предстоящих дней рождения</p>
                    ) : (
                      <div className="notifications-list">
                        {upcomingNotifications.birthdays.map(birthday => (
                          <div key={birthday.id} className="notification-item birthday-item">
                            <img src={birthday.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(birthday.username)}`} alt={birthday.username} className="notification-avatar" onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || birthday.username || 'U')}`; }} />
                            <div className="notification-content">
                              <span className="notification-title">{birthday.username}</span>
                              <span className="notification-date">
                                {birthday.isToday ? '🎉 Сегодня!' : `Через ${birthday.daysUntil} дн.`}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Задачи */}
              <div className="notifications-section">
                <div className="notifications-section-header" onClick={() => toggleSection('tasks')} style={{ cursor: 'pointer' }}>
                  <div className="section-header-left">
                    <h4>📋 Задачи</h4>
                    <span className="notifications-count">{upcomingNotifications.tasks.length}</span>
                  </div>
                  <span className={`section-toggle-icon ${expandedSections.tasks ? 'expanded' : ''}`}>
                    {expandedSections.tasks ? '−' : '+'}
                  </span>
                </div>
                {expandedSections.tasks && (
                  <>
                    {upcomingNotifications.tasks.length === 0 ? (
                      <p className="notifications-empty">Нет предстоящих задач</p>
                    ) : (
                      <div className="notifications-list">
                        {upcomingNotifications.tasks.map(task => (
                          <div key={task.id} className="notification-item task-item">
                            <div className="notification-task-color" style={{ background: task.color }}></div>
                            <div className="notification-content">
                              <span className="notification-title">{task.title}</span>
                              <span className="notification-date">
                                {task.isToday ? '📅 Сегодня!' : `Через ${task.daysUntil} дн.`}
                                {task.task_time && ` в ${task.task_time}`}
                              </span>
                              {task.description && (
                                <span className="notification-description">{task.description}</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Общие задачи */}
              <div className="notifications-section">
                <div className="notifications-section-header" onClick={() => toggleSection('sharedTasks')} style={{ cursor: 'pointer' }}>
                  <div className="section-header-left">
                    <h4>📥 Задачи от других</h4>
                    <span className="notifications-count">{upcomingNotifications.sharedTasks.length}</span>
                  </div>
                  <span className={`section-toggle-icon ${expandedSections.sharedTasks ? 'expanded' : ''}`}>
                    {expandedSections.sharedTasks ? '−' : '+'}
                  </span>
                </div>
                {expandedSections.sharedTasks && (
                  <>
                    {upcomingNotifications.sharedTasks.length === 0 ? (
                      <p className="notifications-empty">Нет общих задач</p>
                    ) : (
                      <div className="notifications-list">
                        {upcomingNotifications.sharedTasks.map(task => (
                          <div
                            key={task.id}
                            className={`notification-item shared-task-item ${disappearingTasks.includes(task.shareId) ? 'disappearing' : ''}`}
                          >
                            <img src={task.from_avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(task.from_username)}`} alt={task.from_username} className="notification-avatar" onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || task.from_username || 'U')}`; }} />
                            <div className="notification-content">
                              <span className="notification-title">{task.title}</span>
                              <span className="notification-from">От: {task.from_username}</span>
                              <span className="notification-date">
                                {task.isToday ? '📅 Сегодня!' : `Через ${task.daysUntil} дн.`}
                                {task.task_time && ` в ${task.task_time}`}
                              </span>
                              {task.description && (
                                <span className="notification-description">{task.description}</span>
                              )}
                              <div className="shared-task-actions">
                                <button className="accept-task-btn-small" onClick={() => handleAcceptSharedTaskInNotifications(task.shareId)}>
                                  ✓ Принять
                                </button>
                                <button className="decline-task-btn-small" onClick={() => handleDeclineSharedTaskInNotifications(task.shareId)}>
                                  ✕ Отклонить
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="modal-footer notifications-footer">
              <button className="modal-btn primary" onClick={() => { setShowNotifications(false); handleOpenCalendar(); }}>
                📅 Открыть календарь
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Вкладка админ-панели */}
      {activeView === 'admin' && isAdmin && (
        <main className="full-page-view">
          <div className="full-page-header">
            <div className="full-page-header-content">
              <button className="back-to-chats-btn white" onClick={handleOpenChats} title="Вернуться к чатам">
                ← Чаты
              </button>
              <h2>⚙️ Панель администратора</h2>
            </div>
          </div>

          <div className="full-page-content admin-full-page">
            <div className="admin-tabs">
              <button
                className={`admin-tab ${activeAdminTab === 'dashboard' ? 'active' : ''}`}
                onClick={() => handleAdminTabChange('dashboard')}
              >
                📊 Главная
              </button>
              <button
                className={`admin-tab ${activeAdminTab === 'users' ? 'active' : ''}`}
                onClick={() => handleAdminTabChange('users')}
              >
                👥 Пользователи
              </button>
              <button
                className={`admin-tab ${activeAdminTab === 'sessions' ? 'active' : ''}`}
                onClick={() => { setActiveAdminTab('sessions'); handleOpenSessions(); }}
              >
                💻 Сессии
              </button>
              <button
                className={`admin-tab ${activeAdminTab === 'files' ? 'active' : ''}`}
                onClick={() => { setActiveAdminTab('files'); handleOpenFileManager(); }}
              >
                📁 Файлы
              </button>
              <button
                className={`admin-tab ${activeAdminTab === 'security' ? 'active' : ''}`}
                onClick={() => { setActiveAdminTab('security'); handleOpenSecurityLogs(); }}
              >
                🛡️ Безопасность
              </button>
              <button
                className={`admin-tab ${activeAdminTab === 'settings' ? 'active' : ''}`}
                onClick={() => { setActiveAdminTab('settings'); handleOpenUiSettings(); }}
              >
                🎨 Настройки
              </button>
              <button
                className={`admin-tab ${activeAdminTab === 'bot' ? 'active' : ''}`}
                onClick={() => { setActiveAdminTab('bot'); loadBotAnalytics(); loadBotSettings(); }}
              >
                🤖 Бот
              </button>
              <button
                className={`admin-tab ${activeAdminTab === 'support' ? 'active' : ''}`}
                onClick={() => { setActiveAdminTab('support'); loadSupportRequests('open'); }}
              >
                📞 Поддержка
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
                        onClick={() => setShowCreateUserModal(true)}
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
                          <th>База знаний</th>
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
                                  <img src={user.avatar || `https://ui-avatars.com/api/?name=${user.username}`} alt={user.username} className="user-avatar-small" onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || 'U')}`; }} />
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
                                    onChange={() => handleToggleMeetingRoomRights(user.id, user.can_book_meeting_room)}
                                    disabled={user.username === 'Root'}
                                    title={user.username === 'Root' ? 'Root имеет право по умолчанию' : 'Переключить право на бронирование'}
                                  />
                                  <span className="toggle-slider"></span>
                              </label>
                            </td>
                            <td>
                              {user.is_admin === 1 ? (
                                <span style={{fontSize: '12px'}}>Полный</span>
                              ) : (
                                <label className="toggle-switch">
                                  <input
                                    type="checkbox"
                                    checked={user.can_edit_wiki === 1}
                                    onChange={() => handleToggleWikiRights(user.id, user.can_edit_wiki)}
                                    disabled={user.username === 'Root'}
                                    title={user.can_edit_wiki === 1 ? 'Запретить создание статей' : 'Разрешить создание статей'}
                                  />
                                  <span className="toggle-slider"></span>
                                </label>
                              )}
                            </td>
                            <td>
                              <div className="action-buttons">
                                  <button
                                    className="action-btn edit"
                                    onClick={() => handleToggleAdminRights(user.id, user.is_admin)}
                                    title={user.is_admin === 1 ? 'Снять права админа' : 'Дать права админа'}
                                  >
                                    {user.is_admin === 1 ? '👤' : '👑'}
                                  </button>
                                  <button
                                    className="action-btn reset"
                                    onClick={() => handleOpenResetPassword(user)}
                                    title="Сбросить пароль"
                                  >
                                    🔑
                                  </button>
                                  <button
                                    className="action-btn delete"
                                    onClick={() => handleDeleteUser(user.id)}
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
                                <img src={session.avatar || `https://ui-avatars.com/api/?name=${session.username}`} alt={session.username} className="user-avatar-small" onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || 'U')}`; }} />
                                <span>{session.username}</span>
                              </div>
                            </td>
                            <td>{session.ip || 'unknown'}</td>
                            <td>{session.browser || 'Unknown'}</td>
                            <td>{new Date(session.loginTime).toLocaleString('ru-RU')}</td>
                            <td>
                              <button
                                className="action-btn delete"
                                onClick={() => handleTerminateSession(session.id)}
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
                            onClick={() => handleDeleteFile(file)}
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

                {activeAdminTab === 'settings' && (
                  <div className="admin-ui-settings">
                    <h4>🎨 Настройки интерфейса</h4>
                    <div className="settings-form">
                      <div className="form-group">
                        <label>Название сайта</label>
                        <input
                          type="text"
                          value={uiSettings.siteName}
                          onChange={(e) => setUiSettings({...uiSettings, siteName: e.target.value})}
                          placeholder="Чат"
                        />
                      </div>
                      <div className="form-group">
                        <label>URL логотипа</label>
                        <input
                          type="text"
                          value={uiSettings.logoUrl}
                          onChange={(e) => setUiSettings({...uiSettings, logoUrl: e.target.value})}
                          placeholder="https://example.com/logo.png"
                        />
                      </div>
                      <div className="form-group">
                        <label>Основной цвет</label>
                        <div className="color-picker-group">
                          <input
                            type="color"
                            value={uiSettings.primaryColor}
                            onChange={(e) => setUiSettings({...uiSettings, primaryColor: e.target.value})}
                          />
                          <span>{uiSettings.primaryColor}</span>
                        </div>
                      </div>
                      <div className="form-group">
                        <label>Вторичный цвет</label>
                        <div className="color-picker-group">
                          <input
                            type="color"
                            value={uiSettings.secondaryColor}
                            onChange={(e) => setUiSettings({...uiSettings, secondaryColor: e.target.value})}
                          />
                          <span>{uiSettings.secondaryColor}</span>
                        </div>
                      </div>
                      <button
                        className="btn-primary"
                        onClick={handleSaveUiSettings}
                        disabled={isSavingUiSettings}
                      >
                        {isSavingUiSettings ? 'Сохранение...' : 'Сохранить настройки'}
                      </button>
                    </div>
                  </div>
                )}

                {activeAdminTab === 'bot' && (
                  <div className="admin-bot-section">
                    <h4>🤖 Аналитика бота Помощник</h4>
                    {botAnalyticsData ? (
                      <div className="admin-dashboard">
                        <div className="admin-stat-card">
                          <div className="stat-icon">💬</div>
                          <div className="stat-info">
                            <div className="stat-value">{botAnalyticsData.totalInteractions}</div>
                            <div className="stat-label">Всего взаимодействий</div>
                          </div>
                        </div>
                        <div className="admin-stat-card">
                          <div className="stat-icon">❌</div>
                          <div className="stat-info">
                            <div className="stat-value">{botAnalyticsData.fallbackCount}</div>
                            <div className="stat-label">Нераспознанных запросов</div>
                          </div>
                        </div>
                        <div className="admin-stat-card">
                          <div className="stat-icon">📊</div>
                          <div className="stat-info">
                            <div className="stat-value">{botAnalyticsData.fallbackRate}</div>
                            <div className="stat-label">% нераспознанных</div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p>Загрузка...</p>
                    )}

                    {botAnalyticsData && botAnalyticsData.topCommands && botAnalyticsData.topCommands.length > 0 && (
                      <div className="admin-section">
                        <h4>🏆 Популярные команды</h4>
                        <table className="admin-table">
                          <thead>
                            <tr>
                              <th>Команда</th>
                              <th>Использований</th>
                            </tr>
                          </thead>
                          <tbody>
                            {botAnalyticsData.topCommands.map(([cmd, count], i) => (
                              <tr key={i}>
                                <td>{cmd}</td>
                                <td>{count}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {botAnalyticsData && botAnalyticsData.recentFallbacks && botAnalyticsData.recentFallbacks.length > 0 && (
                      <div className="admin-section">
                        <h4>❌ Последние нераспознанные запросы</h4>
                        <ul className="fallback-list">
                          {botAnalyticsData.recentFallbacks.map((phrase, i) => (
                            <li key={i} className="fallback-item">{phrase}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <button
                      className="btn-danger"
                      onClick={async () => {
                        if (!confirm('Сбросить всю аналитику бота?')) return;
                        try {
                          await fetch(`${SOCKET_URL}/api/bot/analytics/reset`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ userId: currentUser.id })
                          });
                          setBotAnalyticsData(null);
                        } catch (e) {
                          console.error(e);
                        }
                      }}
                      style={{ marginTop: '16px' }}
                    >
                      🗑️ Сбросить аналитику
                    </button>

                    <div className="admin-section" style={{ marginTop: '24px' }}>
                      <h4>⚙️ Настройки функций бота</h4>
                      {botSettings ? (
                        <div className="settings-form">
                          <div className="form-group">
                            <label className="remember-me-label">
                              <input type="checkbox" checked={botSettings.wiki_search_enabled} onChange={(e) => setBotSettings({...botSettings, wiki_search_enabled: e.target.checked})} />
                              <span>Поиск по wiki-статьям</span>
                            </label>
                          </div>
                          <div className="form-group">
                            <label className="remember-me-label">
                              <input type="checkbox" checked={botSettings.file_search_enabled} onChange={(e) => setBotSettings({...botSettings, file_search_enabled: e.target.checked})} />
                              <span>Поиск файлов</span>
                            </label>
                          </div>
                          <div className="form-group">
                            <label className="remember-me-label">
                              <input type="checkbox" checked={botSettings.task_creation_enabled} onChange={(e) => setBotSettings({...botSettings, task_creation_enabled: e.target.checked})} />
                              <span>Создание задач</span>
                            </label>
                          </div>
                          <div className="form-group">
                            <label className="remember-me-label">
                              <input type="checkbox" checked={botSettings.booking_enabled} onChange={(e) => setBotSettings({...botSettings, booking_enabled: e.target.checked})} />
                              <span>Бронирование переговорок</span>
                            </label>
                          </div>
                          <div className="form-group">
                            <label className="remember-me-label">
                              <input type="checkbox" checked={botSettings.poll_creation_enabled} onChange={(e) => setBotSettings({...botSettings, poll_creation_enabled: e.target.checked})} />
                              <span>Создание опросов</span>
                            </label>
                          </div>
                          <div className="form-group">
                            <label className="remember-me-label">
                              <input type="checkbox" checked={botSettings.support_enabled} onChange={(e) => setBotSettings({...botSettings, support_enabled: e.target.checked})} />
                              <span>Обращения в поддержку</span>
                            </label>
                          </div>
                          <div className="form-group">
                            <label className="remember-me-label">
                              <input type="checkbox" checked={botSettings.birthday_notifications_enabled} onChange={(e) => setBotSettings({...botSettings, birthday_notifications_enabled: e.target.checked})} />
                              <span>Уведомления о днях рождения</span>
                            </label>
                          </div>
                          <button
                            className="btn-primary"
                            onClick={async () => {
                              try {
                                await fetch(`${SOCKET_URL}/api/bot/settings`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ userId: currentUser.id, settings: botSettings })
                                });
                                alert('Настройки сохранены');
                              } catch (e) {
                                console.error(e);
                                alert('Ошибка сохранения');
                              }
                            }}
                          >
                            💾 Сохранить настройки
                          </button>
                        </div>
                      ) : (
                        <p>Загрузка...</p>
                      )}
                    </div>
                  </div>
                )}

                {activeAdminTab === 'support' && (
                  <div className="admin-support-section">
                    <div className="admin-users-header">
                      <h4>📞 Обращения в поддержку</h4>
                      <div>
                        <button
                          className={`admin-tab ${supportActiveFilter === 'open' ? 'active' : ''}`}
                          onClick={() => { setSupportActiveFilter('open'); loadSupportRequests('open'); }}
                          style={{ marginRight: '8px', padding: '4px 12px' }}
                        >
                          Открытые
                        </button>
                        <button
                          className={`admin-tab ${supportActiveFilter === 'closed' ? 'active' : ''}`}
                          onClick={() => { setSupportActiveFilter('closed'); loadSupportRequests('closed'); }}
                          style={{ marginRight: '8px', padding: '4px 12px' }}
                        >
                          Закрытые
                        </button>
                        <button
                          className={`admin-tab ${supportActiveFilter === 'all' ? 'active' : ''}`}
                          onClick={() => { setSupportActiveFilter('all'); loadSupportRequests('all'); }}
                          style={{ padding: '4px 12px' }}
                        >
                          Все
                        </button>
                      </div>
                    </div>
                    {supportRequests.length === 0 ? (
                      <p>Нет обращений</p>
                    ) : (
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>ID</th>
                            <th>Пользователь</th>
                            <th>Проблема</th>
                            <th>Статус</th>
                            <th>Дата</th>
                            <th>Действия</th>
                          </tr>
                        </thead>
                        <tbody>
                          {supportRequests.map(req => (
                            <tr key={req.id}>
                              <td>#{req.id.substring(0, 8)}</td>
                              <td>{req.username}</td>
                              <td style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{req.problem}</td>
                              <td>
                                <span className={`status-badge ${req.status === 'open' ? 'status-open' : 'status-closed'}`}>
                                  {req.status === 'open' ? '🟢 Открыто' : '🔴 Закрыто'}
                                </span>
                              </td>
                              <td>{new Date(req.created_at).toLocaleString('ru-RU')}</td>
                              <td>
                                {req.status === 'open' && (
                                  <button
                                    className="btn-small"
                                    onClick={async () => {
                                      try {
                                        await fetch(`${SOCKET_URL}/api/admin/support-requests/${req.id}/close`, {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ userId: currentUser.id })
                                        });
                                        loadSupportRequests(supportActiveFilter || 'open');
                                      } catch (e) {
                                        console.error(e);
                                      }
                                    }}
                                  >
                                    ✅ Закрыть
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            </div>
        </main>
      )}

      {/* Модальное окно создания пользователя */}
      {showCreateUserModal && (
        <div className="modal-overlay" onClick={() => setShowCreateUserModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>➕ Создать пользователя</h3>
              <button onClick={() => setShowCreateUserModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>ФИО *</label>
                <input
                  type="text"
                  value={newUserData.username}
                  onChange={(e) => setNewUserData({...newUserData, username: e.target.value})}
                  placeholder="Иванов Иван Иванович"
                />
              </div>
              <div className="form-group">
                <label>Email *</label>
                <input
                  type="email"
                  value={newUserData.email}
                  onChange={(e) => setNewUserData({...newUserData, email: e.target.value})}
                  placeholder="Введите email"
                />
              </div>
              <div className="form-group">
                <label>Пароль *</label>
                <input
                  type="password"
                  value={newUserData.password}
                  onChange={(e) => setNewUserData({...newUserData, password: e.target.value})}
                  placeholder="Введите пароль (минимум 6 символов)"
                />
              </div>
              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={newUserData.is_admin === 1}
                    onChange={(e) => setNewUserData({...newUserData, is_admin: e.target.checked ? 1 : 0})}
                  />
                  <span>Права администратора</span>
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowCreateUserModal(false)}>
                Отмена
              </button>
              <button 
                className="btn-primary" 
                onClick={handleCreateUser}
                disabled={isCreatingUser}
              >
                {isCreatingUser ? 'Создание...' : 'Создать'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно сброса пароля */}
      {showResetPasswordModal && (
        <div className="modal-overlay" onClick={() => setShowResetPasswordModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🔑 Сброс пароля</h3>
              <button onClick={() => setShowResetPasswordModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p className="reset-password-info">
                Сброс пароля для пользователя <strong>{userToResetPassword?.username}</strong>
              </p>
              <div className="form-group">
                <label>Новый пароль</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Введите новый пароль (минимум 6 символов)"
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowResetPasswordModal(false)}>
                Отмена
              </button>
              <button
                className="btn-primary"
                onClick={handleResetPassword}
                disabled={!newPassword || newPassword.length < 6}
              >
                Сбросить пароль
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Боковая панель со списком чатов */}
      {activeView === 'chats' && (
      <aside className={`sidebar ${!showChatList ? 'hidden-mobile' : ''}`}>
        {searchResults.length > 0 && (
          <div className="chats-search-results-header">
            <span className="chats-search-results-count">Найдено: {searchResults.length}</span>
            <button className="search-clear-btn" onClick={handleCloseSearch}>✕</button>
          </div>
        )}

        <div className="chats-section">
          <div className="section-header">
            <span>Чаты</span>
            <button className="new-chat-btn" onClick={() => setShowNewChatModal(true)} title="Новый чат">
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
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearchMessages()}
            />
            {isSearching && <span className="chats-search-loading">🔍</span>}
          </div>

          {searchResults.length > 0 ? (
            <div className="chats-list">
              {searchResults.map((result, idx) => (
                <div
                  key={result.id || idx}
                  className={`chat-item ${currentSearchIndex === idx ? 'active' : ''}`}
                  onClick={() => handleSearchResultClick(result)}
                >
                  <div className="chat-item-left" style={{ cursor: 'pointer' }}>
                    {result.type === 'message' ? (
                      result.senderAvatar ? (
                        <img src={result.senderAvatar} alt="" className="chat-avatar-img" onError={(e) => { e.target.style.display = 'none'; }} />
                      ) : (
                        <div className="chat-icon chat-avatar-fallback">{(result.senderName || '?')[0].toUpperCase()}</div>
                      )
                    ) : result.type === 'user' ? '👤' : getChatIcon(result)}
                    <div className="chat-info">
                      <div className="chat-name-row">
                        <span className="chat-name">
                          {result.type === 'user' ? result.username : result.chatName || result.senderName || 'Чат'}
                        </span>
                        <span className="chat-time">{result.timestamp ? formatSearchTime(result.timestamp) : ''}</span>
                      </div>
                      <div className="chat-preview-row">
                        <span className="chat-preview">
                          {result.type === 'user' ? result.fullName || result.email || '' : result.senderName ? `${result.senderName}: ` : ''}{result.text || ''}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <div className="search-nav-controls">
                <button className="search-nav-btn" onClick={handleSearchPrev}>↑</button>
                <span className="search-count">{currentSearchIndex + 1} / {searchResults.length}</span>
                <button className="search-nav-btn" onClick={handleSearchNext}>↓</button>
              </div>
            </div>
          ) : (
            <div className="chats-list">
              {chats.sort((a, b) => {
                const aTime = a.lastMessage?.timestamp || a.createdAt;
                const bTime = b.lastMessage?.timestamp || b.createdAt;
                return new Date(bTime) - new Date(aTime);
              }).map(chat => {
              // Находим ID пользователя для личных чатов
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
                  onClick={() => handleSelectChat(chat)}
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
                            onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || 'U')}`; }}
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
                      onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || 'U')}`; }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (currentUser?.is_admin === 1) {
                          handleViewUserProfile({
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
                  ) : chat.avatar ? (
                    <img src={chat.avatar} alt={chat.name} className="chat-avatar" onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || 'U')}`; }} />
                  ) : (
                    <div className="chat-icon">{getChatIcon(chat)}</div>
                  )}
                  <div className="chat-info">
                    <div className="chat-name-row">
                      <span className="chat-name">
                        {getChatDisplayName(chat)}
                        {e2eeEnabled[chat.id] && <span className="e2ee-chat-badge" title="E2EE включено">🔒</span>}
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
                      if (otherUser) {
                        if (otherUser.status_text) {
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
                                    return renderEmoji(char);
                                  }
                                  return char;
                                })}
                              </span>
                            </div>
                          );
                        } else if (otherUser.status !== 'online' && otherUser.last_seen) {
                          return (
                            <div className="chat-status-row">
                              <span className="chat-status-text offline">
                                Был(а) {getLastSeenText(otherUser.last_seen)}
                              </span>
                            </div>
                          );
                        } else if (otherUser.status !== 'online') {
                          return (
                            <div className="chat-status-row">
                              <span className="chat-status-text offline">Офлайн</span>
                            </div>
                          );
                        }
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
              <button className="icon-btn small" onClick={() => setShowUsersList(false)}>✕</button>
            </div>
            <div className="users-list">
              {users.map(user => (
                <div key={user.id} className="user-item">
                  <div className="user-avatar-wrapper">
                    <img src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.username)}`} alt={user.username} className="user-avatar-small" onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || user.username || 'U')}`; }} />
                    <span className={`status-indicator ${user.status}`}></span>
                    {user.status_text && (
                      <span className="user-status-badge">
                        {(() => {
                          const statusText = user.status_text;
                          return statusText.split('').map((char, idx) => {
                            if (/[\p{Emoji}]/u.test(char)) {
                              return renderEmoji(char);
                            }
                            return char;
                          });
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
      )}

      {/* Основная область чата */}
      {activeView === 'chats' && (
      <main className={`chat-main ${showChatList ? '' : 'visible-mobile'}`}>
        {activeChat ? (
          <div className="chat-view-container">
            <header className="chat-header-main">
              {/* Кнопка «назад к списку чатов» — только на мобильных */}
              {windowWidth <= 768 && showChatList === false && (
                <button
                  className="back-to-chats-list"
                  onClick={() => setShowChatList(true)}
                  title="Список чатов"
                  aria-label="Назад к списку чатов"
                >
                  ←
                </button>
              )}
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
                        onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || 'U')}`; }}
                        onClick={() => {
                          handleViewUserProfile({
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
                        handleViewUserProfile({
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
                        onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || 'U')}`; }}
                      />
                    ) : (
                      <span className="chat-icon-large">{getChatIcon(activeChat)}</span>
                    )}
                  </div>
                ) : activeChat.type === 'group' ? (
                  <div style={{ cursor: 'pointer' }} title="Просмотр аватара">
                    {activeChat.avatar ? (
                      <img src={activeChat.avatar} alt={activeChat.name} className="chat-header-avatar" onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || 'U')}`; }} onClick={() => setPreviewAvatar({ src: activeChat.avatar, chatId: activeChat.id })} />
                    ) : (
                      <span className="chat-icon-large" onClick={() => document.getElementById(`group-avatar-${activeChat.id}`).click()}>{getChatIcon(activeChat)}</span>
                    )}
                    <input id={`group-avatar-${activeChat.id}`} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleUploadGroupChatAvatar(e, activeChat.id)} />
                  </div>
                ) : (
                  <span className="chat-icon-large">{getChatIcon(activeChat)}</span>
                )}
                <div>
                  <h2>{getChatDisplayName(activeChat)}</h2>
                  <span className="chat-status">
                    {/* Индикатор "печатает..." */}
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

                    {/* Индикатор "Бот печатает..." */}
                    {botTypingChatId === activeChat?.id && activeChat?.id?.startsWith('bot-chat-') && (
                      <span className="typing-indicator">
                        🤖 Помощник печатает
                        <span className="typing-dots">
                          <span>.</span><span>.</span><span>.</span>
                        </span>
                      </span>
                    )}
                    
                    {/* Обычный статус если никто не печатает */}
                    {Object.keys(typingUsers).length === 0 && activeChat.type === 'direct' && activeChat.participantsDetails ? (
                      (() => {
                        const otherUser = activeChat.participantsDetails.find(
                          p => p.username !== currentUser?.username
                        );
                        if (otherUser) {
                          const statusText = otherUser.status_text || '';
                          const isOnline = otherUser.status === 'online';

                          if (statusText) {
                            // Проверяем, есть ли в статусе эмодзи
                            const hasEmoji = /[\p{Emoji}]/u.test(statusText);

                            if (hasEmoji) {
                              return (
                                <span className="user-status-text with-text">
                                  {statusText.split('').map((char, idx) => {
                                    if (/[\p{Emoji}]/u.test(char)) {
                                      return renderEmoji(char, '', 16);
                                    }
                                    return char;
                                  })}
                                </span>
                              );
                            } else {
                              // Просто текст без эмодзи
                              return (
                                <span className="user-status-text with-text">
                                  {statusText}
                                </span>
                              );
                            }
                          } else {
                            // Показываем онлайн/офлайн с last_seen
                            const lastSeenText = isOnline ? 'Онлайн' : (otherUser.last_seen ? `Был(а) ${getLastSeenText(otherUser.last_seen)}` : 'Офлайн');
                            return (
                              <span className={`user-status-text ${isOnline ? 'online' : 'offline'}`}>
                                {lastSeenText}
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

              <div className="chat-header-actions">
                <button
                  className={`chat-search-btn ${chatSearchActive ? 'active' : ''}`}
                  onClick={toggleChatSearch}
                  title="Поиск в чате"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                </button>
                <button
                  className="chat-menu-btn"
                  onClick={handleOpenChatMenu}
                  title="Меню чата"
                >
                  ⋮
                </button>
              </div>
            </header>

            {/* Per-chat search bar */}
            {chatSearchActive && (
              <div className="chat-search-bar">
                <div className="chat-search-input-wrap">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.5 }}>
                    <circle cx="11" cy="11" r="8"/>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  <input
                    type="text"
                    className="chat-search-input"
                    placeholder="Поиск в чате..."
                    value={chatSearchQuery}
                    onChange={e => setChatSearchQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleChatSearch(chatSearchQuery); }}
                    autoFocus
                  />
                  {chatSearchQuery && (
                    <button className="chat-search-clear" onClick={() => { setChatSearchQuery(''); setChatSearchResults([]); setChatSearchIndex(-1); }}>✕</button>
                  )}
                </div>
                {chatSearchResults.length > 0 && (
                  <div className="chat-search-meta">
                    <span className="chat-search-count">{chatSearchIndex + 1} / {chatSearchResults.length}</span>
                    <button className="chat-search-nav" onClick={handleChatSearchPrev} disabled={chatSearchResults.length <= 1}>↑</button>
                    <button className="chat-search-nav" onClick={handleChatSearchNext} disabled={chatSearchResults.length <= 1}>↓</button>
                    <button className="chat-search-close" onClick={toggleChatSearch}>✕</button>
                  </div>
                )}
                {chatSearchQuery && chatSearchResults.length === 0 && chatSearchActive && (
                  <div className="chat-search-meta">
                    <span className="chat-search-count">Нет результатов</span>
                    <button className="chat-search-close" onClick={() => { setChatSearchActive(false); setChatSearchQuery(''); setChatSearchResults([]); setChatSearchIndex(-1); }}>✕</button>
                  </div>
                )}
              </div>
            )}

            <div className="messages-container-main" key={activeChatId || 'no-chat'}>
              {/* Панель закреплённых сообщений */}
              {showPinnedBar && pinnedMessages[activeChatIdRef.current] && pinnedMessages[activeChatIdRef.current].length > 0 && (
                <>
                  {pinnedBarCollapsed ? (
                    <div className="pinned-messages-bar collapsed" onClick={() => setPinnedBarCollapsed(false)}>
                      <span className="pinned-icon">📌</span>
                    </div>
                  ) : (
                    <div className="pinned-messages-bar" onClick={handleOpenPinnedModal}>
                      <div className="pinned-messages-bar-content">
                        <span className="pinned-icon">📌</span>
                        <span className="pinned-text">
                          {pinnedMessages[activeChatIdRef.current].length === 1
                            ? 'Закреплённое сообщение'
                            : `${pinnedMessages[activeChatIdRef.current].length} закреплённых сообщения(й)`}
                        </span>
                        <button className="pinned-collapse-btn" onClick={(e) => { e.stopPropagation(); setPinnedBarCollapsed(true); }} title="Свернуть">
                          ▲
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
              {messages.filter(m => m.id).map((message, index) => {
                // Определяем, является ли сообщение частью группы (предыдущее от того же пользователя)
                const prevMessage = index > 0 ? messages[index - 1] : null;
                const isGrouped = prevMessage && prevMessage.senderId === message.senderId;

                // Определяем текущую сторону
                const isOwn = message.senderId === currentUser?.id;

                // Определяем смену стороны (разделитель между входящими и исходящими)
                let sideChanged = false;
                if (!isGrouped && prevMessage) {
                  const prevIsOwn = prevMessage.senderId === currentUser?.id;
                  sideChanged = isOwn !== prevIsOwn;
                }

                // Определяем, нужно ли показать разделитель даты
                const currentDate = new Date(message.timestamp).toDateString();
                const prevDate = prevMessage ? new Date(prevMessage.timestamp).toDateString() : null;
                const showDateSeparator = !prevDate || currentDate !== prevDate;

                return (
                  <>
                    {showDateSeparator && (
                      <div className="date-separator">
                        <span className="date-separator-line" />
                        <span className="date-separator-text">{formatDate(message.timestamp)}</span>
                        <span className="date-separator-line" />
                      </div>
                    )}
                  <div
                  id={`message-${message.id}`}
                  key={message.id}
                  className={`message-main ${message.senderId === currentUser?.id ? 'own' : ''} ${isBotMessage(message) ? 'message-bot' : ''} ${isGrouped ? 'message-grouped' : ''} ${sideChanged ? 'side-changed' : ''}`}
                  onContextMenu={(e) => handleContextMenu(e, message.id, message.text, message.chatId, message.senderId, message.senderName)}
                >
                  {isOwn && <div className="message-avatar-spacer" />}
                  {!isOwn && (
                    <img
                      src={message.senderAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(message.senderName || 'U')}&background=667eea&color=fff`}
                      alt={message.senderName}
                      className="message-avatar"
                      onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || message.senderName || 'U')}&background=667eea&color=fff`; }}
                    />
                  )}
                  <div className="message-content" data-message-id={message.id}>
                    <div className="message-bubble-wrapper">
                      {!isBotMessage(message) && message.forwarded_from && (
                        <span className="forwarded-badge">
                          ↗️ Переслано от {message.forwarded_from.sender_name}
                        </span>
                      )}
                      {/* Цитата ответа (reply) — кликабельная для прокрутки к оригиналу */}
                      {!isBotMessage(message) && message.reply_to && (
                        <div 
                          className="reply-quote-preview" 
                          onClick={() => scrollToMessage(message.reply_to.messageId)}
                          title="Нажмите, чтобы перейти к оригинальному сообщению"
                        >
                          <span className="reply-quote-icon">↩</span>
                          <div className="reply-quote-content">
                            <p className="reply-quote-text">{stripStickerMarkers(message.reply_to.text)}</p>
                          </div>
                        </div>
                      )}
                      {message.text && !message.poll && (
                        <div className="message-text-wrapper">
                          <div className="message-text-content">
                            <p className={`message-text-main${isStickerOnlyMessage(message.text) ? ' sticker-message' : ''}`} onContextMenu={(e) => handleContextMenu(e, message.id, message.text, message.chatId, message.senderId, message.senderName)}>
                              {isBotMessage(message) ? formatBotText(message.text) : renderMessageContent(message.text)}
                            </p>
                            {!isBotMessage(message) && renderLinkPreviews(message.text)}
                            <div className="message-time-inline">
                              <span className="message-time-main">{formatTime(message.timestamp)}</span>
                              {message.edited && <span className="message-edited-indicator" title="Отредактировано">ред.</span>}
                              {message.expires_at && <span className="self-destruct-indicator" title={`Самоуничтожение: ${formatTimeRemaining(message.expires_at)}`}>🔥</span>}
                              {renderMessageStatus(message)}
                            </div>
                          </div>
                          {/* Реакции под текстом внутри пузыря сообщения */}
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
                                    onClick={() => hasCurrentUserReaction ? handleRemoveReaction(emoji, message.id) : null}
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
                                          onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || 'U')}&background=random`; }}
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
                        </div>
                      )}
                      {/* Poll UI */}
                      {!isBotMessage(message) && message.poll && (
                        <div className="poll-container">
                          <div className="poll-question">
                            {message.poll.question}
                            {message.poll.isClosed && <span className="poll-closed-badge">🔒 Закрыт</span>}
                            {message.poll.closesAt && !message.poll.isClosed && (
                              <span className="poll-closes-badge">⏳ до {formatTime(message.poll.closesAt)}</span>
                            )}
                          </div>
                          <div className="poll-options">
                            {message.poll.options.map((opt, idx) => {
                              const voteCount = message.poll.optionVotes[idx] || 0;
                              const pct = message.poll.totalVotes > 0 ? Math.round((voteCount / message.poll.totalVotes) * 100) : 0;
                              const isVoted = message.poll.votedIndices && message.poll.votedIndices.includes(idx);
                              const canVote = !message.poll.isClosed && (!message.poll.votesHidden || isVoted);
                              return (
                                <button key={idx} className={`poll-option ${isVoted ? 'poll-option-voted' : ''} ${message.poll.isClosed ? 'poll-option-closed' : ''} ${message.poll.votesHidden && !isVoted ? 'poll-option-hidden' : ''}`}
                                  onClick={() => canVote && handlePollVote(message.poll.id, idx)}
                                  disabled={!canVote}
                                  title={message.poll.votesHidden && !isVoted ? 'Результаты скрыты до окончания' : `${opt}: ${voteCount} голос(а/ов)`}>
                                  <span className="poll-option-text">{opt}</span>
                                  {!message.poll.votesHidden && voteCount > 0 && (
                                    <>
                                      <span className="poll-option-bar-track">
                                        <span className="poll-option-bar-fill" style={{ width: `${pct}%` }} />
                                      </span>
                                      <span className="poll-option-pct">{pct}%</span>
                                      {!message.poll.isAnonymous && <span className="poll-option-count">{voteCount}</span>}
                                    </>
                                  )}
                                  {message.poll.votesHidden && !isVoted && <span className="poll-hidden-label">🔒</span>}
                                </button>
                              );
                            })}
                          </div>
                          <div className="poll-footer">
                            {!message.poll.votesHidden && <span className="poll-total-votes">{message.poll.totalVotes} голос(а/ов)</span>}
                            {message.poll.votesHidden && <span className="poll-hidden-info">🔒 Результаты будут показаны после завершения</span>}
                            {message.poll.isAnonymous && <span className="poll-anon-badge">Анонимно</span>}
                            {message.poll.allowsMultiple && <span className="poll-multi-badge">Множественный выбор</span>}
                          </div>
                        </div>
                      )}
                    </div>
                    {/* Кнопки бота */}
                    {isBotMessage(message) && message.buttons && message.buttons.length > 0 && (
                      <div className="bot-buttons">
                        {message.buttons.map((btn, idx) => (
                          <button
                            key={idx}
                            className="bot-button"
                            onClick={() => handleBotButtonClick(btn.action)}
                          >
                            {btn.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {/* Файлы только для обычных сообщений (не бота) */}
                    {!isBotMessage(message) && message.file && (
                      <div className="message-file-main">
                        {message.file.mimetype?.startsWith('image/') ? (
                          <img
                            src={message.file.url}
                            alt={message.file.filename}
                            onClick={() => handleImageClick(message.file.url, message.file.filename)}
                            className="message-image-clickable"
                          />
                        ) : message.file.mimetype?.startsWith('audio/') ? (
                          <VoiceMessagePlayer src={message.file.url} />
                        ) : (
                          <a href={`${SOCKET_URL}/api/download/${extractFileUuidFromUrl(message.file.url)}`} className="file-link-main" title={message.file.filename} download>
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
                  {/* Аватар для исходящих — после контента (скрывается через CSS при группировке) */}
                  {isOwn && (
                    <img
                      src={message.senderAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(message.senderName || 'U')}&background=667eea&color=fff`}
                      alt={message.senderName}
                      className="message-avatar"
                      onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || message.senderName || 'U')}&background=667eea&color=fff`; }}
                    />
                  )}
                </div>
                </>
              );
            })}
              <div ref={messagesEndRef} />
            </div>

            {/* Попап "Кто прочитал" */}
            {readByPopup && (
              <>
                <div className="read-by-overlay" onClick={() => setReadByPopup(null)} />
                <div className="read-by-popup" style={{ left: readByPopup.x, top: readByPopup.y }}>
                  <div className="read-by-header">Прочитано</div>
                  {readByPopup.readers.length === 0 ? (
                    <div className="read-by-empty">Нет данных</div>
                  ) : (
                    readByPopup.readers.map(r => (
                      <div key={r.user_id} className="read-by-user">
                        <img src={r.avatar || `https://ui-avatars.com/api/?name=${r.username}`} alt={r.username} className="read-by-avatar" />
                        <span className="read-by-name">{r.username}</span>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            {/* @mention popup */}
            {mentionPopup.show && (() => {
              const participants = (activeChat?.participantsDetails || []).filter(
                p => p.id !== currentUser?.id && p.username.toLowerCase().includes(mentionPopup.filter.toLowerCase())
              );
              if (participants.length === 0) return null;
              return (
                <div className="mention-dropdown" style={{ left: mentionPopup.x, top: mentionPopup.y }}>
                  {participants.slice(0, 10).map(p => (
                    <div key={p.id} className="mention-item" onClick={() => handleMentionSelect(p.username)} onMouseDown={e => e.preventDefault()}>
                      <img src={p.avatar || `https://ui-avatars.com/api/?name=${p.username}`} alt={p.username} className="mention-avatar" />
                      <span className="mention-name">{p.username}</span>
                    </div>
                  ))}
                </div>
              );
            })()}

            <div
              className={`message-form-drop-zone ${isDragOver ? 'drag-over' : ''}`}
              onDragOver={handleDragOver}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <form className="message-form-main" style={{ position: 'relative' }} onSubmit={handleSendMessage}>
              {/* Inline picker смайлов */}
              <EmojiInlinePicker
                show={showEmojiPicker}
                onEmojiClick={(emoji) => handleAddEmoji(emoji)}
                onStickerSend={handleStickerSend}
                onClose={() => {
                  setShowEmojiPicker(false);
                  setEmojiPickerPinned(false);
                }}
                theme={appTheme}
                serverUrl={SOCKET_URL}
              />

              {/* Inline reply preview */}
              {replyToMessage && (
                <div className="inline-reply-preview">
                  <div className="inline-reply-bar">
                    <span className="inline-reply-icon">↩</span>
                    <span className="inline-reply-label">Ответ на сообщение от {replyToMessage.senderName}</span>
                    <button type="button" className="inline-reply-cancel" onClick={cancelReply} title="Отменить ответ">✕</button>
                  </div>
                  <p className="inline-reply-text">{stripStickerMarkers(replyToMessage.text)}</p>
                </div>
              )}
              {/* Индикатор режима редактирования */}
              {isEditMode && (
                <div className="edit-mode-indicator">
                  <span className="edit-mode-icon">✏️</span>
                  <span className="edit-mode-text">Режим редактирования</span>
                  <button type="button" className="edit-mode-cancel" onClick={cancelEditMessage} title="Отменить редактирование">✕</button>
                </div>
              )}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                style={{ display: 'none' }}
                id="file-input-main"
              />
              {selectedFile && (
                <span className="selected-file-main">
                  📎 {selectedFile.name}
                  <button type="button" onClick={() => {
                    setSelectedFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}>✕</button>
                </span>
              )}
              <div ref={addMenuRef} style={{ position: 'relative', display: 'inline-flex', alignSelf: 'center', marginRight: '8px' }}>
                <button type="button" className="add-menu-btn" onClick={(e) => { e.preventDefault(); setShowAddMenu(prev => !prev); }} title="Добавить">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="16"/>
                    <line x1="8" y1="12" x2="16" y2="12"/>
                  </svg>
                </button>
                {showAddMenu && (
                  <div className="add-menu-dropdown">
                    <div className="chat-menu-item" onClick={(e) => { e.preventDefault(); fileInputRef.current?.click(); setShowAddMenu(false); }}>
                      <span className="menu-icon">📎</span>
                      Прикрепить файл
                    </div>
                    <div className="chat-menu-item" onClick={(e) => { e.preventDefault(); setShowPollModal(true); setShowAddMenu(false); }}>
                      <span className="menu-icon">📊</span>
                      Создать опрос
                    </div>
                  </div>
                )}
              </div>
              <div
                ref={messageInputRef}
                className={`message-input-contenteditable ${isEditMode ? 'edit-mode-active' : ''}`}
                contentEditable
                suppressContentEditableWarning
                data-placeholder="Введите сообщение..."
                onContextMenu={handleInputContextMenu}
                onPaste={handleImagePaste}
                onKeyDown={handleInputKeyDown}
                onInput={(e) => {
                  const text = e.currentTarget.textContent;
                  setInputText(text);

                  // Detect @mention context
                  const ctx = getMentionContext();
                  if (ctx) {
                    setMentionPopup({ show: true, filter: ctx.filter, x: ctx.x, y: ctx.y });
                  } else {
                    setMentionPopup(prev => prev.show ? { show: false, filter: '', x: 0, y: 0 } : prev);
                  }

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
                  // Сохраняем черновик при потере фокуса полем ввода
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

            {/* Выпадающее меню чата */}
            {showChatMenu && (
              <div
                className="chat-menu-dropdown"
                style={{ top: chatMenuPosition.top, right: chatMenuPosition.right }}
              >
                {activeChat?.type === 'direct' && activeChat.participantsDetails && (() => {
                  const otherUser = activeChat.participantsDetails.find(p => p.username !== currentUser?.username);
                  return (
                    <div className="chat-menu-item" onClick={handleViewUserInfo}>
                      <span className="menu-icon">
                        {otherUser ? (
                          <img src={otherUser.avatar || activeChat.avatar || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(otherUser.username)} alt={otherUser.username} className="menu-avatar" onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || 'U')}`; }} />
                        ) : (
                          <span className="emoji-animated">👤</span>
                        )}
                      </span>
                      <span>Информация о пользователе</span>
                    </div>
                  );
                })()}
                {activeChat?.type !== 'direct' && (
                  <div className="chat-menu-item" onClick={handleViewUserInfo}>
                    <span className="menu-icon"><span className="emoji-animated">👤</span></span>
                    <span>Информация о пользователе</span>
                  </div>
                )}
                <div className="chat-menu-item" onClick={handleViewMedia}>
                  <span className="menu-icon"><span className="emoji-animated">🖼️</span></span>
                  <span>Медиафайлы</span>
                </div>
                <div className="chat-menu-item" onClick={handleViewDocuments}>
                  <span className="menu-icon"><span className="emoji-animated">📄</span></span>
                  <span>Документы</span>
                </div>
                {(activeChat?.type === 'direct' || activeChat?.type === 'group') && (
                  <div className={`chat-menu-item ${e2eeEnabled[activeChatId] ? 'active-e2ee' : ''}`} onClick={handleToggleE2EE}>
                    <span className="menu-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}>
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                      </svg>
                    </span>
                    <span>{e2eeEnabled[activeChatId] ? '🔒 E2EE включено' : '🔓 E2EE шифрование'}</span>
                  </div>
                )}
                {activeChat?.type === 'group' && (
                  <>
                    {activeChat.created_by === currentUser?.id && (
                      <div className="chat-menu-item" onClick={handleManageParticipants}>
                        <span className="menu-icon"><span className="emoji-animated">👥</span></span>
                        <span>Управление участниками</span>
                      </div>
                    )}
                    <div className="chat-menu-item" onClick={handleLeaveGroup}>
                      <span className="menu-icon"><span className="emoji-animated">🚪</span></span>
                      <span>Выйти из группы</span>
                    </div>
                  </>
                )}
                <div className="chat-menu-divider"></div>
                <div className="chat-menu-item danger" onClick={handleDeleteChat}>
                  <span className="menu-icon"><span className="emoji-animated">❌</span></span>
                  <span>Удалить чат</span>
                </div>
              </div>
            )}

            {/* Контекстное меню сообщения */}
            {showMessageMenu && selectedMessage && (
              <div
                className="message-menu-dropdown"
                style={{ 
                  top: messageMenuPosition.top + 'px', 
                  left: messageMenuPosition.left + 'px', 
                  position: 'fixed', 
                  zIndex: 9999,
                  background: 'white',
                  borderRadius: '8px',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                  padding: '8px 0'
                }}
              >
                <div
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleForwardMessage(selectedMessage);
                    setShowMessageMenu(false);
                  }}
                  style={{
                    padding: '10px 16px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                  }}
                >
                  <span>↗️</span>
                  <span>Переслать</span>
                </div>
                <div
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleCopyMessage();
                    setShowMessageMenu(false);
                  }}
                  style={{
                    padding: '10px 16px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                  }}
                >
                  <span>📋</span>
                  <span>Копировать</span>
                </div>
                {currentUser?.is_admin === 1 && (
                  <div
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!selectedMessage || !selectedMessage.id) {
                        alert('Невозможно удалить сообщение: отсутствует ID сообщения');
                        setShowMessageMenu(false);
                        return;
                      }
                      if (confirm('Удалить это сообщение?')) {
                        handleDeleteMessage(selectedMessage);
                      }
                      setShowMessageMenu(false);
                    }}
                    style={{
                      padding: '10px 16px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      color: '#dc3545'
                    }}
                  >
                    <span>🗑️</span>
                    <span>Удалить</span>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="no-chat-selected">
            <h2>Выберите чат для начала общения</h2>
            <p>Или создайте новый чат</p>
            <button onClick={() => setShowNewChatModal(true)}>Создать чат</button>
          </div>
        )}
      </main>
      )}

      {/* Вкладка телефонной книги */}
      {activeView === 'phonebook' && (
        <main className="full-page-view">
          <div className="full-page-header">
            <div className="full-page-header-content">
              <button className="back-to-chats-btn white" onClick={handleOpenChats} title="Вернуться к чатам">
                ← Чаты
              </button>
              <h2>📖 Телефонная книга</h2>
            </div>
          </div>
          <div className="full-page-content">
            <div className="phonebook-controls">
              <input
                type="text"
                placeholder="Поиск по ФИО..."
                value={phonebookSearchQuery}
                onChange={(e) => setPhonebookSearchQuery(e.target.value)}
                className="phonebook-search-input full-page"
              />
              <div className="phonebook-view-controls">
                <div className="control-group">
                  <span className="control-label">Вид:</span>
                  <button 
                    className={`view-btn ${phonebookViewMode === 'grid' ? 'active' : ''}`}
                    onClick={() => setPhonebookViewMode('grid')}
                    title="Плитка"
                  >
                    ▦
                  </button>
                  <button 
                    className={`view-btn ${phonebookViewMode === 'list' ? 'active' : ''}`}
                    onClick={() => setPhonebookViewMode('list')}
                    title="Список"
                  >
                    ☰
                  </button>
                </div>
                <div className="control-group">
                  <span className="control-label">Сортировка:</span>
                  <button 
                    className={`sort-btn ${phonebookSortMode === 'name' ? 'active' : ''}`}
                    onClick={() => setPhonebookSortMode('name')}
                  >
                    А-Я
                  </button>
                  <button 
                    className={`sort-btn ${phonebookSortMode === 'none' ? 'active' : ''}`}
                    onClick={() => setPhonebookSortMode('none')}
                  >
                    Без сортировки
                  </button>
                </div>
              </div>
            </div>
            <div className={`phonebook-grid ${phonebookViewMode === 'list' ? 'phonebook-list-view' : ''}`}>
              {(() => {
                let filteredUsers = users
                  .filter(user => {
                    if (!phonebookSearchQuery.trim()) return true;
                    const query = phonebookSearchQuery.toLowerCase();
                    const fullName = (user.fullName || '').toLowerCase();
                    const username = (user.username || '').toLowerCase();
                    return fullName.includes(query) || username.includes(query);
                  })
                  .filter(user => user.work_phone);
                
                // Сортировка по имени
                if (phonebookSortMode === 'name') {
                  filteredUsers = filteredUsers.sort((a, b) => {
                    const nameA = (a.fullName || a.username || '').toLowerCase();
                    const nameB = (b.fullName || b.username || '').toLowerCase();
                    return nameA.localeCompare(nameB, 'ru');
                  });
                }
                
                return filteredUsers.map(user => (
                  <div key={user.id} className="phonebook-card">
                    <div className="phonebook-card-header">
                      <img src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.username)}`} alt={user.username} className="phonebook-card-avatar" onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || user.username || 'U')}`; }} />
                      <div className="phonebook-card-info">
                        <span className="phonebook-card-username">{user.username}</span>
                        {user.fullName && <span className="phonebook-card-fullname">{user.fullName}</span>}
                        {user.about && <span className="phonebook-card-position">{user.about}</span>}
                      </div>
                    </div>
                    <div className="phonebook-card-phone">
                      <span className="phone-icon">📞</span>
                      <span className="phone-number">{user.work_phone}</span>
                    </div>
                  </div>
                ));
              })()}
              {users.filter(user => user.work_phone).length === 0 && (
                <div className="no-phonebook-entries">Нет записей с рабочими номерами</div>
              )}
              {(() => {
                let filteredUsers = users
                  .filter(user => {
                    if (!phonebookSearchQuery.trim()) return true;
                    const query = phonebookSearchQuery.toLowerCase();
                    const fullName = (user.fullName || '').toLowerCase();
                    const username = (user.username || '').toLowerCase();
                    return fullName.includes(query) || username.includes(query);
                  })
                  .filter(user => user.work_phone);
                
                if (phonebookSortMode === 'name') {
                  filteredUsers = filteredUsers.sort((a, b) => {
                    const nameA = (a.fullName || a.username || '').toLowerCase();
                    const nameB = (b.fullName || b.username || '').toLowerCase();
                    return nameA.localeCompare(nameB, 'ru');
                  });
                }
                
                return filteredUsers.length === 0 && phonebookSearchQuery.trim() !== '' ? (
                  <div className="no-phonebook-entries">По запросу ничего не найдено</div>
                ) : null;
              })()}
            </div>
          </div>
        </main>
      )}

      {/* Вкладка календаря */}
      {activeView === 'calendar' && (
        <main className="full-page-view">
          <div className="full-page-header">
            <div className="full-page-header-content">
              <button className="back-to-chats-btn white" onClick={handleOpenChats} title="Вернуться к чатам">
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
                onClick={() => setCalendarView('tasks')}
              >
                📋 Задачи
              </button>
              <button
                className={`calendar-tab-btn ${calendarView === 'meeting-room' ? 'active' : ''}`}
                onClick={() => {
                  setCalendarView('meeting-room');
                  const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
                  const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
                  fetchMeetingRoomBookings(startOfMonth, endOfMonth);
                }}
              >
                🏢 Бронирование переговорной
              </button>
            </div>

            <div className="calendar-layout-wrapper">
              {/* Левая колонка - Календарь */}
              <div className="calendar-left-panel">
                <div className="calendar-header">
                  <button className="calendar-nav-btn" onClick={handlePrevMonth}>◀</button>
                  <h4 className="calendar-month-title">
                    {currentMonth.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
                  </h4>
                  <button className="calendar-nav-btn" onClick={handleNextMonth}>▶</button>
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
                        const dayBookings = meetingRoomBookings.filter(b => b.meeting_date === dateStr);
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
                        onClick={() => handleDateClick(date)}
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
                        {/* Показываем точки бронирований в режиме переговорной */}
                        {calendarView === 'meeting-room' && (
                        <div className="calendar-tasks-preview">
                          {dayBookings.length > 0 && <div style={{ width: '100%', fontSize: '7px', color: '#4ecdc4', fontWeight: 'bold' }}>● {dayBookings.length}</div>}
                          {dayBookings.slice(0, 3).map(booking => (
                            <div
                              key={booking.id}
                              className="calendar-meeting-dot"
                              style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#4ecdc4', border: '1px solid #fff' }}
                              title={`🏢 ${booking.title} (${booking.start_time}-${booking.end_time})`}
                            ></div>
                          ))}
                          {dayBookings.length > 3 && (
                            <span className="calendar-tasks-more">+{dayBookings.length - 3}</span>
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
                      <button className="add-task-btn" onClick={handleOpenNewTaskModal}>
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
                                <img src={birthday.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(birthday.username)}`} alt={birthday.username} className="birthday-avatar" onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || birthday.username || 'U')}`; }} />
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
                            onClick={() => handleEditTask(task)}
                          >
                            {(task.task_time || task.task_end_time) && (
                              <div className="calendar-task-time-block">
                                <span className="calendar-task-time-range">{task.task_time || '--:--'} – {task.task_end_time || '--:--'}</span>
                              </div>
                            )}
                            <div className="calendar-task-content">
                              <div className="calendar-task-title-row">
                                <div className="calendar-task-title">{task.title}</div>
                                <div className="calendar-task-actions">
                                  <button
                                    className="task-action-btn share"
                                    onClick={(e) => { e.stopPropagation(); handleShareTask(task); }}
                                    title="Поделиться"
                                  >
                                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                                      <polyline points="16,6 12,2 8,6"/>
                                      <line x1="12" y1="2" x2="12" y2="15"/>
                                    </svg>
                                  </button>
                                  <button
                                    className="task-action-btn edit"
                                    onClick={(e) => { e.stopPropagation(); handleEditTask(task); }}
                                    title="Редактировать"
                                  >
                                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                                    </svg>
                                  </button>
                                  <button
                                    className="task-action-btn delete"
                                    onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.id); }}
                                    title="Удалить"
                                  >
                                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="3,6 5,6 21,6"/>
                                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                    </svg>
                                  </button>
                                </div>
                              </div>
                              {task.description && (
                                <div className="calendar-task-description">{task.description}</div>
                              )}
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
                  <button className="add-task-btn" onClick={() => { 
                    fetchAvailableUsers(); 
                    setEditingBooking(null); 
                    const formatDate = (d) => {
                      const y = d.getFullYear();
                      const m = String(d.getMonth() + 1).padStart(2, '0');
                      const day = String(d.getDate()).padStart(2, '0');
                      return `${y}-${m}-${day}`;
                    };
                    setMeetingForm({
                      title: '',
                      description: '',
                      meetingDate: selectedDate ? formatDate(selectedDate) : '',
                      startTime: '',
                      endTime: '',
                      organizer: '',
                      reminderMinutes: '15'
                    });
                    setSelectedMeetingParticipants([]);
                    setParticipantSearchText('');
                    setModalKey(k => k + 1);
                    setShowMeetingModal(true); 
                  }}>
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
                
                console.log('Поиск бронирований на дату:', dateStr);
                console.log('Все бронирования:', meetingRoomBookings);
                
                const dayBookings = meetingRoomBookings.filter(b => {
                  const bookingDate = b.meeting_date;
                  return bookingDate === dateStr;
                });
                
                console.log('Найдено бронирований:', dayBookings.length);
                
                return dayBookings.length > 0 ? (
                  <div className="bookings-list">
                    {dayBookings.map(booking => {
                      const participants = booking.participants_list || [];
                      return (
                      <div key={booking.id} className="booking-item">
                        <div className="booking-time-block">
                          <span className="booking-time-range">{booking.start_time} – {booking.end_time}</span>
                          {(participants.length > 0 || booking.reminder_minutes) && (
                            <div className="booking-participants">
                              {participants.length > 0 && participants.map((p, i) => (
                                <span key={p.user_id} className="booking-participant">
                                  {p.username}
                                </span>
                              ))}
                              {booking.reminder_minutes && participants.length > 0 && (
                                <div className="participant-separator">·</div>
                              )}
                              {booking.reminder_minutes && (
                                <span className="booking-reminder" title={`Напоминание за ${booking.reminder_minutes} мин до начала`}>
                                  🔔 {booking.reminder_minutes} мин
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="booking-content">
                          <div className="booking-title-row">
                            <h6 className="booking-title">{booking.title}</h6>
                            {/* Кнопки действий */}
                            {(canBookMeetingRoom || currentUser?.username === 'Root' || currentUser?.is_admin === 1) && (
                              booking.organizer_id === currentUser?.id || isAdmin) && (
                              <div className="booking-actions">
                                <button
                                  className="booking-action-btn edit"
                                  onClick={() => handleEditBooking(booking)}
                                  title="Редактировать"
                                >
                                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                                  </svg>
                                </button>
                                <button
                                  className="booking-action-btn delete"
                                  onClick={() => handleDeleteBooking(booking.id)}
                                  title="Удалить"
                                >
                                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="3,6 5,6 21,6"/>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                  </svg>
                                </button>
                              </div>
                            )}
                          </div>
                          {booking.description && (
                            <p className="booking-description">{booking.description}</p>
                          )}
                          <span className="booking-organizer">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="organizer-icon">
                              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                              <circle cx="12" cy="7" r="4"/>
                            </svg>
                            {' '}{booking.organizer_name}
                          </span>
                        </div>
                      </div>
                      );
                    })}
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

      {activeView === 'kpi' && (
        <div className="kpi-view">
          <div className="kpi-topbar">
            <div className="kpi-topbar-left">
              <h2 className="kpi-title">Ключевые показатели</h2>
              {kpiData?.date && <span className="kpi-date-badge">{kpiData.date.replace(/-/g, '.')}</span>}
              {kpiData && Object.values(kpiData.groups).flat().some(i => i.updated_at) && (
                <span className="kpi-updated-badge" title="Последнее обновление">
                  обновлено {Object.values(kpiData.groups).flat().filter(i => i.updated_at).sort((a,b) => b.updated_at?.localeCompare(a.updated_at || ''))[0]?.updated_at?.slice(11,16) || ''}
                </span>
              )}
            </div>
            <div className="kpi-topbar-right">
              {isAdmin && !kpiEditMode && (
                <button className="kpi-btn kpi-btn-refresh" onClick={handleKpiRefresh} disabled={kpiRefreshing}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                  {kpiRefreshing ? 'Обновление...' : 'Обновить из БД'}
                </button>
              )}
              {isAdmin && !kpiEditMode && (
                <button className="kpi-btn kpi-btn-edit" onClick={handleKpiEdit}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Редактировать
                </button>
              )}
              {isAdmin && kpiEditMode && (
                <>
                  <button className="kpi-btn kpi-btn-save" onClick={handleKpiSave}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                    Сохранить
                  </button>
                  <button className="kpi-btn kpi-btn-cancel" onClick={() => setKpiEditMode(false)}>Отмена</button>
                </>
              )}
              <button className="kpi-btn kpi-btn-close" onClick={() => setActiveView('chats')}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>

          {!kpiData ? (
            <div className="kpi-loading-state">
              <div className="kpi-loading-spinner" />
              <span>Загрузка показателей...</span>
            </div>
          ) : (
            <div className="kpi-dashboard">
              {/* Period tabs */}
              <div className="kpi-period-tabs">
                {PERIOD_TABS.map(tab => (
                  <button key={tab.key}
                    className={`kpi-period-tab ${kpiPeriod === tab.key ? 'active' : ''}`}
                    onClick={() => setKpiPeriod(tab.key)}>
                    {tab.label}
                  </button>
                ))}
              </div>
              {/* Summary cards */}
              <div className="kpi-summary">
                <div className="kpi-summary-cards">
                  {(() => {
                    const topItems = [];
                    const sales = kpiData.groups['Продажи'];
                    if (sales) topItems.push((sales.filter(kpiPeriodFilter))[0]);
                    const frs = kpiData.groups['ФРС Контур'];
                    if (frs) topItems.push((frs.filter(kpiPeriodFilter))[0]);
                    const opt = kpiData.groups['Опт (PBI)'];
                    if (opt) topItems.push((opt.filter(kpiPeriodFilter))[0]);
                    const retail = kpiData.groups['Розница (PBI)'];
                    if (retail) topItems.push((retail.filter(kpiPeriodFilter))[0]);
                    return topItems.filter(Boolean).map((item, idx) => {
                      const colors = ['#4f8cff','#1abc9c','#f39c12','#e74c3c','#9b59b6'];
                      const c = colors[idx % colors.length];
                      const pct = item.value != null && item.plan_value > 0 ? (item.value / item.plan_value) * 100 : null;
                      return (
                        <div key={item.id} className="kpi-summary-card" style={{'--card-accent':c}}>
                          <div className="kpi-summary-card-top">
                            <span className="kpi-summary-card-label">{item.name}</span>
                            {pct != null && (
                              <span className={`kpi-summary-card-badge ${pct >= 100 ? 'badge-ok' : 'badge-warn'}`}>
                                {pct >= 100 ? '✓' : '✗'} {Math.round(pct)}%
                              </span>
                            )}
                          </div>
                          <div className="kpi-summary-card-main">
                            {kpiEditMode ? (
                              <div className="kpi-summary-edit-row">
                                <input type="number" className="kpi-input kpi-input-sm" value={kpiDraft[item.id]?.value ?? ''}
                                  onChange={e => setKpiDraft(p => ({ ...p, [item.id]: { ...p[item.id], value: e.target.value } }))}
                                  placeholder="Факт" />
                                <input type="number" className="kpi-input kpi-input-sm" value={kpiDraft[item.id]?.plan_value ?? ''}
                                  onChange={e => setKpiDraft(p => ({ ...p, [item.id]: { ...p[item.id], plan_value: e.target.value } }))}
                                  placeholder="План" />
                              </div>
                            ) : (
                              <span className="kpi-summary-card-val">
                                {item.value != null ? Number(item.value).toLocaleString('ru-RU') : <span className="kpi-na">—</span>}
                                <span className="kpi-summary-card-unit">{item.unit}</span>
                              </span>
                            )}
                          </div>
                          {pct != null && !kpiEditMode && (
                            <div className="kpi-summary-card-bar">
                              <div className="kpi-summary-card-bar-track">
                                <div className="kpi-summary-card-bar-fill" style={{width: Math.min(pct, 100)+'%', background: pct >= 100 ? '#2ecc71' : pct >= 70 ? '#f39c12' : '#e74c3c'}} />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              {/* Detailed groups */}
              <div className="kpi-groups">
                {Object.entries(kpiData.groups).map(([groupName, items]) => {
                  const groupIcons = {
                    'Продажи': <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
                    'ФРС Контур': <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>
                  };
                  const groupColors = {
                    'Продажи': '#4f8cff',
                    'ФРС Контур': '#1abc9c'
                  };
                  const gc = groupColors[groupName] || '#666';
                  const factTotal = items.reduce((s, i) => s + (i.value || 0), 0);
                  const planTotal = items.reduce((s, i) => s + (i.plan_value || 0), 0);
                  const filteredItems = items.filter(kpiPeriodFilter);
                  if (filteredItems.length === 0) return null;
                  return (
                    <div key={groupName} className="kpi-group-block">
                      <div className="kpi-group-block-header" style={{borderLeftColor: gc}}>
                        <div className="kpi-group-block-title">
                          {groupIcons[groupName] || null}
                          <h3>{groupName}</h3>
                          {groupName === 'ФРС Контур' && kpiData?.date && (
                            <span className="kpi-group-data-label">данные за {kpiData.date.replace(/-/g, '.')}</span>
                          )}
                        </div>
                        {planTotal > 0 && (
                          <span className={`kpi-group-block-total ${(factTotal/planTotal) >= 1 ? 'total-ok' : 'total-warn'}`}>
                            {Math.round((factTotal/planTotal)*100)}%
                          </span>
                        )}
                      </div>
                      <div className="kpi-group-block-cards">
                        {filteredItems.map(item => {
                          const pct = item.value != null && item.plan_value > 0 ? (item.value / item.plan_value) * 100 : null;
                          return (
                            <div key={item.id} className="kpi-card" style={{'--card-accent': gc}}>
                              <div className="kpi-card-header">
                                <span className="kpi-card-name">{item.name}</span>
                                {KPI_PERIODS[item.id] && (
                                  <span className={`kpi-period-badge kpi-period-${KPI_PERIODS[item.id]}`}>
                                    {PERIOD_TABS.find(t => t.key === KPI_PERIODS[item.id])?.label || ''}
                                  </span>
                                )}
                                {pct != null && !kpiEditMode && (
                                  <span className="kpi-card-badge" style={{
                                    background: pct >= 100 ? 'rgba(46,204,113,0.12)' : 'rgba(231,76,60,0.12)',
                                    color: pct >= 100 ? '#27ae60' : '#c0392b'
                                  }}>
                                    {pct >= 100 ? '↑' : '↓'} {Math.round(pct)}%
                                  </span>
                                )}
                              </div>
                              <div className="kpi-card-body">
                                {kpiEditMode ? (
                                  <div className="kpi-card-edit">
                                    <div className="kpi-card-edit-field">
                                      <span className="kpi-card-edit-label">Факт</span>
                                      <input type="number" className="kpi-input" value={kpiDraft[item.id]?.value ?? ''}
                                        onChange={e => setKpiDraft(p => ({ ...p, [item.id]: { ...p[item.id], value: e.target.value } }))} />
                                    </div>
                                    <div className="kpi-card-edit-field">
                                      <span className="kpi-card-edit-label">План</span>
                                      <input type="number" className="kpi-input" value={kpiDraft[item.id]?.plan_value ?? ''}
                                        onChange={e => setKpiDraft(p => ({ ...p, [item.id]: { ...p[item.id], plan_value: e.target.value } }))} />
                                    </div>
                                  </div>
                                ) : (
                                  <div className="kpi-card-values">
                                    <div className="kpi-card-value-row">
                                      <span className="kpi-card-value-num">
                                        {item.value != null ? Number(item.value).toLocaleString('ru-RU') : <span className="kpi-na">—</span>}
                                      </span>
                                      <span className="kpi-card-value-unit">{item.unit}</span>
                                    </div>
                                    {item.plan_value != null && (
                                      <div className="kpi-card-plan-row">
                                        <span className="kpi-card-plan-label">план</span>
                                        <span className="kpi-card-plan-val">{Number(item.plan_value).toLocaleString('ru-RU')}</span>
                                        <span className="kpi-card-value-unit">{item.unit}</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                              {pct != null && !kpiEditMode && (
                                <div className="kpi-card-bar">
                                  <div className="kpi-card-bar-track">
                                    <div className="kpi-card-bar-fill" style={{
                                      width: Math.min(pct, 100) + '%',
                                      background: pct >= 100 ? '#2ecc71' : pct >= 70 ? '#e67e22' : '#e74c3c'
                                    }} />
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {selectedReport && (
        <div className="report-viewer-overlay" onClick={() => setSelectedReport(null)}>
          <div className="report-viewer-modal" onClick={e => e.stopPropagation()}>
            <div className="report-viewer-header">
              <h3>{selectedReport.name}</h3>
              <div className="report-viewer-actions">
                <a className="report-viewer-download" href={`${SOCKET_URL}/api/pbi-reports/${selectedReport.id}/pdf`} target="_blank" rel="noopener noreferrer" title="Скачать PDF">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  PDF
                </a>
                {isAdmin && (
                  <button className="report-viewer-perm-btn" onClick={() => setShowReportPermEditor(p => !p)} title="Настроить доступ">
                    ⚙️ Доступ
                  </button>
                )}
                <button className="close-btn" onClick={() => setSelectedReport(null)}>✕</button>
              </div>
            </div>
            {showReportPermEditor && isAdmin && (
              <div className="report-perm-editor">
                <h4>Кому доступен отчёт</h4>
                <div className="report-perm-list">
                  {users.filter(u => u.id !== currentUser?.id).map(user => (
                    <label key={user.id} className="report-perm-item">
                      <input type="checkbox" checked={reportPermissions.includes(user.id)} onChange={async (e) => {
                        const newPerms = e.target.checked
                          ? [...reportPermissions, user.id]
                          : reportPermissions.filter(id => id !== user.id);
                        setReportPermissions(newPerms);
                        await fetch(`${SOCKET_URL}/api/pbi-reports/${selectedReport.id}/permissions`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json', 'X-User-Id': currentUser?.id || '' },
                          body: JSON.stringify({ userIds: newPerms })
                        });
                      }} />
                      <span>{user.username}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <iframe
              className="report-viewer-iframe"
              src={`${SOCKET_URL}/api/pbi-reports/${selectedReport.id}/view`}
              title={selectedReport.name}
            />
          </div>
        </div>
      )}

      {/* Вкладка wiki */}
      {activeView === 'wiki' && (
        <div className="wiki-view">
          <aside className="wiki-sidebar">
            <div className="wiki-sidebar-header">
              <h3>📚 База знаний</h3>
              {(isAdmin || canEditWiki || isAnyCategoryEditor) && (
                <button className="wiki-new-article-btn" onClick={async () => {
                  try {
                    const res = await fetch(`${SOCKET_URL}/api/wiki/articles`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        title: 'Новая статья',
                        content: '',
                        categoryId: wikiActiveCategory || null,
                        userId: currentUser.id
                      })
                    });
                    const data = await res.json();
                    if (data.success) {
                      setWikiActiveArticle(data.article);
                      setWikiEditMode(true);
                      setWikiEditTitle('');
                      setWikiEditContent('');
                      setWikiEditCategory(wikiActiveCategory || '');
                      setWikiFiles([]);
                      setWikiAccessLevel('public');
                      setWikiAllowedUsers([]);
                    }
                  } catch (err) {
                    console.error('Ошибка создания статьи:', err);
                  }
                }}>+ Статья</button>
              )}
              {(isAdmin || isAnyCategoryEditor) && (
                <button className="wiki-new-cat-btn" onClick={() => { setWikiEditingCategory(null); setWikiCategoryName(''); setWikiCategoryDesc(''); setWikiCategoryParent(wikiActiveCategory || ''); setWikiCategoryEditorIds([]); setWikiCategoryEditorSearch(''); setShowWikiCategoryModal(true); }}>+ Категория</button>
              )}
            </div>
            <div className="wiki-category-list">
              <div className={`wiki-cat-item ${!wikiActiveCategory ? 'active' : ''}`}
                onClick={() => { setWikiActiveCategory(null); setWikiActiveArticle(null); setWikiEditMode(false); setWikiFiles([]); }}>
                📋 Все статьи
              </div>
              {(() => {
                const renderTree = (parentId, depth) => {
                  return wikiCategories
                    .filter(c => parentId === null ? !c.parent_id : c.parent_id === parentId)
                    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name))
                    .map(cat => {
                      const hasChildren = wikiCategories.some(c => c.parent_id === cat.id);
                      const isExpanded = wikiExpandedCategories.has(cat.id);
                      return (
                        <React.Fragment key={cat.id}>
                          <div className={`wiki-cat-item ${wikiActiveCategory === cat.id ? 'active' : ''}`}
                            style={{ paddingLeft: 16 + depth * 20 }}
                            onClick={() => { setWikiActiveCategory(cat.id); setWikiActiveArticle(null); setWikiEditMode(false); setWikiFiles([]); }}>
                            <span className="wiki-expand-btn"
                              style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
                              onClick={hasChildren ? e => {
                                e.stopPropagation();
                                const newSet = new Set(wikiExpandedCategories);
                                if (isExpanded) newSet.delete(cat.id);
                                else newSet.add(cat.id);
                                setWikiExpandedCategories(newSet);
                              } : undefined}>{isExpanded ? '▼' : '▶'}</span>
                            <span>📂 {cat.name}</span>
                            {(isAdmin || isCategoryEditable(cat.id)) && (
                              <span className="wiki-cat-actions">
                                <button className="wiki-cat-edit-btn" title="Редактировать" onClick={async e => { e.stopPropagation(); setWikiEditingCategory(cat); setWikiCategoryName(cat.name); setWikiCategoryDesc(cat.description || ''); setWikiCategoryParent(cat.parent_id || ''); setWikiCategoryEditorIds([]); try { const r = await fetch(`${SOCKET_URL}/api/wiki/categories/${cat.id}/editors`); if (r.ok) { const d = await r.json(); if (d.editorIds) setWikiCategoryEditorIds(d.editorIds); } } catch (_) {} setShowWikiCategoryModal(true); }}>✏️</button>
                                <button className="wiki-cat-del-btn" title="Удалить" onClick={e => { e.stopPropagation(); wikiDeleteCategory(cat.id); }}>🗑️</button>
                              </span>
                            )}
                          </div>
                          {hasChildren && isExpanded && renderTree(cat.id, depth + 1)}
                        </React.Fragment>
                      );
                    });
                };
                return renderTree(null, 0);
              })()}
            </div>
          </aside>
          <main className="wiki-main">
            {wikiEditMode ? (
              <div className="wiki-editor">
                <input type="text" className="wiki-edit-title" placeholder="Заголовок статьи..."
                  value={wikiEditTitle} onChange={e => setWikiEditTitle(e.target.value)} />
                <select className="wiki-edit-category" value={wikiEditCategory}
                  onChange={e => setWikiEditCategory(e.target.value)}>
                  <option value="">Без категории</option>
                  {wikiCategories.filter(c => isAdmin || canEditWiki || isCategoryEditable(c.id)).map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
                {isAdmin && (
                  <div className="wiki-access-section">
                    <label className="wiki-access-label">🔐 Доступ к статье</label>
                    <div className="wiki-access-options">
                      <label className={`wiki-access-option ${wikiAccessLevel === 'public' ? 'active' : ''}`}>
                        <input type="radio" name="accessLevel" value="public" checked={wikiAccessLevel === 'public'}
                          onChange={() => { setWikiAccessLevel('public'); setWikiAllowedUsers([]); }} />
                        🌍 Все
                      </label>
                      <label className={`wiki-access-option ${wikiAccessLevel === 'selected' ? 'active' : ''}`}>
                        <input type="radio" name="accessLevel" value="selected" checked={wikiAccessLevel === 'selected'}
                          onChange={() => setWikiAccessLevel('selected')} />
                        👥 Выборочно
                      </label>
                      <label className={`wiki-access-option ${wikiAccessLevel === 'private' ? 'active' : ''}`}>
                        <input type="radio" name="accessLevel" value="private" checked={wikiAccessLevel === 'private'}
                          onChange={() => { setWikiAccessLevel('private'); setWikiAllowedUsers([]); }} />
                        🔒 Только я
                      </label>
                    </div>
                    {wikiAccessLevel === 'selected' && (
                      <div className="wiki-user-select">
                        <input type="text" className="wiki-user-search" placeholder="🔍 Поиск пользователей..."
                          value={wikiAccessSearch} onChange={e => setWikiAccessSearch(e.target.value)} />
                        {wikiAllowedUsers.length > 0 && (
                          <div className="wiki-user-chips">
                            {wikiAllowedUsers.map(uid => {
                              const u = users.find(u => u.id === uid);
                              return (
                                <span key={uid} className="wiki-user-chip" onClick={() => setWikiAllowedUsers(prev => prev.filter(id => id !== uid))}>
                                  {u?.username || uid} ✕
                                </span>
                              );
                            })}
                          </div>
                        )}
                        <div className="wiki-user-checkbox-list">
                          {users.filter(u => u.id !== currentUser?.id && (!wikiAccessSearch || u.username.toLowerCase().includes(wikiAccessSearch.toLowerCase()))).map(u => (
                            <div key={u.id} className={`wiki-user-checkbox-item ${wikiAllowedUsers.includes(u.id) ? 'checked' : ''}`}
                              onClick={() => {
                                setWikiAllowedUsers(prev =>
                                  prev.includes(u.id) ? prev.filter(id => id !== u.id) : [...prev, u.id]
                                );
                              }}>
                              <img src={u.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.username)}`} alt="" className="wiki-user-avatar"
                                onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(u.username)}`; }} />
                              <span>{u.username}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div className="wiki-md-toolbar">
                  <button type="button" className="wiki-md-btn" onClick={() => {
                    const ta = document.querySelector('.wiki-edit-content');
                    const start = ta.selectionStart;
                    const end = ta.selectionEnd;
                    const selected = wikiEditContent.substring(start, end);
                    const before = wikiEditContent.substring(0, start);
                    const after = wikiEditContent.substring(end);
                    setWikiEditContent(before + '**' + selected + '**' + after);
                    setTimeout(() => { ta.focus(); ta.selectionStart = start + 2; ta.selectionEnd = end + 2; }, 0);
                  }} title="Жирный"><strong>B</strong></button>
                  <button type="button" className="wiki-md-btn" onClick={() => {
                    const ta = document.querySelector('.wiki-edit-content');
                    const start = ta.selectionStart;
                    const end = ta.selectionEnd;
                    const selected = wikiEditContent.substring(start, end);
                    const before = wikiEditContent.substring(0, start);
                    const after = wikiEditContent.substring(end);
                    setWikiEditContent(before + '*' + selected + '*' + after);
                    setTimeout(() => { ta.focus(); ta.selectionStart = start + 1; ta.selectionEnd = end + 1; }, 0);
                  }} title="Курсив"><em>I</em></button>
                  <button type="button" className="wiki-md-btn" onClick={() => {
                    const ta = document.querySelector('.wiki-edit-content');
                    const start = ta.selectionStart;
                    const before = wikiEditContent.substring(0, start);
                    const after = wikiEditContent.substring(start);
                    setWikiEditContent(before + '# ' + after);
                    setTimeout(() => { ta.focus(); ta.selectionStart = start + 2; ta.selectionEnd = start + 2; }, 0);
                  }} title="Заголовок H1">H1</button>
                  <button type="button" className="wiki-md-btn" onClick={() => {
                    const ta = document.querySelector('.wiki-edit-content');
                    const start = ta.selectionStart;
                    const before = wikiEditContent.substring(0, start);
                    const after = wikiEditContent.substring(start);
                    setWikiEditContent(before + '## ' + after);
                    setTimeout(() => { ta.focus(); ta.selectionStart = start + 3; ta.selectionEnd = start + 3; }, 0);
                  }} title="Заголовок H2">H2</button>
                  <button type="button" className="wiki-md-btn" onClick={() => {
                    const ta = document.querySelector('.wiki-edit-content');
                    const start = ta.selectionStart;
                    const before = wikiEditContent.substring(0, start);
                    const after = wikiEditContent.substring(start);
                    setWikiEditContent(before + '### ' + after);
                    setTimeout(() => { ta.focus(); ta.selectionStart = start + 4; ta.selectionEnd = start + 4; }, 0);
                  }} title="Заголовок H3">H3</button>
                  <span className="wiki-md-sep">|</span>
                  <button type="button" className="wiki-md-btn" onClick={() => {
                    const ta = document.querySelector('.wiki-edit-content');
                    const start = ta.selectionStart;
                    const before = wikiEditContent.substring(0, start);
                    const after = wikiEditContent.substring(start);
                    setWikiEditContent(before + '- ' + after);
                    setTimeout(() => { ta.focus(); ta.selectionStart = start + 2; ta.selectionEnd = start + 2; }, 0);
                  }} title="Маркированный список">•</button>
                  <button type="button" className="wiki-md-btn" onClick={() => {
                    const ta = document.querySelector('.wiki-edit-content');
                    const start = ta.selectionStart;
                    const before = wikiEditContent.substring(0, start);
                    const after = wikiEditContent.substring(start);
                    setWikiEditContent(before + '1. ' + after);
                    setTimeout(() => { ta.focus(); ta.selectionStart = start + 3; ta.selectionEnd = start + 3; }, 0);
                  }} title="Нумерованный список">1.</button>
                  <span className="wiki-md-sep">|</span>
                  <button type="button" className="wiki-md-btn" onClick={() => {
                    const ta = document.querySelector('.wiki-edit-content');
                    const start = ta.selectionStart;
                    const end = ta.selectionEnd;
                    const selected = wikiEditContent.substring(start, end);
                    const before = wikiEditContent.substring(0, start);
                    const after = wikiEditContent.substring(end);
                    setWikiEditContent(before + '`' + selected + '`' + after);
                    setTimeout(() => { ta.focus(); ta.selectionStart = start + 1; ta.selectionEnd = end + 1; }, 0);
                  }} title="Код"><code>&lt;/&gt;</code></button>
                  <button type="button" className="wiki-md-btn" onClick={() => {
                    const ta = document.querySelector('.wiki-edit-content');
                    const start = ta.selectionStart;
                    const end = ta.selectionEnd;
                    const selected = wikiEditContent.substring(start, end);
                    const before = wikiEditContent.substring(0, start);
                    const after = wikiEditContent.substring(end);
                    setWikiEditContent(before + '[text](url)' + after);
                    setTimeout(() => { ta.focus(); ta.selectionStart = start + 1; ta.selectionEnd = start + 1; }, 0);
                  }} title="Ссылка">🔗</button>
                  <button type="button" className="wiki-md-btn" onClick={() => {
                    const ta = document.querySelector('.wiki-edit-content');
                    const start = ta.selectionStart;
                    const before = wikiEditContent.substring(0, start);
                    const after = wikiEditContent.substring(start);
                    setWikiEditContent(before + '```\n' + after);
                    setTimeout(() => { ta.focus(); ta.selectionStart = start + 4; ta.selectionEnd = start + 4; }, 0);
                  }} title="Блок кода">```</button>
                  <button type="button" className="wiki-md-btn" onClick={() => {
                    const ta = document.querySelector('.wiki-edit-content');
                    const start = ta.selectionStart;
                    const end = ta.selectionEnd;
                    const selected = wikiEditContent.substring(start, end);
                    const before = wikiEditContent.substring(0, start);
                    const after = wikiEditContent.substring(end);
                    setWikiEditContent(before + '> ' + selected.replace(/\n/g, '\n> ') + after);
                    setTimeout(() => { ta.focus(); ta.selectionStart = start + 2; ta.selectionEnd = end + 2; }, 0);
                  }} title="Цитата">❝</button>
                </div>
                <textarea className="wiki-edit-content" placeholder="Текст статьи (поддерживает Markdown)..."
                  value={wikiEditContent} onChange={e => setWikiEditContent(e.target.value)} rows={20} />
                {(isAdmin || canEditWiki || isAnyCategoryEditor) && (
                  <div className="wiki-edit-files">
                    <label className="wiki-file-upload-btn">
                      {wikiFileUploading ? '⏳ Загрузка...' : '📎 Прикрепить файл'}
                      <input type="file" style={{ display: 'none' }} onChange={e => {
                        const file = e.target.files[0];
                        if (file && wikiActiveArticle) {
                          wikiUploadFile(wikiActiveArticle.id, file);
                        }
                        e.target.value = '';
                      }} disabled={wikiFileUploading} />
                    </label>
                    {wikiFiles.length > 0 && (
                      <div className="wiki-file-list">
                        {wikiFiles.map(f => (
                          <div key={f.id} className="wiki-file-item">
                            <a href={`${SOCKET_URL}/api/download/${f.file_path}`} target="_blank" rel="noopener noreferrer" className="wiki-file-link">{f.file_name}</a>
                            <span className="wiki-file-size">({(f.file_size / 1024).toFixed(1)} KB)</span>
                            {isAdmin && (
                              <button className="wiki-file-remove" onClick={() => wikiDeleteFile(wikiActiveArticle.id, f.id)} title="Удалить">✕</button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="wiki-editor-actions">
                  <button className="cancel-btn" onClick={() => { setWikiEditMode(false); setWikiActiveArticle(null); setWikiFiles([]); }}>Отмена</button>
                  <button className="save-btn" onClick={wikiSaveArticle} disabled={!wikiEditTitle.trim()}>💾 Сохранить</button>
                </div>
              </div>
            ) : wikiActiveArticle ? (
              <div className="wiki-article-view">
                <div className="wiki-article-header">
                  <h2>{wikiActiveArticle.title}</h2>
                  <div className="wiki-article-meta">
                    <span>Автор: {wikiActiveArticle.creatorName}</span>
                    <span>Обновлено: {formatDate(wikiActiveArticle.updated_at)}</span>
                    {wikiActiveArticle.access_level && (
                      <span className={`wiki-access-badge ${wikiActiveArticle.access_level}`}>
                        {wikiActiveArticle.access_level === 'public' && '🌍 Все'}
                        {wikiActiveArticle.access_level === 'selected' && '👥 Выборочно'}
                        {wikiActiveArticle.access_level === 'private' && '🔒 Только я'}
                      </span>
                    )}
                  </div>
                  <div className="wiki-article-actions">
                    <button className="share-btn" onClick={() => {
                      setWikiShareArticle(wikiActiveArticle);
                      setWikiShareSearchQuery('');
                      setSelectedWikiShareUser(null);
                      setShowWikiShareModal(true);
                    }}>📤 Поделиться</button>
                    {(isAdmin || (canEditWiki && wikiActiveArticle.created_by === currentUser?.id) || isCategoryEditable(wikiActiveArticle.category_id)) && (
                      <button onClick={() => {
                        setWikiEditTitle(wikiActiveArticle.title);
                        setWikiEditContent(wikiActiveArticle.content);
                        setWikiEditCategory(wikiActiveArticle.category_id || '');
                        setWikiAccessLevel(wikiActiveArticle.access_level || 'public');
                        setWikiAllowedUsers(wikiActiveArticle.allowedUsers || []);
                        setWikiEditMode(true);
                        wikiLoadFiles(wikiActiveArticle.id);
                      }}>✏️ Редактировать</button>
                    )}
                    {isAdmin && (
                      <button className="delete-btn" onClick={() => {
                        if (confirm('Удалить статью?')) wikiDeleteArticle(wikiActiveArticle.id);
                      }}>🗑️ Удалить</button>
                    )}
                  </div>
                </div>
                <div className="wiki-article-content markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(wikiActiveArticle.content) }} />
                {wikiFiles.length > 0 && (
                  <div className="wiki-article-files">
                    <h4>📎 Прикреплённые файлы</h4>
                    {wikiFiles.map(f => (
                      <div key={f.id} className="wiki-file-item">
                        <a href={`${SOCKET_URL}/api/download/${f.file_path}`} target="_blank" rel="noopener noreferrer" className="wiki-file-link">{f.file_name}</a>
                        <span className="wiki-file-size">({(f.file_size / 1024).toFixed(1)} KB)</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="wiki-article-list">
                <h3>{wikiActiveCategory ? wikiCategories.find(c => c.id === wikiActiveCategory)?.name : 'Все статьи'}</h3>
                <input type="text" className="wiki-search-input" placeholder="🔍 Поиск по статьям..."
                  value={wikiSearch} onChange={e => setWikiSearch(e.target.value)} />
                {(() => {
                  const q = wikiSearch.toLowerCase().trim();
                  const categoryIds = wikiActiveCategory ? getCategoryIds(wikiActiveCategory) : null;
                  const filtered = wikiArticles.filter(a =>
                    (!categoryIds || categoryIds.includes(a.category_id)) &&
                    (!q || a.title.toLowerCase().includes(q) || a.content.toLowerCase().includes(q))
                  );
                  return filtered.length === 0 ? (
                    <div className="wiki-empty">{wikiSearch ? 'Ничего не найдено.' : ((isAdmin || canEditWiki) ? 'Нет статей. Нажмите "+ Статья" чтобы создать.' : 'Нет статей.')}</div>
                  ) : (
                    <div className="wiki-article-cards">
                    {filtered.map(article => (
                      <div key={article.id} className="wiki-article-card"
                        onClick={() => wikiOpenArticle(article)}>
                        <div className="wiki-article-card-title">
                          {article.access_level === 'private' && '🔒 '}
                          {article.access_level === 'selected' && '👥 '}
                          {article.title}
                        </div>
                        <div className="wiki-article-card-meta">
                          {article.creatorName} · {formatDate(article.updated_at)}
                        </div>
                    </div>
                  ))}
                  </div>
                  );
                })()}
              </div>
            )}
          </main>
        </div>
      )}

      {/* Modal for creating/editing wiki category */}
      {showWikiCategoryModal && (
        <div className="modal-overlay" onClick={() => { setShowWikiCategoryModal(false); setWikiEditingCategory(null); setWikiCategoryName(''); setWikiCategoryDesc(''); setWikiCategoryParent(''); setWikiCategoryEditorIds([]); setWikiCategoryEditorSearch(''); }}>
          <div className="modal-content" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{wikiEditingCategory ? '✏️ Редактировать категорию' : '📂 Новая категория'}</h3>
              <button onClick={() => { setShowWikiCategoryModal(false); setWikiEditingCategory(null); setWikiCategoryName(''); setWikiCategoryDesc(''); setWikiCategoryParent(''); setWikiCategoryEditorIds([]); setWikiCategoryEditorSearch(''); }}>✕</button>
            </div>
            <div className="modal-body">
              <div className="ann-form-group">
                <label>Название</label>
                <input type="text" className="ann-input" placeholder="Название категории..."
                  value={wikiCategoryName} onChange={e => setWikiCategoryName(e.target.value)} />
              </div>
              <div className="ann-form-group">
                <label>Описание</label>
                <input type="text" className="ann-input" placeholder="Описание (необязательно)..."
                  value={wikiCategoryDesc} onChange={e => setWikiCategoryDesc(e.target.value)} />
              </div>
              <div className="ann-form-group">
                <label>Родительский раздел</label>
                <select className="ann-input" value={wikiCategoryParent} onChange={e => setWikiCategoryParent(e.target.value)}>
                  {isAdmin && <option value="">Нет (корневой раздел)</option>}
                  {wikiCategories
                    .filter(c => !wikiEditingCategory || c.id !== wikiEditingCategory.id)
                    .filter(c => isAdmin || isCategoryEditable(c.id))
                    .map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))
                  }
                </select>
              </div>
              {isAdmin && wikiEditingCategory && (
                <div className="ann-form-group">
                  <label>Редакторы раздела</label>
                  <div className="wiki-user-select">
                    <input type="text" className="wiki-user-search" placeholder="🔍 Поиск пользователей..."
                      value={wikiCategoryEditorSearch} onChange={e => setWikiCategoryEditorSearch(e.target.value)} />
                    {wikiCategoryEditorIds.length > 0 && (
                      <div className="wiki-user-chips">
                        {wikiCategoryEditorIds.map(uid => {
                          const u = users.find(u => u.id === uid);
                          return (
                            <span key={uid} className="wiki-user-chip" onClick={() => setWikiCategoryEditorIds(prev => prev.filter(id => id !== uid))}>
                              {u?.username || uid} ✕
                            </span>
                          );
                        })}
                      </div>
                    )}
                    <div className="wiki-user-checkbox-list">
                      {users.filter(u => u.id !== currentUser?.id && (!wikiCategoryEditorSearch || u.username.toLowerCase().includes(wikiCategoryEditorSearch.toLowerCase()))).slice(0, 50).map(u => (
                        <div key={u.id} className={`wiki-user-checkbox-item ${wikiCategoryEditorIds.includes(u.id) ? 'checked' : ''}`}
                          onClick={() => {
                            setWikiCategoryEditorIds(prev =>
                              prev.includes(u.id) ? prev.filter(id => id !== u.id) : [...prev, u.id]
                            );
                          }}>
                          <img src={u.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.username)}`} alt="" className="wiki-user-avatar"
                            onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(u.username)}`; }} />
                          <span>{u.username}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => { setShowWikiCategoryModal(false); setWikiEditingCategory(null); setWikiCategoryName(''); setWikiCategoryDesc(''); setWikiCategoryParent(''); setWikiCategoryEditorIds([]); setWikiCategoryEditorSearch(''); setWikiCategoryEditorSearch(''); }}>Отмена</button>
              <button className="save-btn" onClick={wikiEditingCategory ? wikiUpdateCategory : wikiCreateCategory} disabled={!wikiCategoryName.trim()}>{wikiEditingCategory ? 'Сохранить' : 'Создать'}</button>
            </div>
          </div>
        </div>
      )}

      {activeView === 'settings' && (
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
                className={`settings-tab ${activeSettingsTab === 'devices' ? 'active' : ''}`}
                onClick={() => setActiveSettingsTab('devices')}
              >
                📱 Устройства
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
                  {/* Переключатель темы */}
                  <div className="settings-section">
                    <h3>Тема оформления</h3>
                    <p className="settings-description">Выберите тёмную или светлую тему</p>
                    <div className="theme-toggle-buttons">
                      <button
                        className={`theme-btn ${appTheme === 'dark' ? 'active' : ''}`}
                        onClick={() => { setAppTheme('dark'); setUserUiSettings(prev => ({...prev})); }}
                      >
                        🌙 Тёмная
                      </button>
                      <button
                        className={`theme-btn ${appTheme === 'light' ? 'active' : ''}`}
                        onClick={() => { setAppTheme('light'); setUserUiSettings(prev => ({...prev})); }}
                      >
                        ☀️ Светлая
                      </button>
                    </div>
                  </div>

                  {/* Градация размера текста */}
                  <div className="settings-section">
                    <h3>Размер текста</h3>
                    <p className="settings-description">Выберите размер текста для сообщений</p>
                    <div className="text-size-graduation">
                      {[
                        { level: -1, label: 'Минимальный', textSize: '11px', emojiSize: '16px' },
                        { level: 0, label: 'Мелкий', textSize: '13px', emojiSize: '18px' },
                        { level: 1, label: 'Средний', textSize: '15px', emojiSize: '22px' },
                        { level: 2, label: 'Крупный', textSize: '18px', emojiSize: '28px' },
                      ].map(opt => (
                        <button
                          key={opt.level}
                          className={`text-size-btn ${userUiSettings.textSizeLevel === opt.level ? 'active' : ''}`}
                          onClick={() => setUserUiSettings({...userUiSettings, textSizeLevel: opt.level})}
                        >
                          <span className="text-size-label">{opt.label}</span>
                          <span className="text-size-preview" style={{ fontSize: opt.textSize }}>Aa</span>
                          <span className="emoji-size-preview" style={{ fontSize: opt.emojiSize }}>😀</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Фон чата */}
                  <div className="settings-section">
                    <h3>Фон окна чата</h3>
                    <p className="settings-description">Выберите фон для области сообщений</p>
                    <div className="chat-bg-grid">
                      {chatBackgrounds.map(bg => {
                        const gradient = appTheme === 'light' ? bg.light : bg.dark;
                        return (
                          <button
                            key={bg.id}
                            className={`chat-bg-btn ${userUiSettings.chatBackground === bg.id ? 'active' : ''}`}
                            onClick={() => setUserUiSettings({...userUiSettings, chatBackground: bg.id})}
                          >
                            <div className="chat-bg-preview" style={{ background: bg.id === 0 ? 'transparent' : gradient }} />
                            <span className="chat-bg-name">{bg.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Автозапуск (только Electron) */}
                  {window.electronAPI?.setAutoLaunch && (
                    <div className="settings-section">
                      <h3>Автозапуск</h3>
                      <p className="settings-description">Автоматически запускать приложение при входе в Windows</p>
                      <label className="toggle-switch settings-toggle">
                        <input
                          type="checkbox"
                          checked={autoLaunch}
                          onChange={(e) => {
                            const val = e.target.checked;
                            setAutoLaunch(val);
                            if (window.electronAPI?.setAutoLaunch) {
                              window.electronAPI.setAutoLaunch(val);
                            }
                          }}
                        />
                        <span className="slider"></span>
                        <span className="toggle-label">{autoLaunch ? 'Включен' : 'Выключен'}</span>
                      </label>
                    </div>
                  )}

                  <div className="settings-actions">
                    <button className="btn-secondary" onClick={handleOpenChats}>
                      Отмена
                    </button>
                    <button className="btn-primary" onClick={handleSaveUserUiSettings}>
                      Сохранить
                    </button>
                  </div>
                </div>
              )}

              {activeSettingsTab === 'notifications' && (
                <div className="settings-tab-content">
                  <div className="settings-section">
                    <h3>Настройки уведомлений</h3>
                    <p className="settings-description">Настройте отображение и звук уведомлений</p>
                    
                    {/* Статус уведомлений браузера */}
                    <div className="setting-item browser-notification-status">
                      <div className="setting-info">
                        <span className="setting-icon">
                          {browserNotificationPermission === 'granted' ? '✅' :
                           browserNotificationPermission === 'denied' ? '❌' : '⚠️'}
                        </span>
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
                        <button
                          className="enable-notification-btn"
                          onClick={enableBrowserNotifications}
                        >
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
                        <input
                          type="checkbox"
                          checked={notificationSettings.newMessages}
                          onChange={(e) => setNotificationSettings(prev => ({
                            ...prev,
                            newMessages: e.target.checked
                          }))}
                        />
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
                        <input
                          type="checkbox"
                          checked={notificationSettings.birthdays}
                          onChange={(e) => setNotificationSettings(prev => ({
                            ...prev,
                            birthdays: e.target.checked
                          }))}
                        />
                        <span className="slider"></span>
                      </label>
                    </div>

                    <div className="setting-item">
                      <div className="setting-info">
                        <span className="setting-icon">🔊</span>
                        <div>
                          <div className="setting-title">Звук</div>
                          <div className="setting-description">Воспроизводить звук при уведомлениях</div>
                        </div>
                      </div>
                      <label className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={notificationSettings.sound}
                          onChange={(e) => setNotificationSettings(prev => ({
                            ...prev,
                            sound: e.target.checked
                          }))}
                        />
                        <span className="slider"></span>
                      </label>
                    </div>

                    <div className="setting-item">
                      <div className="setting-info">
                        <span className="setting-icon">🤖</span>
                        <div>
                          <div className="setting-title">Помощник</div>
                          <div className="setting-description">Уведомления от бота-помощника</div>
                        </div>
                      </div>
                      <label className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={notificationSettings.botAssistant}
                          onChange={(e) => setNotificationSettings(prev => ({
                            ...prev,
                            botAssistant: e.target.checked
                          }))}
                        />
                        <span className="slider"></span>
                      </label>
                    </div>

                    <div className="setting-item">
                      <div className="setting-info">
                        <span className="setting-icon">📋</span>
                        <div>
                          <div className="setting-title">Задачи</div>
                          <div className="setting-description">Уведомления о задачах из календаря</div>
                        </div>
                      </div>
                      <label className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={notificationSettings.tasks}
                          onChange={(e) => setNotificationSettings(prev => ({
                            ...prev,
                            tasks: e.target.checked
                          }))}
                        />
                        <span className="slider"></span>
                      </label>
                    </div>

                    <div className="setting-item">
                      <div className="setting-info">
                        <span className="setting-icon">🏢</span>
                        <div>
                          <div className="setting-title">Переговорная</div>
                          <div className="setting-description">Уведомления о бронировании переговорной</div>
                        </div>
                      </div>
                      <label className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={notificationSettings.meetingRoom}
                          onChange={(e) => setNotificationSettings(prev => ({
                            ...prev,
                            meetingRoom: e.target.checked
                          }))}
                        />
                        <span className="slider"></span>
                      </label>
                    </div>
                  </div>

                  <div className="settings-actions">
                    <button className="btn-secondary" onClick={handleOpenChats}>
                      Отмена
                    </button>
                    <button className="btn-primary" onClick={handleSaveNotificationSettings}>
                      Сохранить уведомления
                    </button>
                  </div>
                </div>
              )}

              {activeSettingsTab === 'devices' && (
                <DevicesSettings
                  currentUser={currentUser}
                  SOCKET_URL={SOCKET_URL}
                  getDeviceId={getDeviceId}
                  getDeviceName={getDeviceName}
                />
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
                      <div className="about-app-item">
                        <span className="about-app-label">Версия</span>
                        <span className="about-app-value">{appVersion}</span>
                      </div>
                      <div className="about-app-item">
                        <span className="about-app-label">Описание</span>
                        <span className="about-app-value">Корпоративный мессенджер для командной работы</span>
                      </div>
                    </div>

                    {/* Секция обновлений */}
                    <div className="update-section">
                      <h3>Обновление приложения</h3>

                      {updateStatus === null || updateStatus === 'idle' ? (
                        <button
                          className="btn-check-update"
                          onClick={checkForUpdates}
                        >
                          🔍 Проверить обновления
                        </button>
                      ) : null}

                      {updateStatus === 'checking' && (
                        <div className="update-status">
                          <div className="update-spinner"></div>
                          <span>Проверка обновлений...</span>
                        </div>
                      )}

                      {updateStatus === 'available' && electronUpdateInfo && (
                        <div className="update-available">
                          <p className="update-message">📥 Доступно обновление v{electronUpdateInfo.version}</p>
                          <button className="btn-check-update" onClick={startUpdateDownload}>
                            Скачать и установить
                          </button>
                        </div>
                      )}

                      {updateStatus === 'available' && browserUpdateInfo && (
                        <div className="update-available">
                          <p className="update-message">📥 Доступно обновление v{browserUpdateInfo.latestVersion}</p>
                          <p className="update-release-name">
                            {browserUpdateInfo.releaseName || `Версия v${browserUpdateInfo.latestVersion}`}
                            {browserUpdateInfo.publishedAt && (
                              <> · {new Date(browserUpdateInfo.publishedAt).toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' })}</>
                            )}
                          </p>
                          <div className="update-available-actions">
                            <button
                              className="btn-check-update"
                              onClick={() => window.open(browserUpdateInfo.releaseUrl, '_blank')}
                            >
                              Скачать с GitHub
                            </button>
                            <button
                              className="btn-check-update-secondary"
                              onClick={() => window.open(browserUpdateInfo.releaseUrl, '_blank')}
                            >
                              Что нового
                            </button>
                          </div>
                        </div>
                      )}

                      {updateStatus === 'downloading' && (
                        <div className="update-downloading">
                          <p>⬇️ Загрузка обновления...</p>
                          <div className="update-progress-bar">
                            <div
                              className="update-progress-fill"
                              style={{ width: `${Math.round(updateProgress)}%` }}
                            ></div>
                          </div>
                          <span className="update-progress-text">{Math.round(updateProgress)}%</span>
                        </div>
                      )}

                      {updateStatus === 'ready' && electronUpdateInfo && (
                        <div className="update-ready">
                          <p className="update-ready-message">✅ Обновление v{electronUpdateInfo.version} готово</p>
                          <button className="btn-check-update" onClick={installUpdate}>
                            Установить и перезапустить
                          </button>
                        </div>
                      )}

                      {updateStatus === 'no-update' && (
                        <div className="update-no-update">
                          <p>✅ У вас установлена последняя версия (v{appVersion})</p>
                          <p className="update-subtitle">Обновлений не найдено.</p>
                          <button
                            className="btn-check-update-secondary"
                            onClick={checkForUpdates}
                          >
                            🔍 Проверить снова
                          </button>
                        </div>
                      )}

                      {updateStatus === 'error' && (
                        <div className="update-error">
                          <p>❌ Ошибка проверки обновлений</p>
                          {updateErrorMessage && (
                            <p className="update-error-detail">{updateErrorMessage}</p>
                          )}
                          <button
                            className="btn-check-update-secondary"
                            onClick={checkForUpdates}
                          >
                            Повторить
                          </button>
                        </div>
                      )}

                      {updateStatus === 'installing' && (
                        <div className="update-downloading">
                          <p>⏳ Установка... Останавливается сервер...</p>
                          <div className="update-spinner" style={{ margin: '8px auto' }}></div>
                        </div>
                      )}
                    </div>

                    <div className="security-section">
                      <h3>🔐 E2EE шифрование</h3>
                      <p className="settings-description">Ваши ключи шифрования хранятся локально в этом браузере. При сбросе ключей старые зашифрованные сообщения станут недоступны.</p>
                      <button
                        className="btn-danger"
                        onClick={async () => {
                          if (!window.confirm('Сбросить ключи E2EE?\n\nВсе старые зашифрованные сообщения станут недоступны для расшифровки. Собеседникам нужно будет заново установить защищённое соединение.')) return;
                          try {
                            const { deleteE2EEKeys, clearPeerKeyCache, clearGroupKeyCache, generateKeyPair, saveE2EEKeys } = await import('./crypto');
                            await deleteE2EEKeys(currentUser.id);
                            await clearPeerKeyCache();
                            clearGroupKeyCache();
                            const keyPair = await generateKeyPair();
                            await saveE2EEKeys(currentUser.id, keyPair);
                            const { exportPublicKeyBase64 } = await import('./crypto');
                            const pubBase64 = await exportPublicKeyBase64(keyPair.publicKey);
                            await fetch(`${SOCKET_URL}/api/e2ee/key`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ userId: currentUser.id, publicKey: pubBase64 })
                            });
                            setE2eeEnabled({});
                            window.__e2eeKeysRefreshed = true;
                            alert('✅ Ключи E2EE успешно перегенерированы');
                          } catch (err) {
                            alert('❌ Ошибка при сбросе ключей: ' + err.message);
                          }
                        }}
                      >
                        🔄 Сбросить ключи E2EE
                      </button>
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
      )}

      {/* Модальное окно создания чата */}
      {showNewChatModal && (
        <div className="modal-overlay" onClick={() => setShowNewChatModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Создать новый чат</h3>
              <button onClick={() => setShowNewChatModal(false)}>✕</button>
            </div>

            <div className="modal-body">
              <div className="chat-type-selector">
                <button
                  className={newChatType === 'direct' ? 'active' : ''}
                  onClick={() => setNewChatType('direct')}
                  disabled={selectedUsers.length > 1}
                  title={selectedUsers.length > 1 ? 'При выборе более 1 пользователя доступен только групповой чат' : ''}
                >
                  👤 Личный
                </button>
                <button
                  className={newChatType === 'group' ? 'active' : ''}
                  onClick={() => setNewChatType('group')}
                  disabled={selectedUsers.length === 1}
                  title={selectedUsers.length === 1 ? 'При выборе 1 пользователя доступен только личный чат' : ''}
                >
                  👥 Групповой
                </button>
              </div>

              {newChatType === 'group' && (
                <input
                  type="text"
                  placeholder="Название чата"
                  value={newChatName}
                  onChange={(e) => setNewChatName(e.target.value)}
                  className="chat-name-input"
                />
              )}

              <div className="users-select">
                <p>Выберите пользователей:</p>
                <input
                  type="text"
                  placeholder="Поиск по ФИО..."
                  value={userSearchQuery}
                  onChange={(e) => setUserSearchQuery(e.target.value)}
                  className="user-search-input"
                />
                <div className="users-select-list">
                  {users
                    .filter(u => u.username !== currentUser?.username)
                    .filter(user => {
                      if (!userSearchQuery.trim()) return true;
                      const query = userSearchQuery.toLowerCase();
                      const fullName = (user.fullName || '').toLowerCase();
                      const username = (user.username || '').toLowerCase();
                      return fullName.includes(query) || username.includes(query);
                    })
                    .sort((a, b) => (a.username || '').localeCompare(b.username || ''))
                    .map(user => (
                      <div
                        key={user.id}
                        className={`user-select-item ${selectedUsers.find(u => u.id === user.id) ? 'selected' : ''}`}
                      >
                        <div
                          className="user-select-left"
                          onClick={() => toggleUserSelection(user)}
                        >
                          <div className="user-avatar-wrapper">
                            <img src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.username)}`} alt={user.username} className="user-avatar-small" onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || 'U')}`; }} />
                            <span className={`status-indicator ${user.status}`}></span>
                          </div>
                          <div className="user-info-small">
                            <span className="user-name-text">{user.username}</span>
                            {user.fullName && <span className="user-fullname">{user.fullName}</span>}
                          </div>
                          {selectedUsers.find(u => u.id === user.id) && <span className="checkmark">✓</span>}
                        </div>
                        <button
                          className="view-profile-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleViewUserProfile(user);
                          }}
                          title="Посмотреть профиль"
                        >
                          👁️
                        </button>
                      </div>
                    ))}
                  {users.filter(u => u.username !== currentUser?.username)
                    .filter(user => {
                      if (!userSearchQuery.trim()) return true;
                      const query = userSearchQuery.toLowerCase();
                      const fullName = (user.fullName || '').toLowerCase();
                      const username = (user.username || '').toLowerCase();
                      return fullName.includes(query) || username.includes(query);
                    }).length === 0 && (
                    <div className="no-users-found">Пользователи не найдены</div>
                  )}
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowNewChatModal(false)}>Отмена</button>
              <button
                className="create-btn"
                onClick={handleCreateChat}
                disabled={newChatType === 'direct' ? selectedUsers.length !== 1 : selectedUsers.length === 0}
              >
                Создать
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно профиля */}
      {showProfileModal && (
        <div className="modal-overlay" onClick={() => setShowProfileModal(false)}>
          <div className="modal-content profile-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Редактировать профиль</h3>
              <button onClick={() => setShowProfileModal(false)}>✕</button>
            </div>

            <div className="modal-body">
              <div className="profile-avatar-section">
                <label htmlFor="avatar-upload" className="avatar-label">
                  <img src={profileData.avatar || currentUser?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser?.username || 'U')}`} alt="Аватар" className="profile-avatar-preview" onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || currentUser?.username || 'U')}`; }} />
                  <div className="avatar-overlay">
                    <span>📷 Изменить</span>
                  </div>
                </label>
                <input
                  id="avatar-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleUploadAvatar}
                  style={{ display: 'none' }}
                />
                {(profileData.avatar || currentUser?.avatar) && !(profileData.avatar || currentUser?.avatar).includes('ui-avatars.com') && (
                  <button className="delete-btn" onClick={handleRemoveAvatar} style={{ marginTop: 8, fontSize: 13 }}>
                    🗑️ Удалить аватар
                  </button>
                )}
              </div>

              <form onSubmit={handleSaveProfile} className="profile-form">
                <div className="form-group">
                  <label>ФИО</label>
                  <input
                    type="text"
                    value={profileData.username}
                    onChange={(e) => setProfileData(prev => ({ ...prev, username: e.target.value }))}
                    maxLength={100}
                    placeholder="Иванов Иван Иванович"
                  />
                </div>

                <div className="form-group">
                  <label>Дата рождения</label>
                  <input
                    type="date"
                    value={profileData.birthDate}
                    onChange={(e) => setProfileData(prev => ({ ...prev, birthDate: e.target.value }))}
                  />
                </div>

                <div className="form-group">
                  <label>💼 Должность</label>
                  <input
                    type="text"
                    placeholder="Менеджер"
                    value={profileData.about}
                    onChange={(e) => setProfileData(prev => ({ ...prev, about: e.target.value }))}
                    maxLength={100}
                  />
                </div>

                <div className="form-group">
                  <label>📱 Мобильный телефон</label>
                  <input
                    type="tel"
                    placeholder="+7 (999) 000-00-00"
                    value={profileData.mobilePhone}
                    onChange={(e) => setProfileData(prev => ({ ...prev, mobilePhone: e.target.value }))}
                    maxLength={20}
                  />
                </div>

                <div className="form-group">
                  <label>📞 Рабочий телефон</label>
                  <input
                    type="tel"
                    placeholder="+7 (495) 000-00-00"
                    value={profileData.workPhone}
                    onChange={(e) => setProfileData(prev => ({ ...prev, workPhone: e.target.value }))}
                    maxLength={20}
                  />
                </div>

                <div className="form-actions">
                  <button type="button" className="cancel-btn" onClick={() => setShowProfileModal(false)}>
                    Отмена
                  </button>
                  <button type="submit" className="create-btn" disabled={isSaving}>
                    {isSaving ? 'Сохранение...' : 'Сохранить'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно просмотра профиля другого пользователя */}
      {viewingUserProfile && viewUserProfileData && (
        <div className="modal-overlay" onClick={() => setViewingUserProfile(false)}>
          <div className="modal-content view-profile-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Профиль пользователя</h3>
              <button onClick={() => setViewingUserProfile(false)}>✕</button>
            </div>

            <div className="modal-body">
              <div className="view-profile-header">
                <div className="view-profile-avatar-wrapper" style={{ position: 'relative', display: 'inline-block' }}>
                  <img
                    src={viewUserProfileData.avatar || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(viewUserProfileData.username)}
                    alt={viewUserProfileData.username}
                    className="view-profile-avatar"
                    onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || viewUserProfileData.username || 'U')}`; }}
                    onClick={() => handleOpenAvatar(viewUserProfileData.avatar, viewUserProfileData.username)}
                    style={{ cursor: viewUserProfileData.avatar ? 'zoom-in' : 'default' }}
                  />
                  {/* Кнопка смены аватара для помощника (только для админов) */}
                  {viewUserProfileData.username === 'Помощник' && currentUser?.is_admin === 1 && (
                    <label
                      htmlFor="helper-avatar-upload"
                      className="change-avatar-btn"
                      title="Сменить аватар помощника"
                      style={{
                        position: 'absolute',
                        bottom: '0',
                        right: '0',
                        background: 'rgba(102, 126, 234, 0.9)',
                        borderRadius: '50%',
                        width: '32px',
                        height: '32px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        fontSize: '18px',
                        border: '2px solid white'
                      }}
                    >
                      📷
                    </label>
                  )}
                  {/* Кнопка смены аватара для общего чата (только для админов) */}
                  {viewUserProfileData.isGeneralChat && currentUser?.is_admin === 1 && (
                    <label
                      htmlFor="general-chat-avatar-upload"
                      className="change-avatar-btn"
                      title="Сменить аватар общего чата"
                      style={{
                        position: 'absolute',
                        bottom: '0',
                        right: '0',
                        background: 'rgba(102, 126, 234, 0.9)',
                        borderRadius: '50%',
                        width: '32px',
                        height: '32px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        fontSize: '18px',
                        border: '2px solid white'
                      }}
                    >
                      📷
                    </label>
                  )}
                  <input
                    id="helper-avatar-upload"
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => handleUploadHelperAvatar(e, viewUserProfileData)}
                  />
                  <input
                    id="general-chat-avatar-upload"
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleUploadGeneralChatAvatar}
                  />
                </div>
                <div className="view-profile-names">
                  <h4>{viewUserProfileData.username}</h4>
                  {viewUserProfileData.full_name && (
                    <p className="view-profile-fullname">{viewUserProfileData.full_name}</p>
                  )}
                </div>
              </div>

              <div className="view-profile-details">
                {viewUserProfileData.email && (
                  <div className="profile-detail-row">
                    <span className="detail-label">📧 Email:</span>
                    <span className="detail-value">{viewUserProfileData.email}</span>
                  </div>
                )}
                {viewUserProfileData.birth_date && (
                  <div className="profile-detail-row">
                    <span className="detail-label">🎂 Дата рождения:</span>
                    <span className="detail-value">
                      {new Date(viewUserProfileData.birth_date).toLocaleDateString('ru-RU')}
                    </span>
                  </div>
                )}
                {viewUserProfileData.about && (
                  <div className="profile-detail-row">
                    <span className="detail-label">💼 Должность:</span>
                    <span className="detail-value">{viewUserProfileData.about}</span>
                  </div>
                )}
                {viewUserProfileData.mobile_phone && (
                  <div className="profile-detail-row">
                    <span className="detail-label">📱 Мобильный телефон:</span>
                    <span className="detail-value">{viewUserProfileData.mobile_phone}</span>
                  </div>
                )}
                {viewUserProfileData.work_phone && (
                  <div className="profile-detail-row">
                    <span className="detail-label">📞 Рабочий телефон:</span>
                    <span className="detail-value">{viewUserProfileData.work_phone}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button className="create-btn" onClick={() => setViewingUserProfile(false)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно просмотра аватара в полном размере */}
      {showAvatarModal && avatarUrl && (
        <div className="avatar-viewer-overlay" onClick={() => setShowAvatarModal(false)}>
          <div className="avatar-viewer-content" onClick={e => e.stopPropagation()}>
            <button className="avatar-viewer-close" onClick={() => setShowAvatarModal(false)}>✕</button>
            <img src={avatarUrl} alt="Avatar full size" className="avatar-viewer-image" onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || 'U')}`; }} />
          </div>
        </div>
      )}

      {/* Модальное окно создания/редактирования задачи */}
      {showTaskModal && (
        <div className="modal-overlay" onClick={() => setShowTaskModal(false)}>
          <div className="modal-content task-modal" onClick={e => e.stopPropagation()} style={{ maxHeight: '85vh', overflowY: 'auto' }}>
            <div className="modal-header">
              <h3>{editingTask ? 'Редактировать задачу' : 'Новая задача'}</h3>
              <button onClick={() => setShowTaskModal(false)}>✕</button>
            </div>

            <form onSubmit={editingTask ? handleUpdateTask : handleCreateTask}>
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
                    onClick={() => handleDeleteTask(editingTask.id)}
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
        <div key={modalKey} className="modal-overlay" onClick={() => { setShowMeetingModal(false); setMeetingForm({ title: '', description: '', meetingDate: '', startTime: '', endTime: '', organizer: '', reminderMinutes: '15' }); setSelectedMeetingParticipants([]); setParticipantSearchText(''); }}>
          <div className="modal-content task-modal" onClick={e => e.stopPropagation()} style={{ maxHeight: '85vh', height: '85vh' }}>
            <div className="modal-header">
              <h3>🏢 Забронировать переговорную</h3>
              <button onClick={() => { setShowMeetingModal(false); setMeetingForm({ title: '', description: '', meetingDate: '', startTime: '', endTime: '', organizer: '', reminderMinutes: '15' }); setSelectedMeetingParticipants([]); setParticipantSearchText(''); }}>✕</button>
            </div>

            <form style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }} onSubmit={async (e) => {
              e.preventDefault();
              
              try {
                const response = await fetch(`${SOCKET_URL}/api/meeting-room/bookings`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    organizerId: currentUser?.id,
                    organizerName: meetingForm.organizer || currentUser?.username,
                    title: meetingForm.title,
                    description: meetingForm.description,
                    meetingDate: meetingForm.meetingDate,
                    startTime: meetingForm.startTime,
                    endTime: meetingForm.endTime,
                    participants: selectedMeetingParticipants,
                    reminderMinutes: meetingForm.reminderMinutes || null
                  })
                });
                
                const data = await response.json();
                
                if (response.ok && data.success) {
                  // Обновляем список бронирований
                  fetchMeetingRoomBookings(
                    new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1),
                    new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0)
                  );
                  
                  // Очищаем форму
                  setMeetingForm({
                    title: '',
                    description: '',
                    meetingDate: '',
                    startTime: '',
                    endTime: '',
                    organizer: '',
                    reminderMinutes: '15'
                  });
                  setSelectedMeetingParticipants([]);
                  setParticipantSearchText('');
                  
                  setShowMeetingModal(false);
                } else {
                  alert(data.error || 'Ошибка при бронировании');
                }
              } catch (err) {
                console.error('Ошибка бронирования:', err);
                alert('Ошибка сервера');
              }
            }}>
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

                {/* Напоминание */}
                <div className="form-group">
                  <label>Напоминание</label>
                  <select
                    value={meetingForm.reminderMinutes || ''}
                    onChange={(e) => setMeetingForm({...meetingForm, reminderMinutes: e.target.value})}
                  >
                    <option value="">Без напоминания</option>
                    <option value="5">За 5 минут до начала</option>
                    <option value="10">За 10 минут до начала</option>
                    <option value="15">За 15 минут до начала</option>
                    <option value="30">За 30 минут до начала</option>
                    <option value="60">За 1 час до начала</option>
                  </select>
                </div>

                {/* Выбор участников */}
                <div className="form-group">
                  <label>Участники</label>
                  <button type="button" onClick={() => { setDraftParticipants([...selectedMeetingParticipants]); setParticipantSearchText(''); setShowParticipantModal(true); }}
                    style={{
                      width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #555',
                      background: '#2a2a2a', color: '#e0e0e0', fontSize: '14px', cursor: 'pointer',
                      textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px'
                    }}
                  >
                    👥 Выбрать участников
                    {selectedMeetingParticipants.length > 0 && (
                      <span style={{
                        background: '#667eea', color: '#fff', borderRadius: '10px', padding: '1px 8px',
                        fontSize: '12px', fontWeight: 'bold', marginLeft: 'auto'
                      }}>
                        {selectedMeetingParticipants.length}
                      </span>
                    )}
                  </button>
                  {selectedMeetingParticipants.length > 0 && (
                    <div style={{display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px'}}>
                      {selectedMeetingParticipants.map(userId => {
                        const user = availableUsers.find(u => u.id === userId);
                        return user ? (
                          <span key={userId} style={{display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#3a3f5c', borderRadius: '12px', padding: '2px 8px', fontSize: '12px', color: '#e0e0e0'}}>
                            {user.username}
                          </span>
                        ) : null;
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="cancel-btn"
                  onClick={() => { setShowMeetingModal(false); setMeetingForm({ title: '', description: '', meetingDate: '', startTime: '', endTime: '', organizer: '', reminderMinutes: '15' }); setSelectedMeetingParticipants([]); setParticipantSearchText(''); }}
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

      {/* Модальное окно выбора участников */}
      {showParticipantModal && (
        <div className="modal-overlay" onClick={() => setShowParticipantModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxHeight: '80vh', height: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-header">
              <h3>👥 Выберите участников</h3>
              <button onClick={() => setShowParticipantModal(false)}>✕</button>
            </div>

            <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              {/* Поиск */}
              <input
                type="text"
                value={participantSearchText}
                onChange={(e) => setParticipantSearchText(e.target.value)}
                placeholder="🔍 Поиск по имени или email..."
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #555',
                  background: '#2a2a2a', color: '#e0e0e0', fontSize: '14px', outline: 'none',
                  boxSizing: 'border-box', marginBottom: '12px'
                }}
              />

              {/* Выбранные */}
              {draftParticipants.length > 0 && (
                <>
                  <div style={{ fontSize: '12px', color: '#888', marginBottom: '6px' }}>
                    Выбранные — {draftParticipants.length}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px' }}>
                    {draftParticipants.map(userId => {
                      const user = availableUsers.find(u => u.id === userId);
                      return user ? (
                        <span key={userId} style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          background: '#3a3f5c', borderRadius: '12px', padding: '3px 10px',
                          fontSize: '13px', color: '#e0e0e0'
                        }}>
                          <img
                            src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.username)}&background=667eea&color=fff`}
                            alt={user.username}
                            style={{ width: '18px', height: '18px', borderRadius: '50%' }}
                            onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || 'U')}&background=667eea&color=fff`; }}
                          />
                          {user.username}
                          <span style={{ cursor: 'pointer', fontSize: '14px', color: '#aaa', marginLeft: '2px' }}
                            onClick={(e) => { e.stopPropagation(); toggleDraftParticipant(userId); }}>
                            ×
                          </span>
                        </span>
                      ) : null;
                    })}
                  </div>
                </>
              )}

              {/* Выбрать всех / Снять всех */}
              <div style={{ display: 'flex', gap: '12px', marginBottom: '8px' }}>
                <button
                  type="button"
                  onClick={() => {
                    const filtered = availableUsers.filter(u =>
                      u.username.toLowerCase().includes(participantSearchText.toLowerCase()) ||
                      (u.email && u.email.toLowerCase().includes(participantSearchText.toLowerCase()))
                    );
                    setDraftParticipants(prev => {
                      const newSet = new Set(prev);
                      filtered.forEach(u => newSet.add(u.id));
                      return Array.from(newSet);
                    });
                  }}
                  style={{
                    background: 'transparent', border: '1px solid #555', borderRadius: '6px',
                    color: '#4caf50', padding: '4px 12px', cursor: 'pointer', fontSize: '12px'
                  }}
                >
                  ✓ Выбрать всех
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const filteredIds = new Set(
                      availableUsers
                        .filter(u =>
                          u.username.toLowerCase().includes(participantSearchText.toLowerCase()) ||
                          (u.email && u.email.toLowerCase().includes(participantSearchText.toLowerCase()))
                        )
                        .map(u => u.id)
                    );
                    setDraftParticipants(prev => prev.filter(id => !filteredIds.has(id)));
                  }}
                  style={{
                    background: 'transparent', border: '1px solid #555', borderRadius: '6px',
                    color: '#f44336', padding: '4px 12px', cursor: 'pointer', fontSize: '12px'
                  }}
                >
                  ○ Снять всех
                </button>
              </div>

              {/* Список пользователей */}
              <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                {(() => {
                  const filtered = availableUsers.filter(u =>
                    u.username.toLowerCase().includes(participantSearchText.toLowerCase()) ||
                    (u.email && u.email.toLowerCase().includes(participantSearchText.toLowerCase()))
                  );
                  if (filtered.length === 0) {
                    return <div style={{ padding: '20px', textAlign: 'center', color: '#888', fontSize: '14px' }}>Никого не найдено</div>;
                  }
                  return filtered.map(user => {
                    const isSelected = draftParticipants.find(id => id === user.id);
                    return (
                      <div
                        key={user.id}
                        onClick={() => toggleDraftParticipant(user.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 8px',
                          cursor: 'pointer', borderRadius: '6px', transition: 'background 0.15s',
                          background: isSelected ? 'rgba(102, 126, 234, 0.15)' : 'transparent'
                        }}
                        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = '#2a2a2a'; }}
                        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <span style={{ color: isSelected ? '#4caf50' : '#555', fontSize: '16px', width: '20px', textAlign: 'center' }}>
                          {isSelected ? '☑' : '☐'}
                        </span>
                        <img
                          src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.username)}&background=667eea&color=fff`}
                          alt={user.username}
                          style={{ width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0 }}
                          onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || 'U')}&background=667eea&color=fff`; }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: '#e0e0e0', fontSize: '14px' }}>{user.username}</div>
                          {user.email && <div style={{ color: '#888', fontSize: '12px' }}>{user.email}</div>}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

            {/* Footer */}
            <div className="modal-footer" style={{ borderTop: '1px solid #333', padding: '12px 16px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button type="button" className="cancel-btn" onClick={() => setShowParticipantModal(false)}>
                Отмена
              </button>
              <button
                type="button"
                className="create-btn"
                onClick={() => {
                  setSelectedMeetingParticipants([...draftParticipants]);
                  setShowParticipantModal(false);
                }}
              >
                ✅ Готово
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно редактирования бронирования */}
      {showEditMeetingModal && (
        <div className="modal-overlay" onClick={() => { setShowEditMeetingModal(false); setEditingBooking(null); setMeetingForm({ title: '', description: '', meetingDate: '', startTime: '', endTime: '', organizer: '', reminderMinutes: '15' }); setSelectedMeetingParticipants([]); setParticipantSearchText(''); }}>
          <div className="modal-content task-modal" onClick={e => e.stopPropagation()} style={{ maxHeight: '85vh', height: '85vh' }}>
            <div className="modal-header">
              <h3>✏️ Редактировать бронирование</h3>
              <button onClick={() => { setShowEditMeetingModal(false); setEditingBooking(null); setMeetingForm({ title: '', description: '', meetingDate: '', startTime: '', endTime: '', organizer: '', reminderMinutes: '15' }); setSelectedMeetingParticipants([]); setParticipantSearchText(''); }}>✕</button>
            </div>

            <form style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }} onSubmit={handleUpdateBooking}>
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

                {/* Напоминание */}
                <div className="form-group">
                  <label>Напоминание</label>
                  <select
                    value={meetingForm.reminderMinutes || ''}
                    onChange={(e) => setMeetingForm({...meetingForm, reminderMinutes: e.target.value})}
                  >
                    <option value="">Без напоминания</option>
                    <option value="5">За 5 минут до начала</option>
                    <option value="10">За 10 минут до начала</option>
                    <option value="15">За 15 минут до начала</option>
                    <option value="30">За 30 минут до начала</option>
                    <option value="60">За 1 час до начала</option>
                  </select>
                </div>

                {/* Выбор участников */}
                <div className="form-group">
                  <label>Участники</label>
                  <button type="button" onClick={() => { setDraftParticipants([...selectedMeetingParticipants]); setParticipantSearchText(''); setShowParticipantModal(true); }}
                    style={{
                      width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #555',
                      background: '#2a2a2a', color: '#e0e0e0', fontSize: '14px', cursor: 'pointer',
                      textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px'
                    }}
                  >
                    👥 Выбрать участников
                    {selectedMeetingParticipants.length > 0 && (
                      <span style={{
                        background: '#667eea', color: '#fff', borderRadius: '10px', padding: '1px 8px',
                        fontSize: '12px', fontWeight: 'bold', marginLeft: 'auto'
                      }}>
                        {selectedMeetingParticipants.length}
                      </span>
                    )}
                  </button>
                  {selectedMeetingParticipants.length > 0 && (
                    <div style={{display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px'}}>
                      {selectedMeetingParticipants.map(userId => {
                        const user = availableUsers.find(u => u.id === userId);
                        return user ? (
                          <span key={userId} style={{display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#3a3f5c', borderRadius: '12px', padding: '2px 8px', fontSize: '12px', color: '#e0e0e0'}}>
                            {user.username}
                          </span>
                        ) : null;
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="cancel-btn"
                  onClick={() => { setShowEditMeetingModal(false); setEditingBooking(null); setMeetingForm({ title: '', description: '', meetingDate: '', startTime: '', endTime: '', organizer: '', reminderMinutes: '15' }); setSelectedMeetingParticipants([]); setParticipantSearchText(''); }}
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

      {/* Модальное окно просмотра медиафайлов */}
      {showMediaViewer && (
        <div className="modal-overlay" onClick={() => setShowMediaViewer(false)}>
          <div className="modal-content media-viewer-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🖼️ Медиафайлы чата</h3>
              <button onClick={() => setShowMediaViewer(false)}>✕</button>
            </div>

            <div className="modal-body">
              <div className="media-grid">
                {getChatMediaFiles().length === 0 ? (
                  <p className="no-media-message">В этом чате нет изображений</p>
                ) : (
                  getChatMediaFiles().map(file => (
                    <div key={file.id} className="media-item">
                      <img src={file.file.url} alt={file.file.filename} />
                      <div className="media-info">
                        <span className="media-date">
                          {new Date(file.timestamp).toLocaleDateString('ru-RU', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric'
                          })}
                        </span>
                        <a href={`${SOCKET_URL}/api/download/${extractFileUuidFromUrl(file.file.url)}`} className="media-download" title={file.file.filename}>
                          ⬇️ Скачать
                        </a>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button className="create-btn" onClick={() => setShowMediaViewer(false)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно просмотра документов */}
      {showDocuments && (
        <div className="modal-overlay" onClick={() => setShowDocuments(false)}>
          <div className="modal-content documents-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📄 Документы чата</h3>
              <button onClick={() => setShowDocuments(false)}>✕</button>
            </div>

            <div className="modal-body">
              <div className="documents-list">
                {chatDocuments.length === 0 ? (
                  <p className="no-documents-message">В этом чате нет документов</p>
                ) : (
                  chatDocuments.map(doc => (
                    <div key={doc.id} className="document-item">
                      <div className="document-icon">
                        {doc.mimetype?.includes('pdf') ? '📕' :
                         doc.mimetype?.includes('word') || doc.filename?.endsWith('.doc') || doc.filename?.endsWith('.docx') ? '📘' :
                         doc.mimetype?.includes('excel') || doc.filename?.endsWith('.xls') || doc.filename?.endsWith('.xlsx') ? '📗' :
                         doc.mimetype?.includes('powerpoint') || doc.filename?.endsWith('.ppt') || doc.filename?.endsWith('.pptx') ? '📙' :
                         doc.mimetype?.includes('text') || doc.filename?.endsWith('.txt') ? '📃' :
                         doc.filename?.endsWith('.csv') ? '📊' :
                         doc.filename?.endsWith('.rtf') ? '📄' : '📁'}
                      </div>
                      <div className="document-info">
                        <div className="document-name">{doc.filename}</div>
                        <div className="document-meta">
                          <span className="document-sender">{doc.senderName}</span>
                          <span className="document-date">
                            {new Date(doc.timestamp).toLocaleDateString('ru-RU', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric'
                            })}
                          </span>
                          {doc.size && (
                            <span className="document-size">{formatFileSize(doc.size)}</span>
                          )}
                        </div>
                      </div>
                      <a href={`${SOCKET_URL}/api/download/${extractFileUuidFromUrl(doc.url)}`} className="document-download-btn" title={doc.filename} download>
                        ⬇️ Скачать
                      </a>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button className="create-btn" onClick={() => setShowDocuments(false)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно подтверждения удаления */}
      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="modal-content confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>⚠️ Подтверждение</h3>
              <button onClick={() => setShowDeleteConfirm(false)}>✕</button>
            </div>

            <div className="modal-body">
              <p className="confirm-message">
                {messageToDelete
                  ? 'Вы уверены, что хотите удалить это сообщение?'
                  : `Вы уверены, что хотите удалить чат "${activeChat?.name}"? Это действие нельзя отменить.`}
              </p>
            </div>

            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowDeleteConfirm(false)}>
                Отмена
              </button>
              <button className="delete-btn" onClick={messageToDelete ? confirmDeleteMessage : confirmDeleteChat}>
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Подтверждение выхода из группы */}
      {showLeaveConfirm && (
        <div className="modal-overlay" onClick={() => setShowLeaveConfirm(false)}>
          <div className="modal-content confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🚪 Выход из группы</h3>
              <button onClick={() => setShowLeaveConfirm(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p className="confirm-message">
                Вы уверены, что хотите выйти из группы «{activeChat?.name}»?
              </p>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowLeaveConfirm(false)}>Отмена</button>
              <button className="delete-btn" onClick={confirmLeaveGroup}>Выйти</button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно управления участниками */}
      {showManageParticipants && (
        <div className="modal-overlay" onClick={() => { setShowManageParticipants(false); setShowAddParticipant(false); setParticipantSearch(''); }}>
          <div className="modal-content" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>👥 Участники группы</h3>
              <button onClick={() => { setShowManageParticipants(false); setShowAddParticipant(false); setParticipantSearch(''); }}>✕</button>
            </div>
            <div className="modal-body">
              {activeChat?.participantsDetails?.map(p => (
                <div key={p.id} className="manage-participant-row">
                  <img src={p.avatar || `https://ui-avatars.com/api/?name=${p.username}`} alt={p.username} className="manage-participant-avatar" />
                  <div className="manage-participant-info">
                    <span className="manage-participant-name">{p.username}</span>
                    {activeChat.created_by === p.id && <span className="manage-participant-badge">Создатель</span>}
                  </div>
                  {activeChat.created_by === currentUser?.id && p.id !== currentUser?.id && (
                    <button className="manage-participant-remove" onClick={() => handleRemoveParticipant(p.id)} title="Удалить из группы">✕</button>
                  )}
                </div>
              ))}
            </div>
            <div className="modal-footer" style={{ flexDirection: 'column', gap: 8 }}>
              {activeChat?.created_by === currentUser?.id && !showAddParticipant && (
                <button className="create-btn" style={{ width: '100%' }} onClick={() => setShowAddParticipant(true)}>
                  + Добавить участника
                </button>
              )}
              {showAddParticipant && (
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input
                    type="text"
                    className="modal-input"
                    placeholder="Поиск пользователей..."
                    value={participantSearch}
                    onChange={e => setParticipantSearch(e.target.value)}
                    autoFocus
                  />
                  <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                    {users
                      .filter(u => u.id !== currentUser?.id && !activeChat?.participantsDetails?.find(p => p.id === u.id) && u.username.toLowerCase().includes(participantSearch.toLowerCase()))
                      .slice(0, 20)
                      .map(u => (
                        <div key={u.id} className="manage-participant-row clickable" onClick={() => handleAddParticipant(u.id)}>
                          <img src={u.avatar || `https://ui-avatars.com/api/?name=${u.username}`} alt={u.username} className="manage-participant-avatar" />
                          <span className="manage-participant-name">{u.username}</span>
                        </div>
                      ))}
                    {participantSearch && users.filter(u => u.id !== currentUser?.id && !activeChat?.participantsDetails?.find(p => p.id === u.id) && u.username.toLowerCase().includes(participantSearch.toLowerCase())).length === 0 && (
                      <div style={{ padding: '12px', textAlign: 'center', color: '#888' }}>Пользователи не найдены</div>
                    )}
                  </div>
                  <button className="cancel-btn" style={{ width: '100%' }} onClick={() => { setShowAddParticipant(false); setParticipantSearch(''); }}>
                    Отмена
                  </button>
                </div>
              )}
              <button className="cancel-btn" style={{ width: '100%' }} onClick={() => { setShowManageParticipants(false); setShowAddParticipant(false); setParticipantSearch(''); }}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно предпросмотра изображения */}
      {showImagePreview && previewImage && (
        <div className="modal-overlay image-preview-overlay" onClick={handleCloseImagePreview}>
          <div className="image-preview-container" onClick={e => e.stopPropagation()}>
            <button className="image-preview-close" onClick={handleCloseImagePreview}>
              ✕
            </button>
            <img src={previewImage.url} alt={previewImage.filename} />
            <div className="image-preview-info">
              <span className="image-filename">{previewImage.filename}</span>
              <a href={`${SOCKET_URL}/api/download/${extractFileUuidFromUrl(previewImage.url)}`} className="image-download-btn" title={previewImage.filename}>
                ⬇️ Скачать
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно выбора статуса */}
      {showStatusPicker && (
        <div className="modal-overlay" onClick={() => setShowStatusPicker(false)}>
          <div className="modal-content status-picker-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>😊 Мой статус</h3>
              <button onClick={() => setShowStatusPicker(false)}>✕</button>
            </div>

            <div className="modal-body">
              <div className="status-preview-card">
                <div className={`status-preview-content ${!statusEmoji && !statusDescription ? 'status-preview-empty' : ''}`}>
                  <span className="status-preview-emoji">{statusEmoji ? renderEmoji(statusEmoji, '', 36) : '😶'}</span>
                  <span className="status-preview-text">{statusDescription || 'Нет статуса'}</span>
                </div>
              </div>

              <div className="status-presets-section">
                <div className="status-section-label">Быстрые статусы</div>
                <div className="status-presets-grid">
                  {[
                    { emoji: '💼', text: 'На работе' },
                    { emoji: '🏠', text: 'В отпуске' },
                    { emoji: '📞', text: 'Недоступен' },
                    { emoji: '🤒', text: 'Болею' },
                    { emoji: '🍴', text: 'Обед' },
                    { emoji: '🚗', text: 'В пути' },
                    { emoji: '💤', text: 'Отдыхаю' },
                    { emoji: '🎯', text: 'Занят' },
                  ].map(preset => (
                    <button
                      key={preset.text}
                      className={`status-preset-btn ${statusDescription === preset.text && statusEmoji === preset.emoji ? 'active' : ''}`}
                      onClick={() => {
                        setStatusEmoji(preset.emoji);
                        setStatusDescription(preset.text);
                        const newStatus = `${preset.emoji} ${preset.text}`;
                        setProfileData(prev => ({ ...prev, statusText: newStatus }));
                        setCurrentUser(prev => ({ ...prev, status_text: newStatus }));
                        fetch(`${SOCKET_URL}/api/profile`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ userId: currentUserRef.current?.id, statusText: newStatus })
                        }).catch(err => console.error('Ошибка сохранения статуса:', err));
                      }}
                    >
                      <span className="status-preset-emoji">{renderEmoji(preset.emoji, '', 24)}</span>
                      <span className="status-preset-text">{preset.text}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="status-custom-section">
                <div className="status-section-label">Свой статус</div>
                <div className="status-custom-row">
                  <div className="status-input-wrap">
                    <input
                      type="text"
                      className="status-input-custom"
                      placeholder="Введите текст статуса..."
                      value={statusDescription}
                      onChange={async (e) => {
                        const value = e.target.value;
                        setStatusDescription(value);
                        const newStatus = (statusEmoji ? statusEmoji + ' ' : '') + value;
                        setProfileData(prev => ({ ...prev, statusText: newStatus }));
                        setCurrentUser(prev => {
                          const updated = { ...prev, status_text: newStatus };
                          return updated;
                        });
                        try {
                          await fetch(`${SOCKET_URL}/api/profile`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              userId: currentUser.id,
                              statusText: newStatus
                            })
                          });
                        } catch (err) {
                          console.error('Ошибка сохранения статуса:', err);
                        }
                      }}
                      maxLength={100}
                    />
                    <button
                      className="status-emoji-btn-inline"
                      onClick={() => setShowStatusEmojiPicker(true)}
                      title="Выбрать emoji"
                    >
                      {statusEmoji ? renderEmoji(statusEmoji, '', 20) : '😀'}
                    </button>
                  </div>
                  <div className="status-quick-emoji-row">
                    {['😀','😂','😊','❤️','🔥','👍','🎉','💯'].map(emoji => (
                      <button
                        key={emoji}
                        className={`status-quick-emoji ${statusEmoji === emoji ? 'active' : ''}`}
                        onClick={() => {
                          setStatusEmoji(emoji);
                          const newStatus = emoji + (statusDescription ? ' ' + statusDescription : '');
                          setProfileData(prev => ({ ...prev, statusText: newStatus }));
                          setCurrentUser(prev => ({ ...prev, status_text: newStatus }));
                          fetch(`${SOCKET_URL}/api/profile`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ userId: currentUserRef.current?.id, statusText: newStatus })
                          }).catch(err => console.error('Ошибка сохранения статуса:', err));
                        }}
                      >
                        {renderEmoji(emoji, '', 22)}
                      </button>
                    ))}
                    <button
                      className="status-more-emoji-btn"
                      onClick={() => setShowStatusEmojiPicker(true)}
                      title="Больше emoji"
                    >
                      ...
                    </button>
                  </div>
                </div>
              </div>

              <button
                className={`status-clear-btn ${!statusEmoji && !statusDescription ? 'active' : ''}`}
                onClick={async () => {
                  setStatusEmoji('');
                  setStatusDescription('');
                  const newStatus = '';
                  setProfileData(prev => ({ ...prev, statusText: newStatus }));
                  setCurrentUser(prev => ({ ...prev, status_text: newStatus }));
                  try {
                    await fetch(`${SOCKET_URL}/api/profile`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        userId: currentUserRef.current?.id,
                        statusText: newStatus
                      })
                    });
                  } catch (err) {
                    console.error('Ошибка сохранения статуса:', err);
                  }
                }}
              >
                {!statusEmoji && !statusDescription ? '✓ Статус не установлен' : '✕ Сбросить статус'}
              </button>

              {showStatusEmojiPicker && (
                <div className="status-emoji-picker-overlay" onClick={() => setShowStatusEmojiPicker(false)}>
                  <div className="status-emoji-picker-popup" onClick={e => e.stopPropagation()}>
                    <div className="status-emoji-picker-header">
                      <span>Выберите emoji</span>
                      <button className="status-emoji-close-btn" onClick={() => setShowStatusEmojiPicker(false)}>✕</button>
                    </div>
                    <div className="status-emoji-grid">
                      {SAFE_EMOJIS.filter(Boolean).map(emoji => (
                        <button
                          key={emoji}
                          className={`status-emoji-option ${statusEmoji === emoji ? 'active' : ''}`}
                          onClick={() => {
                            setStatusEmoji(emoji);
                            const newStatus = emoji + (statusDescription ? ' ' + statusDescription : '');
                            setProfileData(prev => ({ ...prev, statusText: newStatus }));
                            setCurrentUser(prev => ({ ...prev, status_text: newStatus }));
                            setShowStatusEmojiPicker(false);
                            fetch(`${SOCKET_URL}/api/profile`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ userId: currentUserRef.current?.id, statusText: newStatus })
                            }).catch(err => console.error('Ошибка сохранения статуса:', err));
                          }}
                        >
                          {renderEmoji(emoji, '', 28)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="create-btn" onClick={() => setShowStatusPicker(false)}>
                Готово
              </button>
            </div>
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
                    onClick={() => toggleUserForShare(user.id)}
                  >
                    <img src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.username)}`} alt={user.username} className="share-user-avatar" onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || 'U')}`; }} />
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
                onClick={confirmShareTask}
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
              <button className="refresh-tasks-btn" onClick={fetchSharedTasksReceived}>
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
                        <img src={share.from_avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(share.from_username)}`} alt={share.from_username} className="shared-task-avatar" onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || share.from_username || 'U')}`; }} />
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
                          <button className="accept-task-btn" onClick={() => handleAcceptSharedTask(share.id)}>
                            ✓ Принять
                          </button>
                          <button className="decline-task-btn" onClick={() => handleDeclineSharedTask(share.id)}>
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

      {/* Контекстное меню сообщений */}
      {contextMenu.visible && (
        <div
          className="message-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={closeContextMenu}
        >
          {/* Быстрые реакции */}
          <div className="context-menu-reactions-wrapper">
            {QUICK_REACTIONS.length > 6 ? (
              <>
                <div className={`context-menu-reactions ${contextMenu.reactionsExpanded ? 'expanded' : ''}`}>
                  {(contextMenu.reactionsExpanded ? QUICK_REACTIONS : QUICK_REACTIONS.slice(0, 6)).map((emoji) => (
                    <button
                      key={emoji}
                      className="context-menu-reaction-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.target.getBoundingClientRect();
                        handleAddReaction(emoji, contextMenu.messageId, rect);
                      }}
                    >
                      {renderEmoji(emoji)}
                    </button>
                  ))}
                </div>
                <button
                  className="context-menu-reactions-toggle"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleReactionsExpand();
                  }}
                  title={contextMenu.reactionsExpanded ? 'Свернуть реакции' : 'Развернуть все реакции'}
                >
                  {contextMenu.reactionsExpanded ? (
                    <>
                      <span className="reactions-toggle-icon">▲</span>
                      <span className="reactions-toggle-text">Свернуть</span>
                    </>
                  ) : (
                    <>
                      <span className="reactions-toggle-icon">▼</span>
                      <span className="reactions-toggle-text">{QUICK_REACTIONS.length - 6} ещё</span>
                    </>
                  )}
                </button>
              </>
            ) : (
              <div className="context-menu-reactions">
                {QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    className="context-menu-reaction-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = e.target.getBoundingClientRect();
                      handleAddReaction(emoji, contextMenu.messageId, rect);
                    }}
                  >
                    {renderEmoji(emoji)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="context-menu-divider"></div>
          <div className="context-menu-items">
            {/* Ответить */}
            <button className="context-menu-item" onClick={(e) => { e.stopPropagation(); openReply(contextMenu.messageId, contextMenu.messageText, contextMenu.messageSenderName); }}>
              ↩️ Ответить
            </button>
            <div className="context-menu-divider"></div>
            <button className="context-menu-item" onClick={(e) => { e.stopPropagation(); handleCopyMessage(); }}>
              📋 Копировать
            </button>
            {/* Редактировать: только свои сообщения */}
            {contextMenu.messageSenderId === currentUser?.id && (
              <button className="context-menu-item" onClick={(e) => { e.stopPropagation(); openEditMessage(contextMenu.messageId, contextMenu.messageText, contextMenu.messageSenderName); }}>
                ✏️ Изменить
              </button>
            )}
            <button className="context-menu-item" onClick={(e) => { e.stopPropagation(); handleForwardMessage({ id: contextMenu.messageId, text: contextMenu.messageText }); }}>
              ➤ Переслать
            </button>
            {/* Закрепить/Открепить */}
            {(() => {
              const chatPinned = pinnedMessages[contextMenu.messageChatId] || [];
              const isPinned = chatPinned.find(m => String(m.id) === String(contextMenu.messageId));
              return (
                <button className="context-menu-item" onClick={(e) => {
                  e.stopPropagation();
                  closeContextMenu();
                  if (isPinned) {
                    handleUnpinMessage(contextMenu.messageId);
                  } else {
                    handlePinMessage(contextMenu.messageId);
                  }
                }}>
                  {isPinned ? '📌 Открепить' : '📌 Закрепить'}
                </button>
              );
            })()}
            {/* Удаление: все могут удалять свои сообщения, в общем чате только админы */}
            {contextMenu.messageChatId !== 'general' || currentUser?.is_admin === 1 ? (
              <button
                className="context-menu-item context-menu-item-danger"
                onClick={(e) => {
                  e.stopPropagation();
                  closeContextMenu();
                  if (!contextMenu.messageId) {
                    alert('Невозможно удалить сообщение: отсутствует ID сообщения');
                    return;
                  }
                  handleDeleteMessage({ id: contextMenu.messageId });
                }}
              >
                🗑️ Удалить
              </button>
            ) : null}
          </div>
        </div>
      )}

      {/* Контекстное меню поля ввода */}
      {inputContextMenu.visible && (
        <div
          className="message-context-menu input-context-menu"
          style={{ top: inputContextMenu.y, left: inputContextMenu.x }}
          onClick={closeInputContextMenu}
        >
          <div className="context-menu-items">
            <button className="context-menu-item" onClick={(e) => { e.stopPropagation(); handleCutText(); }}>
              ✂️ Вырезать
            </button>
            <button className="context-menu-item" onClick={(e) => { e.stopPropagation(); handleCopyText(); }}>
              📋 Копировать
            </button>
            <button className="context-menu-item" onClick={(e) => { e.stopPropagation(); handlePasteText(); }}>
              📄 Вставить
            </button>
          </div>
        </div>
      )}

      {/* Модальное окно пересылки сообщения */}
      {showForwardModal && (
        <div className="modal-overlay" onClick={() => setShowForwardModal(false)}>
          <div className="modal-content forward-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>➤ Переслать сообщение</h3>
              <button onClick={() => setShowForwardModal(false)}>✕</button>
            </div>

            <div className="modal-body">
              <div className="forward-preview">
                <p className="forward-preview-text">
                  {stripStickerMarkers(contextMenu.messageText)?.substring(0, 200)}
                  {contextMenu.messageText?.length > 200 ? '...' : ''}
                </p>
              </div>

              <div className="forward-search">
                <label>Поиск пользователя:</label>
                <input
                  type="text"
                  placeholder="Введите ФИО..."
                  value={forwardSearchQuery}
                  onChange={(e) => setForwardSearchQuery(e.target.value)}
                  className="forward-search-input"
                  autoFocus
                />
              </div>

              <div className="forward-users-list">
                <label>Выберите получателя:</label>
                <div className="users-list">
                  {users
                    .filter(user => 
                      user.username.toLowerCase().includes(forwardSearchQuery.toLowerCase()) &&
                      user.id !== currentUser?.id
                    )
                    .map(user => (
                      <div
                        key={user.id}
                        className={`user-item ${selectedForwardUser?.id === user.id ? 'selected' : ''}`}
                        onClick={() => setSelectedForwardUser(user)}
                      >
                        <img
                          src={user.avatar || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.username)}
                          alt={user.username}
                          className="user-avatar-small"
                          onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || 'U')}`; }}
                        />
                        <div className="user-info">
                          <span className="username">{user.username}</span>
                          {user.status_text && (
                            <span className="user-status">{wrapEmojisInText(user.status_text)}</span>
                          )}
                        </div>
                        {selectedForwardUser?.id === user.id && (
                          <span className="checkmark">✓</span>
                        )}
                      </div>
                    ))
                  }
                  {users.filter(user => 
                    user.username.toLowerCase().includes(forwardSearchQuery.toLowerCase()) &&
                    user.id !== currentUser?.id
                  ).length === 0 && (
                    <div className="no-users">Пользователи не найдены</div>
                  )}
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="cancel-btn" onClick={() => setShowForwardModal(false)}>
                Отмена
              </button>
              <button
                type="button"
                className="create-btn"
                onClick={handleSendForwardedMessage}
                disabled={!selectedForwardUser}
              >
                Переслать
              </button>
            </div>
          </div>
        </div>
      )}

      {previewAvatar && (
        <div className="modal-overlay" onClick={() => setPreviewAvatar(null)}>
          <div className="modal-content avatar-preview-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🖼️ Аватар группы</h3>
              <button onClick={() => setPreviewAvatar(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ textAlign: 'center', padding: '20px' }}>
              <img src={previewAvatar.src} alt="Аватар" className="avatar-preview-img" onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || previewAvatar.alt || 'U')}`; }} />
              <div style={{ marginTop: '16px' }}>
                <button className="btn-primary" onClick={() => { const chatId = previewAvatar.chatId; setPreviewAvatar(null); setTimeout(() => document.getElementById(`group-avatar-${chatId}`)?.click(), 100); }}>
                  📷 Сменить аватар
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showWikiShareModal && (
        <div className="modal-overlay" onClick={() => setShowWikiShareModal(false)}>
          <div className="modal-content forward-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📤 Поделиться статьёй</h3>
              <button onClick={() => setShowWikiShareModal(false)}>✕</button>
            </div>

            <div className="modal-body">
              <div className="forward-preview">
                <p className="forward-preview-text">
                  📖 {wikiShareArticle?.title}
                </p>
              </div>

              <div className="forward-search">
                <label>Поиск пользователя:</label>
                <input
                  type="text"
                  placeholder="Введите ФИО..."
                  value={wikiShareSearchQuery}
                  onChange={(e) => setWikiShareSearchQuery(e.target.value)}
                  className="forward-search-input"
                  autoFocus
                />
              </div>

              <div className="forward-users-list">
                <label>Выберите получателя:</label>
                <div className="users-list">
                  {users
                    .filter(user =>
                      user.username.toLowerCase().includes(wikiShareSearchQuery.toLowerCase()) &&
                      user.id !== currentUser?.id
                    )
                    .map(user => (
                      <div
                        key={user.id}
                        className={`user-item ${selectedWikiShareUser?.id === user.id ? 'selected' : ''}`}
                        onClick={() => setSelectedWikiShareUser(user)}
                      >
                        <img
                          src={user.avatar || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.username)}
                          alt={user.username}
                          className="user-avatar-small"
                          onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || 'U')}`; }}
                        />
                        <div className="user-info">
                          <span className="username">{user.username}</span>
                          {user.status_text && (
                            <span className="user-status">{wrapEmojisInText(user.status_text)}</span>
                          )}
                        </div>
                        {selectedWikiShareUser?.id === user.id && (
                          <span className="checkmark">✓</span>
                        )}
                      </div>
                    ))
                  }
                  {users.filter(user =>
                    user.username.toLowerCase().includes(wikiShareSearchQuery.toLowerCase()) &&
                    user.id !== currentUser?.id
                  ).length === 0 && (
                    <div className="no-users">Пользователи не найдены</div>
                  )}
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="cancel-btn" onClick={() => setShowWikiShareModal(false)}>
                Отмена
              </button>
              <button
                type="button"
                className="create-btn"
                onClick={handleSendWikiShare}
                disabled={!selectedWikiShareUser}
              >
                Отправить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно редактирования сообщения */}
      {showEditModal && (
        <div className="modal-overlay" onClick={handleCancelEdit}>
          <div className="modal-content edit-message-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>✏️ Редактировать сообщение</h3>
              <button onClick={handleCancelEdit}>✕</button>
            </div>

            <div className="modal-body">
              <textarea
                className="edit-message-textarea"
                value={editMessageText}
                onChange={(e) => setEditMessageText(e.target.value)}
                placeholder="Введите текст сообщения..."
                rows={4}
                autoFocus
              />
            </div>

            <div className="modal-footer">
              <button type="button" className="cancel-btn" onClick={handleCancelEdit}>
                Отмена
              </button>
              <button
                type="button"
                className="create-btn"
                onClick={handleSaveEditMessage}
                disabled={!editMessageText.trim()}
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно создания объявления (admin) */}
      {showCreateAnnouncement && (
        <div className="modal-overlay" onClick={() => { if (!announcementLoading) setShowCreateAnnouncement(false); }}>
          <div className="modal-content announcement-create-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📢 Создать объявление</h3>
              <button onClick={() => setShowCreateAnnouncement(false)} disabled={announcementLoading}>✕</button>
            </div>
            <div className="modal-body">
              <div className="ann-form-group">
                <label>Приоритет</label>
                <select className="ann-input" value={announcementPriority}
                  onChange={e => setAnnouncementPriority(e.target.value)} disabled={announcementLoading}>
                  <option value="normal">📢 Обычное</option>
                  <option value="high">🟡 Важное</option>
                  <option value="urgent">🔴 Срочное</option>
                </select>
              </div>
              <div className="ann-form-group">
                <label>Заголовок</label>
                <input type="text" className="ann-input" placeholder="Заголовок объявления..."
                  value={announcementTitle} onChange={e => setAnnouncementTitle(e.target.value)}
                  maxLength={200} disabled={announcementLoading} />
              </div>
              <div className="ann-form-group">
                <label>Текст объявления</label>
                <textarea className="ann-input ann-textarea" placeholder="Текст объявления..."
                  value={announcementContent} onChange={e => setAnnouncementContent(e.target.value)}
                  rows={5} disabled={announcementLoading} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowCreateAnnouncement(false)} disabled={announcementLoading}>Отмена</button>
              <button className="save-btn" onClick={handleCreateAnnouncement}
                disabled={announcementLoading || !announcementTitle.trim() || !announcementContent.trim()}>
                {announcementLoading ? '⏳ Публикация...' : '📢 Опубликовать'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно списка объявлений */}
      {showAnnouncements && (
        <div className="modal-overlay" onClick={() => setShowAnnouncements(false)}>
          <div className="modal-content announcements-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📢 Объявления</h3>
              <button onClick={() => setShowAnnouncements(false)}>✕</button>
            </div>
            <div className="modal-body announcements-body">
              {isAdmin && (
                <button className="ann-create-btn" onClick={() => setShowCreateAnnouncement(true)}>
                  + Создать объявление
                </button>
              )}
              {announcements.length === 0 ? (
                <div className="ann-empty">
                  <span className="ann-empty-icon">📢</span>
                  <p>Нет объявлений</p>
                </div>
              ) : (
                announcements.map(ann => (
                  <div key={ann.id} className={`ann-item ${ann.priority === 'urgent' ? 'ann-urgent' : ann.priority === 'high' ? 'ann-high' : ''}`}
                    onClick={() => !ann.isRead && handleMarkAnnouncementRead(ann.id)}>
                    <div className="ann-item-header">
                      <span className="ann-priority-badge">
                        {ann.priority === 'urgent' ? '🔴' : ann.priority === 'high' ? '🟡' : '📢'}
                      </span>
                      <span className="ann-item-title">{ann.title}</span>
                      {!ann.isRead && <span className="ann-unread-dot">●</span>}
                    </div>
                    <div className="ann-item-meta">
                      <span className="ann-item-author">{ann.creatorName}</span>
                      <span className="ann-item-date">{formatDate(ann.createdAt)}</span>
                      <span className="ann-item-reads">
                        {ann.readCount}/{ann.totalUsers}
                      </span>
                    </div>
                    <div className="ann-item-content">{ann.content}</div>
                    {ann.isRead && ann.myReadAt && (
                      <div className="ann-item-read-at">✅ Прочитано {formatTime(ann.myReadAt)}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно заявлений */}
      {showHR && (
        <div className="modal-overlay" onClick={() => setShowHR(false)}>
          <div className="modal-content hr-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📋 Заявления</h3>
              <button onClick={() => setShowHR(false)}>✕</button>
            </div>
            <div className="modal-body hr-body">
              {isAdmin && (
                <div className="hr-view-toggle">
                  <button className={`hr-toggle-btn ${hrViewMode === 'my' ? 'active' : ''}`} onClick={() => setHrViewMode('my')}>Мои</button>
                  <button className={`hr-toggle-btn ${hrViewMode === 'pending' ? 'active' : ''}`} onClick={() => setHrViewMode('pending')}>На согласование</button>
                </div>
              )}
              <button className="ann-create-btn" onClick={() => setShowHRCreate(true)}>+ Новое заявление</button>
              {hrRequests.length === 0 && hrViewMode === 'my' ? (
                <div className="ann-empty"><p>Нет заявлений</p></div>
              ) : hrViewMode === 'pending' ? (
                hrRequests.filter(r => r.status === 'pending').map(r => (
                  <div key={r.id} className="hr-card">
                    <div className="hr-card-header">
                      <span className="hr-type-badge">
                        {r.type === 'vacation' ? '🏖️ Отпуск' : r.type === 'sick' ? '🤒 Больничный' : '📅 Отгул'}
                      </span>
                      <span className="hr-status pending">⏳ Ожидает</span>
                    </div>
                    <div className="hr-card-user">{r.userName}</div>
                    <div className="hr-card-dates">{r.start_date} — {r.end_date}</div>
                    {r.reason && <div className="hr-card-reason">{r.reason}</div>}
                    {isAdmin && (
                      <div className="hr-card-actions">
                        <input className="hr-comment-input" placeholder="Комментарий..." id={`hr-comment-${r.id}`} />
                        <button className="hr-approve-btn" onClick={() => handleApproveHrRequest(r.id, 'approved', document.getElementById(`hr-comment-${r.id}`).value)}>✅ Одобрить</button>
                        <button className="hr-reject-btn" onClick={() => handleApproveHrRequest(r.id, 'rejected', document.getElementById(`hr-comment-${r.id}`).value)}>❌ Отклонить</button>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                hrRequests.map(r => (
                  <div key={r.id} className="hr-card">
                    <div className="hr-card-header">
                      <span className="hr-type-badge">
                        {r.type === 'vacation' ? '🏖️ Отпуск' : r.type === 'sick' ? '🤒 Больничный' : '📅 Отгул'}
                      </span>
                      <span className={`hr-status ${r.status}`}>
                        {r.status === 'pending' ? '⏳ Ожидает' : r.status === 'approved' ? '✅ Одобрено' : r.status === 'rejected' ? '❌ Отклонено' : '🚫 Отменено'}
                      </span>
                    </div>
                    {r.userName && <div className="hr-card-user">{r.userName}</div>}
                    <div className="hr-card-dates">{r.start_date} — {r.end_date}</div>
                    {r.reason && <div className="hr-card-reason">{r.reason}</div>}
                    <div className="hr-card-created">{formatDate(r.created_at)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно создания заявления */}
      {showHRCreate && (
        <div className="modal-overlay" onClick={() => { if (!hrLoading) setShowHRCreate(false); }}>
          <div className="modal-content" style={{ maxWidth: 450 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📋 Новое заявление</h3>
              <button onClick={() => setShowHRCreate(false)} disabled={hrLoading}>✕</button>
            </div>
            <div className="modal-body">
              <div className="ann-form-group">
                <label>Тип заявления</label>
                <select className="ann-input" value={hrForm.type} onChange={e => setHrForm({ ...hrForm, type: e.target.value })} disabled={hrLoading}>
                  <option value="vacation">🏖️ Отпуск</option>
                  <option value="sick">🤒 Больничный</option>
                  <option value="day_off">📅 Отгул</option>
                </select>
              </div>
              <div className="ann-form-group">
                <label>Дата начала</label>
                <input type="date" className="ann-input" value={hrForm.startDate} onChange={e => setHrForm({ ...hrForm, startDate: e.target.value })} disabled={hrLoading} />
              </div>
              <div className="ann-form-group">
                <label>Дата окончания</label>
                <input type="date" className="ann-input" value={hrForm.endDate} onChange={e => setHrForm({ ...hrForm, endDate: e.target.value })} disabled={hrLoading} />
              </div>
              <div className="ann-form-group">
                <label>Причина</label>
                <textarea className="ann-input ann-textarea" placeholder="Причина (необязательно)..." value={hrForm.reason} onChange={e => setHrForm({ ...hrForm, reason: e.target.value })} rows={3} disabled={hrLoading} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowHRCreate(false)} disabled={hrLoading}>Отмена</button>
              <button className="save-btn" onClick={handleCreateHrRequest} disabled={hrLoading || !hrForm.startDate || !hrForm.endDate}>
                {hrLoading ? '⏳ Отправка...' : '📋 Отправить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно закреплённых сообщений */}
      {/* Модальное окно создания опроса */}
      {showPollModal && (
        <div className="modal-overlay" onClick={() => { if (!pollLoading) setShowPollModal(false); }}>
          <div className="modal-content poll-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📊 Создать опрос</h3>
              <button onClick={() => setShowPollModal(false)} disabled={pollLoading}>✕</button>
            </div>
            <div className="modal-body">
              <div className="poll-form-group">
                <label>Вопрос</label>
                <input type="text" className="poll-input" placeholder="Задайте вопрос..." value={pollQuestion}
                  onChange={e => setPollQuestion(e.target.value)} maxLength={200} disabled={pollLoading} />
              </div>
              <div className="poll-form-group">
                <label>Варианты ответа (минимум 2, максимум 10)</label>
                {pollOptions.map((opt, idx) => (
                  <div key={idx} className="poll-option-row">
                    <input type="text" className="poll-input poll-option-input" placeholder={`Вариант ${idx + 1}...`}
                      value={opt} onChange={e => {
                        const newOpts = [...pollOptions];
                        newOpts[idx] = e.target.value;
                        setPollOptions(newOpts);
                      }} maxLength={100} disabled={pollLoading} />
                    {pollOptions.length > 2 && (
                      <button className="poll-remove-option" onClick={() => {
                        if (pollOptions.length > 2) setPollOptions(pollOptions.filter((_, i) => i !== idx));
                      }} disabled={pollLoading}>✕</button>
                    )}
                  </div>
                ))}
                {pollOptions.length < 10 && (
                  <button className="poll-add-option" onClick={() => setPollOptions([...pollOptions, ''])} disabled={pollLoading}>
                    + Добавить вариант
                  </button>
                )}
              </div>
              <div className="poll-settings">
                <label className="poll-toggle">
                  <input type="checkbox" checked={pollIsAnonymous} onChange={e => setPollIsAnonymous(e.target.checked)} disabled={pollLoading} />
                  <span>Анонимное голосование</span>
                </label>
                <label className="poll-toggle">
                  <input type="checkbox" checked={pollAllowsMultiple} onChange={e => setPollAllowsMultiple(e.target.checked)} disabled={pollLoading} />
                  <span>Множественный выбор</span>
                </label>
                <label className="poll-toggle">
                  <input type="checkbox" checked={pollHideResults} onChange={e => setPollHideResults(e.target.checked)} disabled={pollLoading} />
                  <span>Скрывать результаты до окончания</span>
                </label>
              </div>
              <div className="poll-form-group" style={{ marginTop: 8 }}>
                <label>Автоматическое завершение (необязательно)</label>
                <input type="datetime-local" className="poll-input" value={pollClosesAt}
                  onChange={e => setPollClosesAt(e.target.value)} disabled={pollLoading} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowPollModal(false)} disabled={pollLoading}>Отмена</button>
              <button className="save-btn" onClick={handleCreatePoll} disabled={pollLoading || pollQuestion.trim().length < 1 || pollOptions.filter(o => o.trim()).length < 2}>
                {pollLoading ? '⏳ Создание...' : '📊 Создать опрос'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPinnedModal && (
        <div className="modal-overlay" onClick={() => setShowPinnedModal(false)}>
          <div className="modal-content pinned-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📌 Закреплённые сообщения</h3>
              <button onClick={() => setShowPinnedModal(false)}>✕</button>
            </div>
            <div className="modal-body pinned-modal-body">
              {pinnedMessages[activeChatIdRef.current] && pinnedMessages[activeChatIdRef.current].length > 0 ? (
                pinnedMessages[activeChatIdRef.current].map((pinnedMsg) => (
                  <div key={pinnedMsg.id} className="pinned-message-item">
                    <div className="pinned-message-header">
                      <img
                        src={pinnedMsg.senderAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(pinnedMsg.senderName || 'U')}`}
                        alt={pinnedMsg.senderName}
                        className="pinned-message-avatar"
                        onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(e.target.alt || 'U')}`; }}
                      />
                      <div className="pinned-message-meta">
                        <span className="pinned-message-sender">{pinnedMsg.senderName}</span>
                        <span className="pinned-message-time">{formatTime(pinnedMsg.timestamp)}</span>
                      </div>
                      <button
                        className="pinned-message-unpin-btn"
                        onClick={() => handleUnpinMessage(pinnedMsg.id)}
                        title="Открепить"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="pinned-message-text">
                      {renderMessageContent(pinnedMsg.text || '')}
                    </div>
                  </div>
                ))
              ) : (
                <div className="pinned-empty">
                  <span className="pinned-empty-icon">📌</span>
                  <p>Нет закреплённых сообщений</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
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

export default App;
