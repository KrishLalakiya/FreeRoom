import axios from 'axios';

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
  return config;
});

// Handle 401 responses (expired token)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('freeroom_token');
      localStorage.removeItem('freeroom_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// ── Auth ────────────────────────────────────────────────
export const authAPI = {
  googleLogin: (credential) =>
    api.post('/auth/google', { credential }),

  devLogin: (email, name) =>
    api.post('/auth/dev-login', { email, name }),
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

  getBatchesAndGroups: () =>
    api.get('/rooms/batches-and-groups'),

  getMyGroup: (params) =>
    api.get('/rooms/my-group', { params }),
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
};

export default api;
