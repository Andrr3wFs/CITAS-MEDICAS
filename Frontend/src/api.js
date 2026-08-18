// frontend/src/api.js
import axios from 'axios';

const API_URL =
  import.meta.env.VITE_API_URL ||
  '/api';

const api = axios.create({
  baseURL: API_URL.replace(/\/$/, ''),
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// Agregar token automáticamente a cada petición
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestPath = String(error.config?.url || '');
    const isAuthenticationFlow = ['/login', '/logout', '/auth/mfa/', '/auth/password/change'].some((path) => requestPath.includes(path));
    const hasSessionToken = Boolean(error.config?.headers?.Authorization || localStorage.getItem('token'));

    if (error.response?.status === 401 && hasSessionToken && !isAuthenticationFlow) {
      localStorage.removeItem('token');
      localStorage.removeItem('username');
      localStorage.removeItem('role');
      localStorage.removeItem('displayName');
      localStorage.removeItem('sessionIdleTimeoutMs');
      window.dispatchEvent(new Event('hospital-session-expired'));
    }

    return Promise.reject(error);
  }
);

export default api;