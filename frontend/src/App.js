import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import EmojiPicker from 'emoji-picker-react';
import { SAFE_EMOJIS } from './safe-emojis';

const SOCKET_URL = 'http://192.168.210.48:3001';
const STORAGE_KEY = 'chat_user_data';

function App() {
  const [socket, setSocket] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('connecting'); // 'connecting', 'connected', 'disconnected', 'reconnecting'
  const [lastUser, setLastUser] = useState(null); // Данные последнего пользователя для быстрого входа
  const [showLoginForm, setShowLoginForm] = useState(false); // Показывать форму входа
  const [showAuthForm, setShowAuthForm] = useState(false); // Свернуто/развернуто форма входа/регистрации
  const [appVersion, setAppVersion] = useState('1.0.8');
  const [updateStatus, setUpdateStatus] = useState(null); // null, 'checking', 'available', 'downloading', 'ready'
  const [updateProgress, setUpdateProgress] = useState(0);
  
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

  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);

  const [inputText, setInputText] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [typingUsers, setTypingUsers] = useState({}); // { userId: { username, timeout } }
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
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
    messageSenderId: null
  });

  // Реакции на сообщения
  const [messageReactions, setMessageReactions] = useState({});

  // Быстрые реакции (в контекстном меню)
  const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '😡', '🙈'];

  // Модальное окно пересылки
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardSearchQuery, setForwardSearchQuery] = useState('');
  const [selectedForwardUser, setSelectedForwardUser] = useState(null);
  
  // Модальное окно редактирования сообщения
  const [showEditModal, setShowEditModal] = useState(false);
  const [editMessageText, setEditMessageText] = useState('');
  const [editMessageId, setEditMessageId] = useState(null);
  
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
  const [editingBooking, setEditingBooking] = useState(null);
  const [meetingForm, setMeetingForm] = useState({
    title: '',
    description: '',
    meetingDate: '',
    startTime: '',
    endTime: '',
    organizer: ''
  });
  const [canBookMeetingRoom, setCanBookMeetingRoom] = useState(false); // Право на бронирование
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
  const [showImagePreview, setShowImagePreview] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [readMessages, setReadMessages] = useState({}); // { messageId: [userIds] }
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
  const [userSearchResults, setUserSearchResults] = useState([]);
  const [showShareTaskModal, setShowShareTaskModal] = useState(false);
  const [taskToShare, setTaskToShare] = useState(null);
  const [availableUsers, setAvailableUsers] = useState([]);
  const [selectedUsersForShare, setSelectedUsersForShare] = useState([]);
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
  const [activeSettingsTab, setActiveSettingsTab] = useState('appearance'); // 'appearance', 'notifications', 'about'
  const [userUiSettings, setUserUiSettings] = useState({
    themeColor: '#667eea',
    themeGradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    fontSize: 'medium', // 'small', 'medium', 'large'
    compactMode: false,
    messageFontSize: '15', // размер текста в сообщениях (px)
    messageEmojiSize: '20' // размер эмодзи в сообщениях (px)
  });
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminStats, setAdminStats] = useState(null);
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
  const emojiPickerRef = useRef(null);
  const messageInputRef = useRef(null);
  const activeChatIdRef = useRef(null);
  const currentUserRef = useRef(null);
  const lastBirthdayCheckRef = useRef(null);
  const socketRef = useRef(null);
  const loginFormRef = useRef(null);
  const loginTimeoutRef = useRef(null);

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
    document.documentElement.setAttribute('data-font-size', userUiSettings.fontSize);
    // Применяем размер текста в сообщениях
    document.documentElement.style.setProperty('--message-font-size', `${userUiSettings.messageFontSize}px`);
    // Применяем размер эмодзи в сообщениях (в px, независимо от текста)
    document.documentElement.style.setProperty('--message-emoji-size', `${userUiSettings.messageEmojiSize}px`);
  }, [userUiSettings]);

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

      // Обновляем предыдущий chatId и ref
      setPrevChatId(activeChatId);
      activeChatIdRef.current = activeChatId;

      const timer = setTimeout(() => {
        messageInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [activeChatId]);

  // Закрытие панели смайлов при клике вне
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target)) {
        setShowEmojiPicker(false);
      }
    };

    if (showEmojiPicker) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showEmojiPicker]);

  // Отслеживание размера окна для адаптивного поведения
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };

    window.addEventListener('resize', handleResize);
    handleResize(); // Вызываем сразу при монтировании

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Получение версии приложения и настройка обновлений
  useEffect(() => {
    const initApp = async () => {
      // Получаем версию из Electron API если доступно
      if (window.electronAPI) {
        try {
          const version = await window.electronAPI.getAppVersion();
          setAppVersion(version);

          // Подписываемся на обновления
          window.electronAPI.onCheckingForUpdate(() => {
            setUpdateStatus('checking');
            console.log('Проверка обновлений...');
          });

          window.electronAPI.onUpdateAvailable((event, info) => {
            setUpdateStatus('available');
            console.log('Доступно обновление:', info);
          });

          window.electronAPI.onUpdateNotAvailable((event, info) => {
            setUpdateStatus('no-update');
            console.log('Обновлений не найдено');
          });

          window.electronAPI.onDownloadProgress((event, progress) => {
            setUpdateStatus('downloading');
            setUpdateProgress(progress.percent);
            console.log('Загрузка обновления:', progress.percent);
          });

          window.electronAPI.onUpdateDownloaded((event, info) => {
            setUpdateStatus('ready');
            console.log('Обновление готово к установке');
          });

          window.electronAPI.onUpdateError((event, error) => {
            setUpdateStatus(null);
            console.error('Ошибка обновления:', error);
          });
        } catch (err) {
          console.error('Ошибка получения версии:', err);
        }
      }
    };

    initApp();
  }, []);

  // Инициализация сокета
  useEffect(() => {
    const newSocket = io(SOCKET_URL, {
      reconnection: true,
      reconnectionAttempts: 10,
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

      // При переподключении заново отправляем user_joined
      const savedData = localStorage.getItem(STORAGE_KEY);
      if (savedData) {
        try {
          const parsed = JSON.parse(savedData);
          console.log('Переподключение: отправляем user_joined:', parsed);
          newSocket.emit('user_joined', {
            userId: parsed.userId,
            username: parsed.username,
            email: parsed.email
          });
        } catch (e) {
          console.error('Ошибка парсинга savedData при переподключении:', e);
        }
      }
    });

    newSocket.on('disconnect', () => {
      console.warn('⚠ Сокет отключён!');
      // Показываем экран потери связи только если пользователь был залогинен
      if (localStorage.getItem(STORAGE_KEY)) {
        setConnectionStatus('disconnected');
        setIsLoggedIn(false);
        setCurrentUser(null);
      }
    });

    newSocket.on('reconnect', (attemptNumber) => {
      console.log('✓ Сокет переподключён после', attemptNumber, 'попыток');
      setConnectionStatus('connected');

      // После переподключения присоединяемся к активному чату
      if (activeChatIdRef.current) {
        console.log('Переподключение: присоединяемся к чату', activeChatIdRef.current);
        newSocket.emit('join_chat', activeChatIdRef.current);
      }
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
      setIsLoggedIn(false);
      setCurrentUser(null);
    });

    newSocket.on('connect_error', (err) => {
      console.error('Ошибка подключения:', err.message);
    });

    // Проверяем сохраненные данные пользователя (для авто-входа)
    const savedData = localStorage.getItem(STORAGE_KEY);
    const savedCredentials = localStorage.getItem('chat_credentials');
    const savedLastUser = localStorage.getItem('chat_last_user');

    console.log('Сохранённые данные:', savedData);
    console.log('Сохранённые учётные данные:', savedCredentials);

    // Загружаем данные последнего пользователя для отображения на экране входа
    if (savedLastUser) {
      try {
        const lastUserData = JSON.parse(savedLastUser);
        setLastUser(lastUserData);
      } catch (e) {
        console.error('Ошибка парсинга lastUser:', e);
      }
    }

    // Если есть учётные данные, заполняем форму
    if (savedCredentials) {
      try {
        const creds = JSON.parse(savedCredentials);
        setEmail(creds.email || '');
        setPassword(creds.password || '');
        setRememberMe(true);
      } catch (e) {
        console.error('Ошибка парсинга credentials:', e);
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
          email: parsed.email
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
          // Обновляем право на бронирование после загрузки профиля
          const hasRight = fullUser.username === 'Root' || fullUser.is_admin === 1;
          setCanBookMeetingRoom(hasRight);
        } else {
          setCurrentUser(user);
          const hasRight = user.username === 'Root' || user.is_admin === 1;
          setCanBookMeetingRoom(hasRight);
        }
      } catch (err) {
        console.error('Ошибка загрузки профиля:', err);
        setCurrentUser(user);
        const hasRight = user.username === 'Root' || user.is_admin === 1;
        setCanBookMeetingRoom(hasRight);
      }
      
      setIsLoggedIn(true);
      // Сбрасываем unreadCount для всех чатов при загрузке
      // (так как пользователь только что вошел и видел все сообщения)
      const chatsWithZeroUnread = userChats.map(chat => ({
        ...chat,
        unreadCount: 0
      }));
      setChats(chatsWithZeroUnread);

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

      // Проверяем право на бронирование переговорной
      // По умолчанию у Root есть это право
      const hasRight = user.username === 'Root' || user.is_admin === 1;
      setCanBookMeetingRoom(hasRight);

      if (userChats.length > 0) {
        const firstChat = userChats[0];
        setActiveChatId(firstChat.id);
        activeChatIdRef.current = firstChat.id;
        newSocket.emit('join_chat', firstChat.id);
      }
    });

    newSocket.on('chat_history', ({ chatId, messages: chatMessages }) => {
      // Очищаем таймаут загрузки если он есть
      if (window.chatLoadTimeout) {
        clearTimeout(window.chatLoadTimeout);
        window.chatLoadTimeout = null;
      }

      // Устанавливаем сообщения только для активного чата
      if (activeChatIdRef.current === chatId) {
        setMessages(chatMessages);

        // Принудительно прокручиваем вниз после загрузки
        setTimeout(() => {
          if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
          }
        }, 100);

        // Инициализируем реакции из сообщений
        const reactionsData = {};
        chatMessages.forEach(msg => {
          if (msg.reactions) {
            reactionsData[msg.id] = { reactions: msg.reactions };
          }
        });
        setMessageReactions(reactionsData);
      }
    });

    newSocket.on('new_message', ({ message, chat, isOwnMessage }) => {
      // Используем currentUserRef.current и activeChatIdRef.current для актуальных значений
      const myId = currentUserRef.current?.id;
      const isMyMessage = isOwnMessage || message.senderId === myId;

      // Определяем, активен ли чат - используем ref для актуального значения
      const isChatActive = message.chatId === activeChatIdRef.current;

      // Проверяем, находится ли приложение в фокусе (для Electron)
      let isAppFocused = true;
      if (window.electronAPI) {
        // Для Electron приложения проверяем фокус окна
        isAppFocused = document.hasFocus() && !document.hidden;
      }

      // Показываем уведомление если:
      // 1. Сообщение не от нас
      // 2. ИЛИ чат не активен, ИЛИ приложение не в фокусе (свернуто)
      if (!isMyMessage && notificationPermissionRef.current === 'granted') {
        const shouldShowNotification = !isChatActive || !isAppFocused;
        
        if (!shouldShowNotification) {
          console.log('Уведомление НЕ показываем: чат активен и приложение в фокусе');
          // Продолжаем обработку для обновления UI, но без уведомления
        }

        // Проверяем, является ли отправитель ботом-помощником
        const isBotMessage = message.senderName === 'Помощник' || message.senderId?.includes('bot-');

        // Если это сообщение от бота и уведомления от бота отключены - не показываем
        if (isBotMessage && !notificationSettingsRef.current.botAssistant) {
          console.log('Уведомление от бота отключено в настройках');
        }
        // Проверяем настройки уведомлений для обычных сообщений
        else if (notificationSettingsRef.current.newMessages) {
          // Показываем уведомление только если чат не активен или приложение не в фокусе
          if (shouldShowNotification) {
          // Звук уведомления
          if (notificationSettingsRef.current.sound) {
            try {
              const audio = new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU');
              audio.play().catch(() => {});
            } catch (e) {}
          }

          // Push уведомление
          const notificationData = {
            title: 'Новое сообщение',
            body: `${message.senderName}: ${message.text || '📎 Файл'}`,
            icon: message.senderAvatar || '/favicon.ico',
            badge: '/favicon.ico',
            tag: message.chatId,
            requireInteraction: false,
            data: { chatId: message.chatId }
          };

          // Если это Electron приложение, отправляем уведомление через IPC
          if (window.electronAPI && window.electronAPI.sendNotification) {
            window.electronAPI.sendNotification({
              title: notificationData.title,
              body: notificationData.body,
              icon: notificationData.icon,
              chatId: message.chatId
            });
          } else {
            // Обычное браузерное уведомление
            const notif = new Notification(notificationData.title, {
              body: notificationData.body,
              icon: notificationData.icon,
              badge: notificationData.badge,
              tag: notificationData.tag,
              requireInteraction: notificationData.requireInteraction,
              data: notificationData.data
            });

            // Обработчик клика по уведомлению
            notif.onclick = () => {
              window.focus();
              const chatId = notificationData.data.chatId;
              const chatToOpen = chats.find(c => c.id === chatId);
              
              if (chatToOpen) {
                handleSelectChat(chatToOpen);
              }
              
              notif.close();
            };
          }
          } // закрывающая скобка для if (shouldShowNotification)
        }
      } else {
        console.log('Уведомление НЕ показываем: чат активен и приложение в фокусе', { isMyMessage, isChatActive, isAppFocused });
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

              // Если чат активен - всегда сбрасываем в 0
              if (isChatActive) {
                newUnreadCount = 0;
              }
              // Если сообщение от нас (исходящее) - НЕ увеличиваем счетчик
              // Исходящие сообщения никогда не считаются непрочитанными
              else if (isMessageFromMe) {
                newUnreadCount = 0;
              }
              // Если сообщение от другого пользователя и чат не активен
              // Только входящие сообщения увеличивают счетчик непрочитанных
              else {
                newUnreadCount = (c.unreadCount || 0) + 1;
              }

              // Сохраняем локальные данные чата (participantsDetails и т.д.)
              return {
                ...c,  // Используем локальный объект чата, а не серверный
                unreadCount: newUnreadCount,
                lastMessage: {
                  text: message.text || (message.file ? '📎 Файл' : ''),
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
              text: message.text || (message.file ? '📎 Файл' : ''),
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
        return [...prev, chat];
      });
      // Переключаемся на новый чат
      setActiveChatId(chat.id);
      newSocket.emit('join_chat', chat.id);
      setMessages([]);
    });

    newSocket.on('chat_updated', ({ chatId, chat }) => {
      setChats(prev => {
        const chatExists = prev.some(c => c.id === chatId);
        
        if (chatExists) {
          // Обновляем только lastMessage и timestamp, сохраняя локальные данные
          return prev.map(c => {
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
          return [...prev, {
            ...chat,
            unreadCount: 0
          }];
        }
      });
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

    newSocket.on('user_status_changed', ({ userId, username, status, statusText }) => {
      // Обновляем список пользователей
      setUsers(prev => prev.map(u => {
        if (u.id === userId) {
          const updated = { ...u, status };
          if (statusText !== undefined) {
            updated.status_text = statusText;
          }
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
              if (statusText !== undefined) {
                updated.status_text = statusText;
              }
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
          if (statusText !== undefined) {
            updated.status_text = statusText;
          }
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
      if (chatId === activeChatId) {
        // Обновляем сообщения - помечаем прочитанные
        setMessages(prev => prev.map(msg => {
          if (msg.senderId === readBy && !msg.read_at) {
            return { ...msg, read_at: readAt };
          }
          return msg;
        }));
      }
    });

    // Обработка удаления сообщения администратором
    newSocket.on('message_deleted', ({ id: deletedMessageId }) => {
      setMessages(prev => prev.filter(msg => msg.id !== deletedMessageId));
    });

    // Обработка редактирования сообщения
    newSocket.on('message_edited', ({ messageId, newText, editedBy, editedAt }) => {
      setMessages(prev => prev.map(msg =>
        msg.id === messageId
          ? { ...msg, text: newText, edited: true, editedAt }
          : msg
      ));
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

    return () => {
      if (loginTimeoutRef.current) clearTimeout(loginTimeoutRef.current);
      newSocket.close();
    };
  }, []);

  // Скролл к последнему сообщению
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Обновляем ref при изменении currentUser
  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  // Обработчик открытия чата из уведомления (для Electron)
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.onOpenChatFromNotification) {
      window.electronAPI.onOpenChatFromNotification((chatId) => {
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
  }, [chats, socket]);

  // Отправляем общее количество непрочитанных сообщений в Electron для отображения бейджа
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.setUnreadCount) {
      // Суммируем все непрочитанные сообщения из всех чатов
      const totalUnread = chats.reduce((sum, chat) => {
        return sum + (chat.unreadCount || 0);
      }, 0);
      
      console.log('Обновление счетчика непрочитанных:', totalUnread);
      window.electronAPI.setUnreadCount(totalUnread);
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
    }
  }, [socket, activeChatId, currentUser]);

  // Запрос списка пользователей при входе
  useEffect(() => {
    if (socket && isLoggedIn) {
      socket.emit('get_users');
    }
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
        // Сохраняем учётные данные если выбрана опция "Запомнить меня"
        if (rememberMe) {
          localStorage.setItem('chat_credentials', JSON.stringify({
            email: email,
            password: password
          }));
        } else {
          localStorage.removeItem('chat_credentials');
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

    if (password.length < 6) {
      setAuthError('Пароль должен быть не менее 6 символов');
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
      } else {
        alert('Ошибка загрузки аватара');
      }
    } catch (err) {
      console.error('Ошибка загрузки аватара:', err);
      alert('Ошибка соединения с сервером');
    }
  };

  const handleSelectChat = async (chat) => {
    setActiveChatId(chat.id);
    activeChatIdRef.current = chat.id;
    
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
        } else {
          console.error('Ошибка загрузки сообщений через API');
          setMessages([]);
        }
      } catch (err) {
        console.error('Ошибка загрузки сообщений:', err);
        setMessages([]);
      }
    } else {
      // Сокет подключён, используем WebSocket
      socket.emit('join_chat', chat.id);
      socket.emit('mark_read', { chatId: chat.id });

      // Устанавливаем таймаут на случай если chat_history не придёт
      const loadTimeout = setTimeout(() => {
        if (activeChatIdRef.current === chat.id) {
          fetch(`${SOCKET_URL}/api/messages/${chat.id}?userId=${currentUser?.id}`)
            .then(res => res.ok ? res.json() : null)
            .then(data => {
              if (data && activeChatIdRef.current === chat.id) {
                setMessages(data.messages || []);
              }
            })
            .catch(err => console.error('Ошибка загрузки через API fallback:', err));
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
    const results = [];
    const userResults = [];
    
    console.log('🔍 Начало поиска:', query);
    console.log('Чатов для поиска:', chats.length);
    console.log('Пользователей для поиска:', users.length);
    
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
    
    console.log('👥 Найдено пользователей:', userResults.length);
    
    // 2. Ищем по всем чатам - загружаем сообщения для каждого чата
    for (const chat of chats) {
      try {
        // Загружаем историю сообщений для чата
        const response = await fetch(`${SOCKET_URL}/api/messages/${chat.id}?userId=${currentUser?.id}`);
        if (response.ok) {
          const data = await response.json();
          const chatMessages = data.messages || [];
          
          chatMessages.forEach(msg => {
            if (msg.text && msg.text.toLowerCase().includes(query)) {
              results.push({
                ...msg,
                chatId: chat.id,
                chatName: getChatDisplayName(chat),
                type: 'message',
                searchIndex: results.length
              });
            }
          });
        }
      } catch (err) {
        console.error('Ошибка поиска в чате:', chat.id, err);
      }
    }
    
    console.log('💬 Найдено сообщений:', results.length);
    
    // Объединяем результаты: сначала пользователи, потом сообщения
    const allResults = [...userResults, ...results];
    setSearchResults(allResults);
    setUserSearchResults(userResults);
    setCurrentSearchIndex(0);
    setIsSearching(false);
    
    if (allResults.length > 0) {
      const firstResult = allResults[0];
      
      // Если это пользователь - переходим к его чату
      if (firstResult.type === 'user') {
        console.log('👤 Переход к пользователю:', firstResult.username);
        // Ищем или создаём чат с этим пользователем
        const existingChat = chats.find(c => 
          c.type === 'direct' && 
          c.participantsDetails && 
          c.participantsDetails.some(p => p.id === firstResult.id)
        );
        
        if (existingChat) {
          handleSelectChat(existingChat);
        } else {
          // Создаём новый чат
          createDirectChat(firstResult.id);
        }
      } else {
        // Если это сообщение - переходим к чату
        console.log('💬 Переход к чату:', firstResult.chatId);
        if (firstResult.chatId !== activeChatId) {
          handleSelectChat(chats.find(c => c.id === firstResult.chatId));
        }
      }
      
      // Переходим к результату
      setTimeout(() => {
        if (firstResult.type === 'user') {
          scrollToUser(firstResult.id);
        } else {
          scrollToMessage(firstResult.id);
        }
      }, 300);
    } else {
      console.log('❌ Ничего не найдено');
    }
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

  // Проверка, есть ли контент в поле ввода (текст или эмодзи-изображения)
  const hasInputContent = () => {
    if (inputText.trim()) return true;
    // Проверяем наличие изображений (эмодзи) в contentEditable div
    if (messageInputRef.current && messageInputRef.current.querySelectorAll('img.emoji').length > 0) return true;
    return false;
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
        // Извлекаем эмодзи из alt атрибута
        text += node.alt || '';
      } else {
        text += node.textContent || '';
      }
    });
    
    return text;
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

        socket.emit('send_message', {
          chatId: activeChatId,
          text: messageText,
          file: {
            filename: fileData.filename,
            url: fileData.url,
            size: fileData.size,
            mimetype: fileData.mimetype
          }
        });
      } catch (error) {
        console.error('Ошибка загрузки файла:', error);
      } finally {
        setIsUploading(false);
        setSelectedFile(null);
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
    } else {
      socket.emit('send_message', {
        chatId: activeChatId,
        text: messageText
      });
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

      const result = codePoints.join('-');
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
      <span
        className={className}
        style={{
          fontSize: `${size}px`,
          lineHeight: '1',
          display: 'inline-block',
          verticalAlign: 'middle',
          fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", sans-serif'
        }}
      >
        {emoji}
      </span>
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

  const handleAddEmoji = (emojiObject) => {
    // EmojiPicker передаёт объект { emoji: '😀', ... }
    const emoji = typeof emojiObject === 'string' ? emojiObject : emojiObject.emoji;
    
    // Вставляем эмодзи как изображение в contentEditable div
    if (messageInputRef.current) {
      const unified = emojiToUnified(emoji);
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
      
      messageInputRef.current.appendChild(img);
      messageInputRef.current.focus();
      
      // Обновляем inputText
      setInputText(messageInputRef.current.textContent);
    } else {
      // Fallback для обычного input
      setInputText(prev => prev + emoji);
    }
    
    // Оставляем фокус на поле ввода
    setTimeout(() => messageInputRef.current?.focus(), 0);
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

  // Открытие аватара в полном размере
  const handleOpenAvatar = (avatarSrc, userName) => {
    if (avatarSrc && avatarSrc.startsWith('http')) {
      setAvatarUrl(avatarSrc);
      setShowAvatarModal(true);
    }
  };

  // Открытие контекстного меню сообщения
  const handleContextMenu = (e, messageId, messageText, chatId, senderId) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      messageId,
      messageText,
      messageChatId: chatId,
      messageSenderId: senderId
    });
  };

  // Закрытие контекстного меню
  const closeContextMenu = () => {
    setContextMenu({ ...contextMenu, visible: false });
  };

  // === ОБРАБОТКА РЕАКЦИЙ ===

  // Добавить или удалить реакцию
  const handleAddReaction = (emoji, messageId) => {
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
  };

  // Удалить реакцию текущего пользователя
  const handleRemoveReaction = (emoji, messageId) => {
    if (!socket) return;

    socket.emit('remove_reaction', {
      messageId,
      emoji
    });
  };

  // Копирование сообщения
  const handleCopyMessage = async () => {
    if (contextMenu.messageText) {
      try {
        await navigator.clipboard.writeText(contextMenu.messageText);
        // Показываем уведомление (опционально)
        console.log('Сообщение скопировано');
      } catch (err) {
        // Fallback для старых браузеров
        const textArea = document.createElement('textarea');
        textArea.value = contextMenu.messageText;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      closeContextMenu();
    }
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
      organizer: booking.organizer_name
    });
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
          endTime: meetingForm.endTime
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
          organizer: ''
        });
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
  };

  const handleNextMonth = () => {
    const newMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    setCurrentMonth(newMonth);
    setSelectedDate(null);
    setSelectedDayTasks([]);
    const startOfMonth = new Date(newMonth.getFullYear(), newMonth.getMonth(), 1);
    const endOfMonth = new Date(newMonth.getFullYear(), newMonth.getMonth() + 1, 0);
    fetchCalendarTasks(startOfMonth, endOfMonth);
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

  const toggleUserForShare = (userId) => {
    setSelectedUsersForShare(prev =>
      prev.find(id => id === userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
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

  const handleDeleteMessage = (message) => {
    setMessageToDelete(message);
    setShowDeleteConfirm(true);
    setShowChatMenu(false);
  };

  const confirmDeleteMessage = async () => {
    if (!messageToDelete) return;

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
        if (showMediaViewer) setShowMediaViewer(false);
        if (contextMenu.visible) closeContextMenu();
      }
    };

    const handleClickOutside = (e) => {
      if (contextMenu.visible && !e.target.closest('.message-context-menu')) {
        closeContextMenu();
      }
    };

    document.addEventListener('keydown', handleEscKey);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleEscKey);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showImagePreview, showChatMenu, showMediaViewer, contextMenu.visible]);

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

  // Отображение статуса доставки сообщения
  const renderMessageStatus = (message) => {
    // Показываем статус только для своих сообщений
    if (message.senderId !== currentUser?.id) return null;

    // Если есть read_at - сообщение прочитано (две галочки)
    if (message.read_at) {
      return <span className="message-status read">✓✓</span>;
    }
    // Иначе одна галочка (доставлено но не прочитано)
    return <span className="message-status">✓</span>;
  };

  // Форматирование текста бота (поддержка markdown-подобного синтаксиса)
  const formatBotText = (text) => {
    if (!text) return text;
    
    // Разбиваем на строки для обработки
    const lines = text.split('\n');
    
    return lines.map((line, lineIndex) => {
      let formattedLine = line;
      
      // Обработка заголовков (*** текст ***)
      if (formattedLine.startsWith('***') && formattedLine.endsWith('***')) {
        return <h4 key={lineIndex} style={{ margin: '10px 0 5px', color: '#667eea' }}>{formattedLine.slice(3, -3)}</h4>;
      }
      
      // Обработка жирного текста (**текст**)
      const parts = formattedLine.split(/(\*\*.*?\*\*)/g);
      const formattedParts = parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        return part;
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

  // Экран потери связи с сервером (только если пользователь был залогинен)
  if (!isLoggedIn && connectionStatus === 'disconnected' && localStorage.getItem(STORAGE_KEY)) {
    const videoSrc = window.location.protocol === 'file:'
      ? 'videos/background.mp4'
      : '/videos/background.mp4';

    return (
      <div className="login-container">
        <video
          className="login-video-bg"
          autoPlay
          loop
          muted
          playsInline
        >
          <source src={videoSrc} type="video/mp4" />
        </video>
        <div className="login-video-overlay"></div>

        <div className="login-box auth-box">
          <h1>⚠️ Связь с сервером потеряна</h1>
          <p className="disconnected-message">
            Подключение к серверу разорвано. Проверьте соединение с сетью или обратитесь к администратору.
          </p>
          <div className="disconnected-actions">
            <button 
              className="auth-btn" 
              onClick={() => {
                setConnectionStatus('reconnecting');
                window.location.reload();
              }}
            >
              🔄 Попробовать снова
            </button>
          </div>
        </div>
        <div className="login-footer">
          <span>© 2026 Created By Pantyuhov DI</span>
        </div>
      </div>
    );
  }

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
                  <img src={lastUser.avatar} alt={lastUser.username} />
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
                  onClick={async () => {
                    // Автоматически выполняем вход без показа формы
                    const savedCredentials = localStorage.getItem('chat_credentials');
                    if (savedCredentials) {
                      try {
                        const creds = JSON.parse(savedCredentials);
                        // Устанавливаем значения для handleLogin
                        setEmail(creds.email || '');
                        setPassword(creds.password || '');
                        setRememberMe(true);
                        setAuthMode('login');
                        setAuthError('');
                        setIsLoading(true);
                        
                        // Выполняем вход напрямую
                        try {
                          const response = await fetch(`${SOCKET_URL}/api/login`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ email: creds.email, password: creds.password })
                          });

                          const data = await response.json();

                          if (response.ok) {
                            // Подключаемся к сокету с данными пользователя
                            socket.emit('join', {
                              username: data.user.username,
                              userId: data.user.id
                            });
                            // Проверяем статус админа
                            checkAdminStatus(data.user.id);
                          } else {
                            setAuthError(data.error || 'Ошибка входа');
                          }
                        } catch (err) {
                          setAuthError('Ошибка соединения с сервером');
                        } finally {
                          setIsLoading(false);
                        }
                      } catch (e) {
                        console.error('Ошибка парсинга credentials:', e);
                      }
                    }
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
                    placeholder="Минимум 6 символов"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
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
                    minLength={6}
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

      {/* Боковая панель с кнопками */}
      <aside className="sidebar-buttons">
        <div className="user-info" onClick={handleOpenProfile} style={{ cursor: 'pointer' }} title={currentUser?.username}>
          <div className="user-avatar-wrapper">
            <img src={currentUser?.avatar} alt={currentUser?.username} className="user-avatar" />
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

          {/* Настройки */}
          <button
            className={`nav-sidebar-btn ${activeView === 'settings' ? 'active' : ''}`}
            onClick={handleOpenSettings}
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
                            <img src={birthday.avatar} alt={birthday.username} className="notification-avatar" />
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
                            <img src={task.from_avatar} alt={task.from_username} className="notification-avatar" />
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
                                    onChange={() => handleToggleMeetingRoomRights(user.id, user.can_book_meeting_room)}
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
                      <p style={{textAlign: 'center', color: '#999', padding: '40px'}}>Нет загруженных файлов</p>
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
      <aside className="sidebar">
        {/* Поиск по сообщениям - СКРЫТО ДО ИСПРАВЛЕНИЯ */}
        {/* 
        <div className="search-section">
          <div className="search-container">
            <input
              type="text"
              placeholder="Поиск по сообщениям..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearchMessages()}
              className="search-input"
            />
            {isSearching && (
              <div className="search-loading">
                🔍 Поиск...
              </div>
            )}
            {searchResults.length > 0 && (
              <div className="search-controls">
                <button 
                  className="search-nav-btn" 
                  onClick={handleSearchPrev}
                  title="Назад"
                >
                  ↑
                </button>
                <span className="search-count">
                  {currentSearchIndex + 1} / {searchResults.length}
                </span>
                <button 
                  className="search-nav-btn" 
                  onClick={handleSearchNext}
                  title="Вперед"
                >
                  ↓
                </button>
                <button 
                  className="search-clear-btn" 
                  onClick={handleCloseSearch}
                  title="Закрыть поиск"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
          {searchResults.length > 0 && (
            <div className="search-results-info">
              Найдено: {searchResults.length} сообщ.
            </div>
          )}
          {searchQuery.trim() && !isSearching && searchResults.length === 0 && (
            <div className="search-results-info no-results">
              Ничего не найдено
            </div>
          )}
        </div>
        */}
        
        <div className="chats-section">
          <div className="section-header">
            <span>Чаты</span>
            <button className="icon-btn small" onClick={() => setShowNewChatModal(true)} title="Новый чат">
              ✏️
            </button>
          </div>

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
                        <img
                          src={otherUser.avatar || chat.avatar || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(otherUser.username)}
                          alt={otherUser.username}
                          className="chat-avatar"
                        />
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
                                // Проверяем, является ли символ emoji
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
                    <img src={user.avatar} alt={user.username} className="user-avatar-small" />
                    <span className={`status-indicator ${user.status}`}></span>
                    {user.status_text && (
                      <span className="user-status-badge">
                        {(() => {
                          const statusText = user.status_text;
                          const firstChar = statusText.charAt(0);
                          const isEmoji = /[\p{Emoji}]/u.test(firstChar);
                          // Если начинается со смайла, показываем только смайл
                          if (isEmoji) {
                            return renderEmoji(firstChar);
                          }
                          // Иначе показываем весь текст
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
      )}

      {/* Основная область чата */}
      {activeView === 'chats' && (
      <main className={`chat-main ${showEmojiPicker && windowWidth <= 1600 ? 'emoji-panel-open' : ''}`}>
        {activeChat ? (
          <>
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
                            // Проверяем, начинается ли статус со смайла
                            const firstChar = statusText.charAt(0);
                            const isEmoji = /[\p{Emoji}]/u.test(firstChar);

                            if (isEmoji) {
                              // Показываем только текст без смайла (смайл уже есть в статусе)
                              const textOnly = statusText.substring(1).trim();
                              return (
                                <span className="user-status-text with-text">
                                  {textOnly || firstChar}
                                </span>
                              );
                            } else {
                              // Просто текст без смайла
                              return (
                                <span className="user-status-text with-text">
                                  {statusText}
                                </span>
                              );
                            }
                          } else {
                            // Показываем онлайн/офлайн
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
                onClick={handleOpenChatMenu}
                title="Меню чата"
              >
                ⋮
              </button>
            </header>

            <div className="messages-container-main" key={activeChatId || 'no-chat'}>
              {messages.map((message, index) => {
                // Определяем, является ли сообщение частью группы (предыдущее от того же пользователя)
                const prevMessage = index > 0 ? messages[index - 1] : null;
                const isGrouped = prevMessage && prevMessage.senderId === message.senderId;

                return (
                <div
                  id={`message-${message.id}`}
                  key={message.id}
                  className={`message-main ${message.senderId === currentUser?.id ? 'own' : ''} ${isBotMessage(message) ? 'message-bot' : ''} ${isGrouped ? 'message-grouped' : ''}`}
                  onContextMenu={(e) => handleContextMenu(e, message.id, message.text, message.chatId, message.senderId)}
                >
                  {!isGrouped && (
                    <img
                      src={message.senderAvatar}
                      alt={message.senderName}
                      className="message-avatar"
                    />
                  )}
                  {isGrouped && <div className="message-avatar-spacer" />}
                  <div className="message-content">
                    <div className="message-bubble-wrapper">
                      {!isBotMessage(message) && message.forwarded_from && (
                        <span className="forwarded-badge">
                          ↗️ Переслано от {message.forwarded_from.sender_name}
                        </span>
                      )}
                      {message.text && (
                        <div className="message-text-wrapper">
                          <div className="message-text-content">
                            <p className="message-text-main" onContextMenu={(e) => handleContextMenu(e, message.id, message.text, message.chatId, message.senderId)}>
                              {isBotMessage(message) ? formatBotText(message.text) : wrapEmojisInText(message.text)}
                            </p>
                            <div className="message-time-inline">
                              <span className="message-time-main">{formatTime(message.timestamp)}</span>
                              {message.edited && <span className="message-edited-indicator" title="Отредактировано">ред.</span>}
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
                                    <span className="reaction-emoji-inline">{renderEmoji(emoji, '', 13)}</span>
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
                        ) : (
                          <a href={message.file.url} className="file-link-main" target="_blank" rel="noopener noreferrer">
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
              );
            })}
              <div ref={messagesEndRef} />
            </div>

            <form className={`message-form-main ${showEmojiPicker && windowWidth <= 1600 ? 'emoji-panel-open' : ''}`} onSubmit={handleSendMessage}>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                style={{ display: 'none' }}
                id="file-input-main"
              />
              <label htmlFor="file-input-main" className="file-btn-main" title="Прикрепить файл">
                📎
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
                className="message-input-contenteditable"
                contentEditable
                suppressContentEditableWarning
                data-placeholder="Введите сообщение..."
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
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage(e);
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
                    setShowEmojiPicker(!showEmojiPicker);
                  }}
                  title="Смайлы"
                >
                  😀
                </button>
                <button type="submit" disabled={isUploading || (!hasInputContent() && !selectedFile)}>
                  {isUploading ? '⏳' : '➤'}
                </button>
              </div>
            </form>

            {/* Боковая панель со смайлами */}
            <div className={`emoji-sidebar ${showEmojiPicker ? 'open' : ''}`} ref={emojiPickerRef}>
              <div className="emoji-sidebar-header">
                <span className="emoji-sidebar-title">Выберите смайл</span>
                <button 
                  className="emoji-sidebar-close"
                  onClick={() => setShowEmojiPicker(false)}
                >
                  ✕
                </button>
              </div>
              <div className="emoji-sidebar-content">
                <EmojiPicker
                  onEmojiClick={handleAddEmoji}
                  theme="dark"
                  emojiStyle="apple"
                  searchDisabled={false}
                  skinTonesDisabled={false}
                  reactionsDefaultOpen={false}
                  width={350}
                  height={window.innerHeight - 100}
                />
              </div>
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
                          <img src={otherUser.avatar || activeChat.avatar || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(otherUser.username)} alt={otherUser.username} className="menu-avatar" />
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
                <div className="chat-menu-divider"></div>
                <div className="chat-menu-item" onClick={() => handleDeleteMessage({ id: 'last' })}>
                  <span className="menu-icon"><span className="emoji-animated">🗑️</span></span>
                  <span>Удалить сообщение</span>
                </div>
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
          </>
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
                      <img src={user.avatar} alt={user.username} className="phonebook-card-avatar" />
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
                onClick={() => setCalendarView('meeting-room')}
              >
                🏢 Бронирование переговорной
              </button>
            </div>
          </div>
          <div className="full-page-content calendar-full-page">
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
                        const isToday = new Date().toDateString() === date.toDateString();
                        const isSelected = selectedDate && selectedDate.toDateString() === date.toDateString();

                    const dayBirthdays = users.filter(user => {
                      if (!user.birth_date) return false;
                      const birthDate = new Date(user.birth_date);
                      return birthDate.getDate() === day && (birthDate.getMonth() + 1) === (month + 1);
                    });

                    days.push(
                      <div
                        key={day}
                        className={`calendar-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}`}
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
                            onClick={() => handleEditTask(task)}
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
                                  handleShareTask(task);
                                }}
                                title="Поделиться"
                              >
                                📤
                              </button>
                              <button
                                className="task-edit-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditTask(task);
                                }}
                                title="Редактировать"
                              >
                                ✏️
                              </button>
                              <button
                                className="task-delete-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteTask(task.id);
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
                  <button className="add-task-btn" onClick={() => setShowMeetingModal(true)}>
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
                              onClick={() => handleEditBooking(booking)}
                              title="Редактировать"
                            >
                              ✏️
                            </button>
                            <button
                              className="booking-action-btn delete"
                              onClick={() => handleDeleteBooking(booking.id)}
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

      {/* Вкладка настроек */}
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
                className={`settings-tab ${activeSettingsTab === 'about' ? 'active' : ''}`}
                onClick={() => setActiveSettingsTab('about')}
              >
                ℹ️ О приложении
              </button>
            </div>

            <div className="settings-content">
              {activeSettingsTab === 'appearance' && (
                <div className="settings-tab-content">
                  <div className="settings-section">
                    <h3>Режим отображения</h3>
                    <p className="settings-description">Компактный режим для экономии места</p>

                    <label className="toggle-switch settings-toggle">
                      <input
                        type="checkbox"
                        checked={userUiSettings.compactMode}
                        onChange={(e) => setUserUiSettings({...userUiSettings, compactMode: e.target.checked})}
                      />
                      <span className="slider"></span>
                      <span className="toggle-label">{userUiSettings.compactMode ? 'Включен' : 'Выключен'}</span>
                    </label>
                  </div>

                  <div className="settings-section">
                    <h3>Размер текста в сообщениях</h3>
                    <p className="settings-description">Настройте размер текста для удобства чтения</p>

                    <div className="font-size-control">
                      <input
                        type="range"
                        min="12"
                        max="24"
                        step="1"
                        value={userUiSettings.messageFontSize}
                        onChange={(e) => setUserUiSettings({...userUiSettings, messageFontSize: e.target.value})}
                        className="font-size-slider"
                      />
                      <div className="font-size-display">
                        <span className="font-size-value">{userUiSettings.messageFontSize}px</span>
                        <span className="font-size-preview" style={{ fontSize: `${userUiSettings.messageFontSize}px` }}>
                          Пример текста
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="settings-section">
                    <h3>Размер эмодзи в сообщениях</h3>
                    <p className="settings-description">Настройте размер эмодзи независимо от текста</p>

                    <div className="emoji-size-control">
                      <input
                        type="range"
                        min="16"
                        max="48"
                        step="1"
                        value={userUiSettings.messageEmojiSize}
                        onChange={(e) => setUserUiSettings({...userUiSettings, messageEmojiSize: e.target.value})}
                        className="emoji-size-slider"
                      />
                      <div className="emoji-size-display">
                        <span className="emoji-size-value">{userUiSettings.messageEmojiSize}px</span>
                        <span className="emoji-size-preview" style={{ fontSize: `${userUiSettings.messageEmojiSize}px` }}>
                          😀 😊 🎉
                        </span>
                      </div>
                    </div>
                  </div>

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
                      
                      {updateStatus === null && (
                        <button 
                          className="btn-check-update"
                          onClick={() => {
                            setUpdateStatus('checking');
                            window.electronAPI?.checkForUpdates?.();
                          }}
                        >
                          🔍 Проверить обновления
                        </button>
                      )}

                      {updateStatus === 'checking' && (
                        <div className="update-status">
                          <div className="update-spinner"></div>
                          <span>Проверка обновлений...</span>
                        </div>
                      )}

                      {updateStatus === 'available' && (
                        <div className="update-available">
                          <p className="update-message">📥 Доступна новая версия приложения!</p>
                          <button 
                            className="btn-download-update"
                            onClick={() => {
                              setUpdateStatus('downloading');
                              window.electronAPI?.startUpdate?.();
                            }}
                          >
                            ⬇️ Скачать обновление
                          </button>
                        </div>
                      )}

                      {updateStatus === 'downloading' && (
                        <div className="update-downloading">
                          <p>⬇️ Загрузка обновления...</p>
                          <div className="update-progress-bar">
                            <div 
                              className="update-progress-fill" 
                              style={{ width: `${updateProgress}%` }}
                            ></div>
                          </div>
                          <span className="update-progress-text">{Math.round(updateProgress)}%</span>
                        </div>
                      )}

                      {updateStatus === 'ready' && (
                        <div className="update-ready">
                          <p className="update-ready-message">✅ Обновление загружено!</p>
                          <p className="update-ready-desc">Перезапустите приложение для установки обновления</p>
                          <button 
                            className="btn-install-update"
                            onClick={() => {
                              window.electronAPI?.quitAndInstall?.();
                            }}
                          >
                            🔄 Перезапустить и установить
                          </button>
                        </div>
                      )}

                      {updateStatus === 'no-update' && (
                        <div className="update-no-update">
                          <p>✅ У вас установлена последняя версия</p>
                          <button 
                            className="btn-check-update-secondary"
                            onClick={() => {
                              setUpdateStatus('checking');
                              window.electronAPI?.checkForUpdates?.();
                            }}
                          >
                            🔍 Проверить снова
                          </button>
                        </div>
                      )}
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

              <div className="chat-type-hint">
                {selectedUsers.length === 0 && <span>Выберите пользователя для создания чата</span>}
                {selectedUsers.length === 1 && <span>Создаётся личный чат</span>}
                {selectedUsers.length > 1 && <span>Создаётся групповой чат ({selectedUsers.length} участников)</span>}
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
                            <img src={user.avatar} alt={user.username} className="user-avatar-small" />
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
                  <img src={profileData.avatar || currentUser?.avatar} alt="Аватар" className="profile-avatar-preview" />
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
            <img src={avatarUrl} alt="Avatar full size" className="avatar-viewer-image" />
          </div>
        </div>
      )}

      {/* Модальное окно создания/редактирования задачи */}
      {showTaskModal && (
        <div className="modal-overlay" onClick={() => setShowTaskModal(false)}>
          <div className="modal-content task-modal" onClick={e => e.stopPropagation()}>
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
        <div className="modal-overlay" onClick={() => setShowMeetingModal(false)}>
          <div className="modal-content task-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🏢 Забронировать переговорную</h3>
              <button onClick={() => setShowMeetingModal(false)}>✕</button>
            </div>

            <form onSubmit={async (e) => {
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
                    endTime: meetingForm.endTime
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
                    organizer: ''
                  });
                  
                  setShowMeetingModal(false);
                  alert('Переговорная успешно забронирована!');
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

            <form onSubmit={handleUpdateBooking}>
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
                        <a href={file.file.url} download className="media-download">
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
                      <a href={doc.url} className="document-download-btn" title="Открыть в новой вкладке" target="_blank" rel="noopener noreferrer">
                        ⬇️
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
              <a href={previewImage.url} download className="image-download-btn">
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
              <div className="status-picker-full">
                <button
                  className={`status-btn-full ${!statusEmoji && !statusDescription ? 'active' : ''}`}
                  onClick={async () => {
                    setStatusEmoji('');
                    setStatusDescription('');
                    const newStatus = '';
                    setProfileData(prev => ({ ...prev, statusText: newStatus }));
                    setCurrentUser(prev => ({ ...prev, status_text: newStatus }));

                    // Сохраняем на сервере
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
                  Без статуса
                </button>
                
                <div className="status-divider-full">
                  <span>и описание статуса</span>
                </div>

                <div className="status-input-wrapper">
                  <input
                    type="text"
                    className="status-input-full"
                    placeholder="Введите описание статуса..."
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

                      // Сохраняем на сервере
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
                    onClick={() => setShowStatusEmojiPicker(!showStatusEmojiPicker)}
                    title="Выбрать emoji"
                  >
                    {statusEmoji ? renderEmoji(statusEmoji, '', 20) : '😀'}
                  </button>

                  {showStatusEmojiPicker && (
                    <div className="status-emoji-picker-popup-inline">
                      <div className="status-emoji-grid">
                        {SAFE_EMOJIS.filter(Boolean).map(emoji => (
                          <button
                            key={emoji}
                            className="status-emoji-option"
                            onClick={() => {
                              setStatusEmoji(emoji);
                              const newStatus = emoji + (statusDescription ? ' ' + statusDescription : '');
                              setProfileData(prev => ({
                                ...prev,
                                statusText: newStatus
                              }));
                              setCurrentUser(prev => {
                                const updated = { ...prev, status_text: newStatus };
                                return updated;
                              });
                              setShowStatusEmojiPicker(false);
                              
                              fetch(`${SOCKET_URL}/api/profile`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  userId: currentUserRef.current?.id,
                                  statusText: newStatus
                                })
                              }).catch(err => console.error('Ошибка сохранения статуса:', err));
                            }}
                          >
                            {renderEmoji(emoji, '', 24)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
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
          <div className="context-menu-reactions">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                className="context-menu-reaction-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleAddReaction(emoji, contextMenu.messageId);
                }}
              >
                {renderEmoji(emoji)}
              </button>
            ))}
          </div>
          <div className="context-menu-divider"></div>
          <div className="context-menu-items">
            <button className="context-menu-item" onClick={(e) => { e.stopPropagation(); handleCopyMessage(); }}>
              📋 Копировать
            </button>
            {/* Редактировать: только свои сообщения */}
            {contextMenu.messageSenderId === currentUser?.id && (
              <button className="context-menu-item" onClick={(e) => { e.stopPropagation(); handleEditMessage(); }}>
                ✏️ Редактировать
              </button>
            )}
            <button className="context-menu-item" onClick={(e) => { e.stopPropagation(); handleForwardMessage({ id: contextMenu.messageId, text: contextMenu.messageText }); }}>
              ➤ Переслать
            </button>
            {/* Удаление: все могут удалять свои сообщения, в общем чате только админы */}
            {contextMenu.messageChatId !== 'general' || currentUser?.is_admin === 1 ? (
              <button
                className="context-menu-item context-menu-item-danger"
                onClick={(e) => {
                  e.stopPropagation();
                  closeContextMenu();
                  handleDeleteMessage({ id: contextMenu.messageId });
                }}
              >
                🗑️ Удалить
              </button>
            ) : null}
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
                  {contextMenu.messageText?.substring(0, 200)}
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
                        />
                        <div className="user-info">
                          <span className="username">{user.username}</span>
                          {user.status_text && (
                            <span className="user-status">{user.status_text}</span>
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
    </div>
  );
}

export default App;
