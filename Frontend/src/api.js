// frontend/src/api.js
import axios from 'axios';

const API_URL =
  import.meta.env.VITE_API_URL ||
  'https://elegant-quietude-production-c1c5.up.railway.app/api';

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
    const role = localStorage.getItem('role');

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    if (role) {
      config.headers['x-user-role'] = role;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export default api;