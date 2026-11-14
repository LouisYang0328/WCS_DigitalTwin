import { createRouter, createWebHistory } from 'vue-router';
import { auth, can } from './store/auth';

// 三维现场不是路由组件：它在 App.vue 里常驻（v-show 切显隐），引擎与 WebGL 上下文不随路由销毁。
// devices/simulator 才是路由视图，懒加载，只有工程师/超管能进（服务端同时把关页面与 API）。
const routes = [
  { path: '/', name: 'twin', component: { render: () => null } },
  {
    path: '/devices',
    name: 'devices',
    component: () => import('./views/DevicesView.vue'),
    meta: { requiresConnections: true }
  },
  {
    path: '/simulator',
    name: 'simulator',
    component: () => import('./views/SimulatorView.vue'),
    meta: { requiresConnections: true }
  },
  { path: '/:pathMatch(.*)*', redirect: '/' }
];

export const router = createRouter({
  history: createWebHistory(),
  routes
});

router.beforeEach(to => {
  if (to.meta.requiresConnections && auth.status === 'authenticated' && !can('manage:connections')) {
    return { path: '/' };
  }
  return true;
});
