<template>
  <div v-if="auth.status === 'loading'" class="session-loading"><span class="login-mark"></span><b>WCS 数字孪生</b><small>正在恢复安全会话…</small></div>
  <LoginView v-else-if="auth.status !== 'authenticated'" />
  <template v-else>
    <TopBar />
    <TwinView v-show="isTwin" />
    <router-view v-if="!isTwin" />
  </template>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import TopBar from './components/TopBar.vue';
import TwinView from './views/TwinView.vue';
import LoginView from './components/LoginView.vue';
import { loadEngine } from './engine/load-engine';
import { ensureModuleNavigation } from './engine/load-module-navigation';
import { auth, can, expireSession, loadSession } from './store/auth';
import { loadDashboardConfig } from './store/dashboard';

const route = useRoute();
const router = useRouter();
const isTwin = computed(() => route.name === 'twin');

let engineLoading = null;
const unauthorized = () => expireSession();

// 工程页深链：兼容新路径 /devices、/simulator 与旧路径 *.html（服务端会 301 到新路径）。
const ENGINEERING_NEXT = /^\/(devices|simulator)(\.html)?([?#].*)?$/;

/* 引擎只装载一次，且只在三维路由可见时装载；
 * 切去工程页时通过事件让渲染循环挂起，切回来再恢复。 */
async function ensureEngine() {
  if (engineLoading) return engineLoading;
  engineLoading = (async () => {
    try { await loadDashboardConfig(); } catch (_) { /* 看板保留默认配置，接口会显示错误 */ }
    await nextTick();
    loadEngine();
  })();
  return engineLoading;
}

async function enterWorkspace() {
  if (auth.status !== 'authenticated') return;
  // 顶栏弹层交互在工程页同样需要（三维路由会由引擎装载顺带注入，脚本自带幂等守卫）。
  await nextTick();
  ensureModuleNavigation();
  // 登录回跳优先：目标是工程页就直接切路由，不加载三维引擎。
  const next = new URLSearchParams(location.search).get('next');
  if (can('manage:connections') && next && ENGINEERING_NEXT.test(next)) {
    router.push(next.replace('.html', ''));
    return;
  }
  if (isTwin.value) await ensureEngine();
}

onMounted(async () => {
  window.addEventListener('wcs:unauthorized', unauthorized);
  await loadSession();
  await enterWorkspace();
});
onBeforeUnmount(() => window.removeEventListener('wcs:unauthorized', unauthorized));

// 登录组件只负责写入会话；状态变为已认证后再初始化工作区，避免匿名请求设备数据。
watch(() => auth.status, status => { if (status === 'authenticated') enterWorkspace(); });

// 路由显隐 ↔ 引擎挂起/恢复；带着 hash 深链（#f=1、#dash=1）进来时同步给引擎。
watch(isTwin, async twin => {
  if (auth.status !== 'authenticated') return;
  if (twin) {
    await nextTick();
    await ensureEngine();
    window.dispatchEvent(new CustomEvent('wcs:twin-route-hidden', { detail: { visible: true } }));
    if (location.hash) window.dispatchEvent(new Event('hashchange'));
  } else {
    window.dispatchEvent(new CustomEvent('wcs:twin-route-hidden', { detail: { visible: false } }));
  }
});
</script>
