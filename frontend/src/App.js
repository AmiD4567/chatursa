import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import EmojiPicker from 'emoji-picker-react';

const SOCKET_URL = 'http://localhost:3001';
const STORAGE_KEY = 'chat_user_data';

function App() {
  const [socket, setSocket] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [appVersion, setAppVersion] = useState('1.0.8');
  const [updateStatus, setUpdateStatus] = useState(null); // null, 'checking', 'available', 'downloading', 'ready'
  const [updateProgress, setUpdateProgress] = useState(0);
  
  // Формы авторизации
  const [authMode, setAuthMode] = useState('login'); // 'login' или 'register'
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    messageChatId: null
  });
  
  // Модальное окно пересылки
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardSearchQuery, setForwardSearchQuery] = useState('');
  const [selectedForwardUser, setSelectedForwardUser] = useState(null);
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
    sound: true
  });
  
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
    themeMode: 'dark', // 'dark' или 'light'
    fontSize: 'medium', // 'small', 'medium', 'large'
    compactMode: false
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

  // Вычисляем активный чат по ID
  const activeChat = chats.find(c => c.id === activeChatId) || null;

  // Получаем правильное имя для чата (для личных чатов - имя собеседника)
  const getChatDisplayName = (chat) => {
    if (!chat) return '';
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
          window.electronAPI.onUpdateAvailable((event, info) => {
            setUpdateStatus('available');
            console.log('Доступно обновление:', info);
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
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });
    setSocket(newSocket);

    console.log('Сокет создан:', newSocket);
    console.log('Сокет подключён:', newSocket.connected);
    console.log('SOCKET_URL:', SOCKET_URL);

    newSocket.on('connect', () => {
      console.log('✓ Сокет подключён!');
    });

    newSocket.on('connect_error', (err) => {
      console.error('Ошибка подключения:', err.message);
    });

    // Проверяем сохраненные данные пользователя
    const savedData = localStorage.getItem(STORAGE_KEY);

    console.log('Сохранённые данные:', savedData);

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
      // Загружаем полный профиль пользователя со статусом
      try {
        const response = await fetch(`${SOCKET_URL}/api/profile/${user.userId}`);
        if (response.ok) {
          const data = await response.json();
          const statusText = data.user.status_text || '';
          const fullUser = {
            ...user,
            status_text: statusText
          };
          setCurrentUser(fullUser);
        } else {
          setCurrentUser(user);
        }
      } catch (err) {
        console.error('Ошибка загрузки профиля:', err);
        setCurrentUser(user);
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
        email: user.email
      }));

      // Проверяем статус админа
      checkAdminStatus(user.userId);

      // Проверяем право на бронирование переговорной
      // По умолчанию у Root есть это право
      const savedUserData = localStorage.getItem(STORAGE_KEY);
      if (savedUserData) {
        const userData = JSON.parse(savedUserData);
        // Root имеет право по умолчанию, в дальнейшем будет проверяться через API
        const hasRight = userData.username === 'Root' || userData.is_admin === 1;
        setCanBookMeetingRoom(hasRight);
      }

      if (userChats.length > 0) {
        const firstChat = userChats[0];
        setActiveChatId(firstChat.id);
        activeChatIdRef.current = firstChat.id;
        newSocket.emit('join_chat', firstChat.id);
      }
    });

    newSocket.on('chat_history', ({ chatId, messages: chatMessages }) => {
      // Всегда устанавливаем сообщения для чата, к которому они относятся
      // Но только если это активный чат
      if (activeChatIdRef.current === chatId) {
        setMessages(chatMessages);
      }
    });

    newSocket.on('new_message', ({ message, chat, isOwnMessage }) => {
      // Используем currentUserRef.current для актуального значения
      const myId = currentUserRef.current?.id;
      const isMyMessage = isOwnMessage || message.senderId === myId;

      console.log('Получено new_message:', {
        messageId: message.id,
        senderId: message.senderId,
        senderName: message.senderName,
        senderAvatar: message.senderAvatar,
        myId,
        isOwnMessage,
        isMyMessage,
        text: message.text,
        chatId: message.chatId,
        activeChatId: activeChatId,
        activeChatIdRef: activeChatIdRef.current
      });

      // Определяем, активен ли чат
      const isChatActive = message.chatId === activeChatId;

      console.log('Проверка активности чата:', {
        messageChatId: message.chatId,
        activeChatId: activeChatId,
        activeChatIdRef: activeChatIdRef.current,
        match: message.chatId === activeChatId,
        matchRef: message.chatId === activeChatIdRef.current
      });

      // Показываем уведомление только если сообщение не от нас и чат не активен
      if (!isMyMessage && !isChatActive && notificationPermissionRef.current === 'granted') {
        console.log('Показываем уведомление');
        // Проверяем настройки уведомлений
        if (notificationSettings.newMessages) {
          // Звук уведомления
          if (notificationSettings.sound) {
            try {
              const audio = new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU');
              audio.play().catch(() => {});
            } catch (e) {}
          }

          // Push уведомление
          new Notification('Новое сообщение', {
            body: `${message.senderName}: ${message.text || '📎 Файл'}`,
            icon: message.senderAvatar || '/favicon.ico',
            badge: '/favicon.ico',
            tag: message.chatId,
            requireInteraction: false
          });
        }
      } else {
        console.log('Уведомление НЕ показываем:', { isMyMessage, isChatActive });
      }

      setChats(prev => {
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
      });

      // Добавляем сообщение в список, если чат активен
      // Используем оба значения для надёжности
      if (message.chatId === activeChatId || message.chatId === activeChatIdRef.current) {
        console.log('Добавляем сообщение в список messages');
        setMessages(prev => [...prev, message]);
      } else {
        console.log('НЕ добавляем сообщение: чат не активен');
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
      setChats(prev => prev.map(c => {
        if (c.id === chatId) {
          // Сохраняем локальный unreadCount, игнорируем серверный
          return {
            ...chat,
            unreadCount: c.unreadCount
          };
        }
        return c;
      }));
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
              ? { ...u, full_name, work_phone, mobile_phone, status_text: status_text || '' }
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
            avatar: '',
            status: 'offline'
          }];
        }
      });

      // Обновляем participantsDetails в чатах
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

    newSocket.on('user_status_changed', ({ userId, username, status }) => {
      setUsers(prev => prev.map(u =>
        u.username === username ? { ...u, status } : u
      ));
    });

    newSocket.on('user_typing', () => {
      // Можно добавить индикатор набора текста
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

    return () => newSocket.close();
  }, []);

  // Скролл к последнему сообщению
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Обновляем ref при изменении currentUser
  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

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

    try {
      const response = await fetch(`${SOCKET_URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password })
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
    // Загружаем настройки пользователя из localStorage
    const savedSettings = localStorage.getItem(`userUiSettings_${currentUser?.id}`);
    const savedNotificationSettings = localStorage.getItem('notificationSettings');
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        setUserUiSettings(parsed);
        // Применяем тему
        document.documentElement.setAttribute('data-theme', parsed.themeMode || 'dark');
      } catch (e) {
        console.error('Ошибка загрузки настроек:', e);
      }
    }
    if (savedNotificationSettings) {
      try {
        setNotificationSettings(JSON.parse(savedNotificationSettings));
      } catch (e) {
        console.error('Ошибка загрузки настроек уведомлений:', e);
      }
    }
  };

  const handleSaveUserUiSettings = () => {
    // Сохраняем настройки в localStorage для текущего пользователя
    if (currentUser?.id) {
      localStorage.setItem(`userUiSettings_${currentUser.id}`, JSON.stringify(userUiSettings));
    }
    // Применяем тему
    document.documentElement.setAttribute('data-theme', userUiSettings.themeMode);
    alert('Настройки оформления сохранены!');
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
          about: data.user.about || '', // Должность
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

  const handleSelectChat = (chat) => {
    setActiveChatId(chat.id);
    activeChatIdRef.current = chat.id;
    socket.emit('join_chat', chat.id);
    setMessages([]);
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

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!socket || (!inputText.trim() && !selectedFile) || !activeChatId) return;

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
          text: inputText,
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
        text: inputText
      });
      setInputText('');
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

  const handleAddEmoji = (emojiObject) => {
    // EmojiPicker передаёт объект { emoji: '😀', ... }
    const emoji = typeof emojiObject === 'string' ? emojiObject : emojiObject.emoji;
    setInputText(prev => prev + emoji);
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

  // Открытие аватара в полном размере
  const handleOpenAvatar = (avatarSrc, userName) => {
    if (avatarSrc && avatarSrc.startsWith('http')) {
      setAvatarUrl(avatarSrc);
      setShowAvatarModal(true);
    }
  };

  // Открытие контекстного меню сообщения
  const handleContextMenu = (e, messageId, messageText, chatId) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      messageId,
      messageText,
      messageChatId: chatId
    });
  };

  // Закрытие контекстного меню
  const closeContextMenu = () => {
    setContextMenu({ ...contextMenu, visible: false });
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

  // Пересылка сообщения из контекстного меню
  const handleForwardMessageFromContext = () => {
    if (!contextMenu.messageId) {
      alert('Ошибка: нет сообщения для пересылки');
      return;
    }
    
    if (!socket || !socket.connected) {
      alert('Ошибка: нет соединения с сервером. Обновите страницу.');
      return;
    }
    
    if (!currentUser) {
      alert('Ошибка: вы не авторизованы. Обновите страницу.');
      return;
    }

    setShowForwardModal(true);
    setForwardSearchQuery('');
    setSelectedForwardUser(null);
  };
  
  // Отправка пересланного сообщения
  const handleSendForwardedMessage = () => {
    if (!selectedForwardUser || !contextMenu.messageId) {
      console.error('Нет получателя или messageId:', { selectedForwardUser, contextMessageId: contextMenu.messageId });
      alert('Ошибка: нет данных для пересылки');
      return;
    }

    if (!socket) {
      console.error('Сокет не подключён!');
      alert('Ошибка: сокет не подключён');
      return;
    }

    if (!socket.connected) {
      console.error('Сокет не подключён (connected=false)!');
      alert('Ошибка: нет соединения с сервером');
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
    closeContextMenu();
    
    alert('Сообщение переслано!');
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
      const response = await fetch(`${SOCKET_URL}/api/messages/${messageToDelete.id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setMessages(prev => prev.filter(m => m.id !== messageToDelete.id));
      }
    } catch (err) {
      console.error('Ошибка удаления сообщения:', err);
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
      if (showChatMenu) {
        setShowChatMenu(false);
      }
      if (showMessageMenu) {
        setShowMessageMenu(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
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

  // Закрытие по ESC
  useEffect(() => {
    const handleEscKey = (e) => {
      if (e.key === 'Escape') {
        if (showImagePreview) handleCloseImagePreview();
        if (showChatMenu) setShowChatMenu(false);
        if (showMediaViewer) setShowMediaViewer(false);
        if (contextMenu.visible) closeContextMenu();
      }
    };

    document.addEventListener('keydown', handleEscKey);
    return () => document.removeEventListener('keydown', handleEscKey);
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
  if (!isLoggedIn) {
    return (
      <div className="login-container">
        <div className="login-box auth-box">
          <h1>💬 Чат</h1>
          
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
            <form onSubmit={handleLogin} className="auth-form">
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
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
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
                <label>Имя пользователя</label>
                <input
                  type="text"
                  placeholder="Ваше имя"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  maxLength={20}
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
                <input
                  type="password"
                  placeholder="Минимум 6 символов"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>

              {authError && <div className="auth-error">{authError}</div>}

              <button type="submit" disabled={isLoading} className="auth-btn">
                {isLoading ? 'Регистрация...' : 'Зарегистрироваться'}
              </button>
            </form>
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
        <div className="user-info" onClick={handleOpenProfile} style={{ cursor: 'pointer' }}>
          <div className="user-avatar-wrapper">
            <img src={currentUser?.avatar} alt={currentUser?.username} className="user-avatar" />
          </div>
          <span className="user-name-sidebar">{currentUser?.username}</span>
        </div>
        <div className="buttons-column">
          <button
            className="icon-btn with-text"
            onClick={() => setShowStatusPicker(true)}
            title="Изменить статус"
          >
            <span className="emoji-animated">
              {(() => {
                if (!currentUser?.status_text) return '😊';
                const statusText = currentUser.status_text;
                // Используем Array.from() для корректной работы с эмодзи
                const firstChar = Array.from(statusText)[0] || '';
                const isEmoji = /[\p{Emoji}]/u.test(firstChar);
                return isEmoji ? firstChar : '😊';
              })()}
            </span>
            <span className="button-label">Статус</span>
          </button>
          <button
            className="icon-btn with-text"
            onClick={async () => {
              await getUpcomingNotifications(true);
              setShowNotifications(true);
              setUnreadNotificationsCount(0);
            }}
            title="Уведомления"
          >
            <span className="emoji-animated">🔔</span>
            <span className="button-label">Уведомления</span>
            {unreadNotificationsCount > 0 && (
              <span className="notification-badge">{unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}</span>
            )}
          </button>
          <button
            className="icon-btn with-text"
            onClick={handleOpenChats}
            title="Чаты"
          >
            <span className="emoji-animated">💬</span>
            <span className="button-label">Чаты</span>
          </button>
          <button
            className="icon-btn with-text"
            onClick={handleOpenPhonebook}
            title="Телефонная книга"
          >
            <span className="emoji-animated">📖</span>
            <span className="button-label">Телефоны</span>
          </button>
          <button
            className="icon-btn with-text"
            onClick={handleOpenCalendar}
            title="Календарь"
          >
            <span className="emoji-animated">📅</span>
            <span className="button-label">Календарь</span>
          </button>
          <button
            className="icon-btn with-text"
            onClick={handleOpenSettings}
            title="Настройки"
          >
            <span className="emoji-animated">🛠️</span>
            <span className="button-label">Настройки</span>
          </button>
          {isAdmin && (
            <button
              className="icon-btn with-text"
              onClick={() => setActiveView('admin')}
              title="Панель администратора"
            >
              <span className="emoji-animated">⚙️</span>
              <span className="button-label">Админ</span>
            </button>
          )}
          <button
            className="icon-btn with-text logout-btn"
            onClick={handleLogout}
            title="Выйти"
          >
            <span className="emoji-animated">🚪</span>
            <span className="button-label">Выйти</span>
          </button>
        </div>
        <div className="footer">
          <span>© 2026 Created By Pantyuhov DI</span>
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
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Имя</th>
                          <th>Email</th>
                          <th>Статус</th>
                          <th>Роль</th>
                          <th>Бронирование</th>
                          <th>Действия</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adminUsers.map(user => (
                          <tr key={user.id}>
                            <td>
                              <div className="user-cell">
                                <img src={user.avatar || `https://ui-avatars.com/api/?name=${user.username}`} alt={user.username} className="user-avatar-small" />
                                <span>{user.username}</span>
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
                        ))}
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
                <label>Имя пользователя *</label>
                <input
                  type="text"
                  value={newUserData.username}
                  onChange={(e) => setNewUserData({...newUserData, username: e.target.value})}
                  placeholder="Введите имя пользователя"
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
                  className={`chat-item ${activeChat?.id === chat.id ? 'active' : ''}`}
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
                          src={otherUser.avatar}
                          alt={otherUser.username}
                          className="chat-avatar"
                        />
                      ) : (
                        <div className="chat-icon">{getChatIcon(chat)}</div>
                      );
                    })()
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
                              {displayStatus}
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
                            return firstChar;
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
                        src={otherUser.avatar}
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
                ) : (
                  <span className="chat-icon-large">{getChatIcon(activeChat)}</span>
                )}
                <div>
                  <h2>{getChatDisplayName(activeChat)}</h2>
                  <span className="chat-status">
                    {activeChat.type === 'direct' && activeChat.participantsDetails ? (
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
                    ) : (
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

            <div className="messages-container-main">
              {messages.map((message) => (
                <div
                  id={`message-${message.id}`}
                  key={message.id}
                  className={`message-main ${message.senderId === currentUser?.id ? 'own' : ''}`}
                  onContextMenu={(e) => handleContextMenu(e, message.id, message.text, message.chatId)}
                >
                  <img
                    src={message.senderAvatar}
                    alt={message.senderName}
                    className="message-avatar"
                  />
                  <div className="message-content">
                    <div className="message-header-main">
                      <span className="message-sender">{message.senderName}</span>
                      <div className="message-header-actions">
                        <div className="message-time-status">
                          <span className="message-time-main">{formatTime(message.timestamp)}</span>
                          {renderMessageStatus(message)}
                        </div>
                        <button
                          className="message-menu-btn"
                          onClick={(e) => handleMessageMenuClick(e, message)}
                        >
                          ⋮
                        </button>
                      </div>
                    </div>
                    {message.text && <p className="message-text-main" onContextMenu={(e) => handleContextMenu(e, message.id, message.text, message.chatId)}>{message.text}</p>}
                    {message.forwarded_from && (
                      <div className="forwarded-indicator">
                        <span className="forwarded-icon">↗️</span>
                        <span className="forwarded-text">
                          Переслано от {message.forwarded_from.sender_name}
                        </span>
                      </div>
                    )}
                    {message.file && (
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
              ))}
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
              <input
                ref={messageInputRef}
                type="text"
                placeholder="Введите сообщение..."
                value={inputText}
                onChange={handleTyping}
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
                <button type="submit" disabled={isUploading || (!inputText.trim() && !selectedFile)}>
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
                  emojiStyle="native"
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
                          <img src={otherUser.avatar} alt={otherUser.username} className="menu-avatar" />
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
                style={{ top: messageMenuPosition.top, left: messageMenuPosition.left }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="message-menu-item" onClick={() => handleForwardMessage(selectedMessage)}>
                  <span className="menu-icon">↗️</span>
                  <span>Переслать</span>
                </div>
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

            {/* Отображение для режима задач */}
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
                        <h6 className="birthdays-title" style={{ marginTop: '16px' }}>📋 Задачи:</h6>
                        {selectedDayTasks.map(task => (
                          <div
                            key={task.id}
                            className="calendar-task-item"
                            style={{ borderLeftColor: task.color }}
                            onClick={() => handleEditTask(task)}
                          >
                            <div className="calendar-task-datetime">
                              {task.task_time && (
                                <div className="calendar-task-time">🕐 {task.task_time}</div>
                              )}
                            </div>
                            <div className="calendar-task-content">
                              <div className="calendar-task-title-row">
                                <div className="calendar-task-title">{task.title}</div>
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
                              </div>
                              {task.description && (
                                <div className="calendar-task-description">{task.description}</div>
                              )}
                            </div>
                            <div className="calendar-task-actions">
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
                {selectedDate && canBookMeetingRoom && (
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
                        {(canBookMeetingRoom || currentUser?.username === 'Root') && (
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
                    <h3>Режим оформления</h3>
                    <p className="settings-description">Выберите тёмную или светлую тему</p>

                    <div className="theme-mode-toggle">
                      <button
                        className={`theme-mode-btn ${userUiSettings.themeMode === 'dark' ? 'active' : ''}`}
                        onClick={() => {
                          setUserUiSettings({...userUiSettings, themeMode: 'dark'});
                          document.documentElement.setAttribute('data-theme', 'dark');
                        }}
                      >
                        🌙 Тёмная
                      </button>
                      <button
                        className={`theme-mode-btn ${userUiSettings.themeMode === 'light' ? 'active' : ''}`}
                        onClick={() => {
                          setUserUiSettings({...userUiSettings, themeMode: 'light'});
                          document.documentElement.setAttribute('data-theme', 'light');
                        }}
                      >
                        ☀️ Светлая
                      </button>
                    </div>
                  </div>

                  <div className="settings-section">
                    <h3>Цветовая схема</h3>
                    <p className="settings-description">Выберите основной цвет оформления интерфейса</p>

                    <div className="color-presets">
                      <button
                        className={`color-preset ${userUiSettings.themeColor === '#667eea' ? 'active' : ''}`}
                        style={{ background: '#667eea' }}
                        onClick={() => setUserUiSettings({...userUiSettings, themeColor: '#667eea', themeGradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'})}
                        title="Фиолетовый"
                      />
                      <button
                        className={`color-preset ${userUiSettings.themeColor === '#3498db' ? 'active' : ''}`}
                        style={{ background: '#3498db' }}
                        onClick={() => setUserUiSettings({...userUiSettings, themeColor: '#3498db', themeGradient: 'linear-gradient(135deg, #3498db 0%, #2980b9 100%)'})}
                        title="Синий"
                      />
                      <button
                        className={`color-preset ${userUiSettings.themeColor === '#27ae60' ? 'active' : ''}`}
                        style={{ background: '#27ae60' }}
                        onClick={() => setUserUiSettings({...userUiSettings, themeColor: '#27ae60', themeGradient: 'linear-gradient(135deg, #27ae60 0%, #229954 100%)'})}
                        title="Зелёный"
                      />
                      <button
                        className={`color-preset ${userUiSettings.themeColor === '#e74c3c' ? 'active' : ''}`}
                        style={{ background: '#e74c3c' }}
                        onClick={() => setUserUiSettings({...userUiSettings, themeColor: '#e74c3c', themeGradient: 'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)'})}
                        title="Красный"
                      />
                      <button
                        className={`color-preset ${userUiSettings.themeColor === '#f39c12' ? 'active' : ''}`}
                        style={{ background: '#f39c12' }}
                        onClick={() => setUserUiSettings({...userUiSettings, themeColor: '#f39c12', themeGradient: 'linear-gradient(135deg, #f39c12 0%, #d68910 100%)'})}
                        title="Оранжевый"
                      />
                      <button
                        className={`color-preset ${userUiSettings.themeColor === '#9b59b6' ? 'active' : ''}`}
                        style={{ background: '#9b59b6' }}
                        onClick={() => setUserUiSettings({...userUiSettings, themeColor: '#9b59b6', themeGradient: 'linear-gradient(135deg, #9b59b6 0%, #8e44ad 100%)'})}
                        title="Розовый"
                      />
                      <button
                        className={`color-preset ${userUiSettings.themeColor === '#1abc9c' ? 'active' : ''}`}
                        style={{ background: '#1abc9c' }}
                        onClick={() => setUserUiSettings({...userUiSettings, themeColor: '#1abc9c', themeGradient: 'linear-gradient(135deg, #1abc9c 0%, #16a085 100%)'})}
                        title="Бирюзовый"
                      />
                      <button
                        className={`color-preset ${userUiSettings.themeColor === '#34495e' ? 'active' : ''}`}
                        style={{ background: '#34495e' }}
                        onClick={() => setUserUiSettings({...userUiSettings, themeColor: '#34495e', themeGradient: 'linear-gradient(135deg, #34495e 0%, #2c3e50 100%)'})}
                        title="Тёмный"
                      />
                    </div>

                    <div className="custom-color-picker">
                      <label>Или выберите свой цвет:</label>
                      <div className="color-picker-row">
                        <input
                          type="color"
                          value={userUiSettings.themeColor}
                          onChange={(e) => setUserUiSettings({...userUiSettings, themeColor: e.target.value, themeGradient: `linear-gradient(135deg, ${e.target.value} 0%, ${e.target.value}dd 100%)`})}
                          className="color-input"
                        />
                        <span className="color-value">{userUiSettings.themeColor}</span>
                      </div>
                    </div>
                  </div>

                  <div className="settings-section">
                    <h3>Размер шрифта</h3>
                    <p className="settings-description">Настройте размер текста интерфейса</p>
                    
                    <div className="font-size-options">
                      <button
                        className={`font-size-btn ${userUiSettings.fontSize === 'small' ? 'active' : ''}`}
                        onClick={() => setUserUiSettings({...userUiSettings, fontSize: 'small'})}
                      >
                        A<small>小</small>
                      </button>
                      <button
                        className={`font-size-btn ${userUiSettings.fontSize === 'medium' ? 'active' : ''}`}
                        onClick={() => setUserUiSettings({...userUiSettings, fontSize: 'medium'})}
                      >
                        A<medium>中</medium>
                      </button>
                      <button
                        className={`font-size-btn ${userUiSettings.fontSize === 'large' ? 'active' : ''}`}
                        onClick={() => setUserUiSettings({...userUiSettings, fontSize: 'large'})}
                      >
                        A<large>大</large>
                      </button>
                    </div>
                  </div>

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

                  <div className="settings-section preview-section">
                    <h3>Предпросмотр</h3>
                    <p className="settings-description">Так будет выглядеть интерфейс с выбранными настройками</p>
                    
                    <div className="settings-preview" style={{ background: userUiSettings.themeGradient }}>
                      <div className="preview-card">
                        <h4>Пример заголовка</h4>
                        <p>Пример текста с выбранным размером шрифта: {userUiSettings.fontSize}</p>
                        <button className="preview-btn">Кнопка</button>
                      </div>
                    </div>
                  </div>

                  <div className="settings-actions">
                    <button className="btn-secondary" onClick={handleOpenChats}>
                      Отмена
                    </button>
                    <button className="btn-primary" onClick={handleSaveUserUiSettings}>
                      Сохранить оформление
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
                      <div className="about-app-logo">💬</div>
                      <h2>Chat App</h2>
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
                      {updateStatus && (
                        <div className="about-app-item">
                          <span className="about-app-label">Обновление</span>
                          <span className="about-app-value">
                            {updateStatus === 'checking' && '🔄 Проверка...'}
                            {updateStatus === 'available' && '📥 Доступно обновление'}
                            {updateStatus === 'downloading' && `⬇️ Загрузка: ${Math.round(updateProgress)}%`}
                            {updateStatus === 'ready' && '✅ Готово к установке'}
                          </span>
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
                  <label>Имя пользователя</label>
                  <input
                    type="text"
                    value={profileData.username}
                    onChange={(e) => setProfileData(prev => ({ ...prev, username: e.target.value }))}
                    maxLength={20}
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
                  <label>📋 Должность</label>
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
                <img
                  src={viewUserProfileData.avatar || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(viewUserProfileData.username)}
                  alt={viewUserProfileData.username}
                  className="view-profile-avatar"
                  onClick={() => handleOpenAvatar(viewUserProfileData.avatar, viewUserProfileData.username)}
                  style={{ cursor: viewUserProfileData.avatar ? 'zoom-in' : 'default' }}
                />
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
                    <span className="detail-label">📋 Должность:</span>
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
                  <label>Время</label>
                  <input
                    type="time"
                    value={taskForm.taskTime}
                    onChange={(e) => setTaskForm(prev => ({ ...prev, taskTime: e.target.value }))}
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
                
                <div className="status-emojis-full">
                  {['😀', '😎', '🥰', '😇', '🤔', '😴', '🎉', '❤️', '🔥', '✨', '💼', '🌟'].map(emoji => (
                    <button
                      key={emoji}
                      className={`status-emoji-full ${statusEmoji === emoji ? 'active' : ''}`}
                      onClick={async () => {
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
                      <span className="emoji-animated">{emoji}</span>
                    </button>
                  ))}
                </div>
                
                <div className="status-divider-full">
                  <span>и описание статуса</span>
                </div>
                
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
          <div className="context-menu-items">
            <button className="context-menu-item" onClick={(e) => { e.stopPropagation(); handleCopyMessage(); }}>
              📋 Копировать
            </button>
            <button className="context-menu-item" onClick={(e) => { e.stopPropagation(); handleForwardMessageFromContext(); }}>
              ➤ Переслать
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
                  {contextMenu.messageText?.substring(0, 200)}
                  {contextMenu.messageText?.length > 200 ? '...' : ''}
                </p>
              </div>

              <div className="forward-search">
                <label>Поиск пользователя:</label>
                <input
                  type="text"
                  placeholder="Введите имя пользователя..."
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
                          className="user-avatar"
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
    </div>
  );
}

export default App;
