import axios from 'axios';

export const DEFAULT_BUILDING_ID = 1;

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('freeroom_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const mockTime = window.__MOCK_TIME__ || localStorage.getItem('freeroom_mock_time');
  if (mockTime) {
    config.headers['x-mock-time'] = mockTime;
    config.params = { ...(config.params || {}), now: mockTime };
  }
  return config;
});

// Handle 401 responses (expired token)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const hadToken = !!localStorage.getItem('freeroom_token');
      localStorage.removeItem('freeroom_token');
      localStorage.removeItem('freeroom_user');
      // Only redirect if attempting to access protected admin page
      if (window.location.pathname.startsWith('/admin') && window.location.pathname !== '/admin/login') {
        window.location.href = '/admin/login';
      } else if (hadToken && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('freeroom_auth_expired'));
      }
    }
    return Promise.reject(error);
  }
);

export const getDeviceSettings = () => {
  const batchStr = localStorage.getItem('freeroom_student_batch');
  return {
    batch: batchStr ? parseInt(batchStr, 10) : undefined,
    group: localStorage.getItem('freeroom_student_group') || undefined,
    lastDateWindow: {
      fromTime: localStorage.getItem('fr_from_time') || undefined,
      toTime: localStorage.getItem('fr_to_time') || undefined,
    },
  };
};

// ── Auth ────────────────────────────────────────────────
export const authAPI = {
  googleLogin: (param, deviceSettings = getDeviceSettings()) => {
    const payload = typeof param === 'string' ? { credential: param } : param;
    return api.post('/auth/google', { ...payload, deviceSettings });
  },

  devLogin: (email, name, role, deviceSettings = getDeviceSettings()) =>
    api.post('/auth/dev-login', { email, name, role, deviceSettings }),

  adminLogin: (email, password) =>
    api.post('/auth/admin-login', { email, password }),

  updateSettings: (settings) =>
    api.put('/auth/settings', { settings }),

  getMe: () =>
    api.get('/auth/me'),
};

// ── Rooms ───────────────────────────────────────────────
export const roomsAPI = {
  getFreeNow: (params) =>
    api.get('/rooms/free-now', { params }),

  getFreeWindow: (params) =>
    api.get('/rooms/free-window', { params }),

  getTimeline: (roomId, date) =>
    api.get(`/rooms/${roomId}/timeline`, { params: { date } }),

  list: (buildingId = 1) =>
    api.get('/rooms', { params: { buildingId } }),

  getBatchesAndGroups: (params) =>
    api.get('/rooms/batches-and-groups', { params }),

  getMyGroup: (params) =>
    api.get('/rooms/my-group', { params }),

  getNextTimetable: (params) =>
    api.get('/rooms/next-timetable', { params }),
};

// ── Reports ─────────────────────────────────────────────
export const reportsAPI = {
  submit: (roomId, reportedStatus) =>
    api.post('/reports', { roomId, reportedStatus }),
};

// ── Admin ───────────────────────────────────────────────
export const adminAPI = {
  createEvent: (data) =>
    api.post('/admin/events', data),

  deleteEvent: (eventId) =>
    api.delete(`/admin/events/${eventId}`),

  cancelClass: (data) =>
    api.post('/admin/cancel-class', data),

  getTimetable: (roomId, termId) =>
    api.get('/admin/timetable', { params: { roomId, termId } }),

  getEvents: () =>
    api.get('/admin/events'),

  getTerms: () =>
    api.get('/admin/terms'),

  createTerm: (data) =>
    api.post('/admin/terms', data),

  deleteTerm: (termId) =>
    api.delete(`/admin/terms/${termId}`),

  importTimetable: (formData) =>
    api.post('/admin/timetable/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),

  getRoomAliases: () =>
    api.get('/admin/room-aliases'),

  createRoomAlias: (alias, roomId) =>
    api.post('/admin/room-aliases', { alias, roomId }),

  deleteRoomAlias: (aliasId) =>
    api.delete(`/admin/room-aliases/${aliasId}`),

  getClosures: () =>
    api.get('/admin/closures'),

  createClosure: (data) =>
    api.post('/admin/closures', data),

  deleteClosure: (closureId) =>
    api.delete(`/admin/closures/${closureId}`),

  getNoClassDays: () =>
    api.get('/admin/no-class-days'),

  createNoClassDay: (data) =>
    api.post('/admin/no-class-days', data),

  deleteNoClassDay: (id) =>
    api.delete(`/admin/no-class-days/${id}`),

  getActionLogs: () =>
    api.get('/admin/action-logs'),

  getSettings: () =>
    api.get('/admin/settings'),

  updateSettings: (data) =>
    api.put('/admin/settings', data),
};

export default api;
