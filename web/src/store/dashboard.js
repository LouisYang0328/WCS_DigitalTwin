import { reactive } from 'vue';
import { apiRequest } from '../api';

const defaults = {
  id: 'default',
  title: 'WCS 数字孪生 · 任务库位报警',
  refreshSeconds: 2,
  taskTarget: 1600,
  taskRateTarget: 98,
  cellTarget: 85,
  panels: [],
  updatedAt: null,
  updatedBy: null
};

export const dashboard = reactive({ ...defaults, loading: false, error: '' });

export async function loadDashboardConfig() {
  dashboard.loading = true;
  dashboard.error = '';
  try {
    const config = await apiRequest('/api/dashboard/config');
    Object.assign(dashboard, defaults, config, { loading: false });
    return config;
  } catch (error) {
    dashboard.loading = false;
    dashboard.error = error.message;
    throw error;
  }
}

export async function saveDashboardConfig(config) {
  dashboard.error = '';
  try {
    const saved = await apiRequest('/api/dashboard/config', {
      method: 'PUT', body: JSON.stringify(config)
    });
    Object.assign(dashboard, saved, { loading: false });
    return saved;
  } catch (error) {
    dashboard.error = error.message;
    throw error;
  }
}

export function dashboardPanel(id) {
  return dashboard.panels.find(panel => panel.id === id) || { id, visible: true, order: 0 };
}
