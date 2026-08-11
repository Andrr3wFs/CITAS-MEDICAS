// frontend/src/api.js
import axios from 'axios';

const api = axios.create({
  baseURL: 'https://elegant-quietude-production-c1c5.up.railway.app', // o https://medicenters.uk
  withCredentials: true
});

export default api;

const NGROK_API_URL = 'https://tricrotic-noninhibitive-carlie.ngrok-free.dev/api';
const DEFAULT_LOCAL_API_URL = 'http://127.0.0.1:5000';

const resolveApiBaseUrl = () => {
  const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();

  if (configuredApiUrl) {
    return configuredApiUrl.replace(/\/$/, '');
  }

  if (import.meta.env.DEV) {
    return NGROK_API_URL;
  }

  if (typeof window !== 'undefined') {
    const { protocol, hostname, origin } = window.location;
    const isHttpPage = protocol === 'http:' || protocol === 'https:';
    const isLocalHostname = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

    if (isHttpPage && !isLocalHostname) {
      return NGROK_API_URL;
    }
  }

  return NGROK_API_URL;
};

// Crear instancia de Axios
const api = axios.create({
  baseURL: resolveApiBaseUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
});

// Agregar token automáticamente a cada petición
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  const role = localStorage.getItem('role');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (role) {
    config.headers['x-user-role'] = role;
  }
  return config;
});

export default api;