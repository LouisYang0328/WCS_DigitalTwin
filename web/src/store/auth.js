import { reactive, computed } from 'vue';
import { apiRequest } from '../api';

export const auth = reactive({
  status: 'loading',
  user: null,
  expiresAt: null,
  error: ''
});

export const isAuthenticated = computed(() => auth.status === 'authenticated' && Boolean(auth.user));
export const can = permission => Boolean(auth.user?.permissions?.includes(permission));

export const roleLabels = {
  super_admin: '超级管理员',
  engineer: '运维工程师',
  viewer: '客户视图'
};

function applySession(data) {
  auth.user = data?.user || null;
  auth.expiresAt = data?.expiresAt || null;
  auth.status = auth.user ? 'authenticated' : 'anonymous';
  auth.error = '';
  return auth.user;
}

export async function loadSession() {
  auth.status = 'loading';
  try {
    const me = await apiRequest('/api/auth/me');
    return applySession({ user: me.user || me, expiresAt: me.expiresAt });
  } catch (error) {
    auth.user = null;
    auth.status = 'anonymous';
    if (error.status !== 401) auth.error = error.message;
    return null;
  }
}

export async function login(username, password) {
  auth.error = '';
  try {
    const data = await apiRequest('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username, password })
    });
    return applySession(data);
  } catch (error) {
    auth.error = error.message;
    throw error;
  }
}

export async function logout() {
  try { await apiRequest('/api/auth/logout', { method: 'POST' }); } finally {
    auth.user = null;
    auth.expiresAt = null;
    auth.status = 'anonymous';
  }
}

export function expireSession() {
  if (auth.status !== 'authenticated') return;
  auth.user = null;
  auth.expiresAt = null;
  auth.status = 'anonymous';
  auth.error = '登录已失效，请重新登录。';
}
