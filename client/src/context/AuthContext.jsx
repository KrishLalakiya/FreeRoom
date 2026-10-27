import { createContext, useContext, useState, useEffect } from 'react';
import { authAPI } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Restore session from localStorage
    const savedToken = localStorage.getItem('freeroom_token');
    const savedUser = localStorage.getItem('freeroom_user');

    if (savedToken && savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch {
        logout();
      }
    }
    setLoading(false);
  }, []);

  const login = (tokenStr, userData) => {
    localStorage.setItem('freeroom_token', tokenStr);
    localStorage.setItem('freeroom_user', JSON.stringify(userData));
    setUser(userData);

    // PRD v6 Section 3: If account has settings, account settings follow the student
    if (userData?.settings) {
      if (userData.settings.batch) {
        localStorage.setItem('freeroom_student_batch', String(userData.settings.batch));
      }
      if (userData.settings.group) {
        localStorage.setItem('freeroom_student_group', userData.settings.group);
      }
      if (userData.settings.lastDateWindow?.fromTime) {
        localStorage.setItem('fr_from_time', userData.settings.lastDateWindow.fromTime);
      }
      if (userData.settings.lastDateWindow?.toTime) {
        localStorage.setItem('fr_to_time', userData.settings.lastDateWindow.toTime);
      }
    }
  };

  const updateSettings = async (newSettings) => {
    if (!user) return;
    try {
      const res = await authAPI.updateSettings(newSettings);
      const updatedUser = { ...user, settings: { ...(user.settings || {}), ...res.data.settings } };
      localStorage.setItem('freeroom_user', JSON.stringify(updatedUser));
      setUser(updatedUser);
    } catch (err) {
      console.warn('Failed to sync settings to account:', err);
    }
  };

  const logout = () => {
    localStorage.removeItem('freeroom_token');
    localStorage.removeItem('freeroom_user');
    setUser(null);
    // PRD v6 Section 3: On sign-out, the device keeps its last settings.
  };

  const isAdmin = user?.role === 'admin';

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isAdmin, updateSettings }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
