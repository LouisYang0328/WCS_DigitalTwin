<template>
  <header class="topbar">
    <router-link class="brand" :to="{ path: '/' }">
      <span class="mark"></span>
      WCS 数字孪生 <span class="brand-context">三维现场</span>
      <span class="sub">1F / 2F · 5 巷道 · 共用 TC01–TC05</span>
    </router-link>

    <!-- 全站唯一导航源：三维路由显示引擎绑定的楼层/视角控件，
         工程路由显示深链入口；引擎元素始终挂载（v-show），避免引擎缓存的引用失效。 -->
    <nav class="module-nav" aria-label="功能模块">
      <details class="nav-module" data-module="display">
        <summary class="module-button" :class="{ active: isTwin }" id="displayModuleSummary" aria-controls="displayModulePanel">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/></svg>
          <span>页面展示</span><small v-show="isTwin" data-display-label>双层 · 总览</small><i class="module-caret" aria-hidden="true"></i>
        </summary>
        <div class="module-popover display-popover" id="displayModulePanel">
          <div v-show="isTwin">
            <div class="module-section">
              <h3>楼层展示</h3>
              <div class="seg" id="floorTabs" role="group" aria-label="楼层展示">
                <button type="button" data-mode="1" data-close-module>一层</button>
                <button type="button" data-mode="2" data-close-module>二层</button>
                <button type="button" class="on" data-mode="3" data-close-module title="1F 在下、2F 在上，同一平面位置上下叠放">双层</button>
              </div>
            </div>
            <div class="module-section">
              <h3>观察视角</h3>
              <div class="seg" id="viewBtns" role="group" aria-label="观察视角">
                <button type="button" class="on" data-view="overview" data-close-module>总览</button>
                <button type="button" data-view="top" data-close-module>俯视</button>
                <button type="button" data-view="aisle" data-close-module>巷道</button>
                <button type="button" data-view="walk" data-close-module>现场</button>
                <button type="button" data-view="fpv" data-close-module title="点地面选择站立位置，进入第一视角">第一视角</button>
              </div>
            </div>
            <div class="module-section module-display-options">
              <button class="immersive-btn" id="btnImmersive" type="button" aria-pressed="false" title="收起侧栏，放大三维场景">沉浸视图</button>
            </div>
          </div>
          <div v-if="!isTwin">
            <a class="module-option" href="#f=1" @click.prevent="goTwin('#f=1')"><strong>一层</strong><small>查看一层现场</small><span aria-hidden="true">→</span></a>
            <a class="module-option" href="#f=2" @click.prevent="goTwin('#f=2')"><strong>二层</strong><small>查看二层现场</small><span aria-hidden="true">→</span></a>
            <a class="module-option" href="#f=both" @click.prevent="goTwin('#f=both')"><strong>双层</strong><small>同时查看两层现场</small><span aria-hidden="true">→</span></a>
          </div>
        </div>
      </details>

      <details v-if="can('manage:connections')" class="nav-module" data-module="connections">
        <summary class="module-button" :class="{ active: isEngineering }" aria-controls="connectionModulePanel">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-6 6v4M6 11H3m18 0h-3"/></svg>
          <span>设备连接</span><small v-if="engineeringLabel">{{ engineeringLabel }}</small><i class="module-caret" aria-hidden="true"></i>
        </summary>
        <div class="module-popover connection-popover" id="connectionModulePanel">
          <router-link class="module-option" :to="{ path: '/devices' }" :aria-current="route.name === 'devices' ? 'page' : undefined"><strong>真实 PLC</strong><small>配置现场设备与 DB 点位</small><span aria-hidden="true">{{ route.name === 'devices' ? '✓' : '→' }}</span></router-link>
          <router-link class="module-option" :to="{ path: '/simulator' }" :aria-current="route.name === 'simulator' ? 'page' : undefined"><strong>模拟 PLC</strong><small>本机信号输入与演示</small><span aria-hidden="true">{{ route.name === 'simulator' ? '✓' : '→' }}</span></router-link>
        </div>
      </details>

      <button
        class="module-button dash-btn"
        id="btnDash"
        type="button"
        title="打开任务 / 库位 / 报警数据看板"
        aria-controls="dash"
        :aria-expanded="dash.open ? 'true' : 'false'"
        @click="openDash"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V10M9.5 19V5M15 19v-6M20 19V8"/></svg>
        <span>数据看板</span>
      </button>
    </nav>

    <div class="spacer"></div>
    <div class="live" v-show="isTwin"><i></i><span id="linkText">WCS 数据链路 · 模拟</span></div>
    <div class="clock" id="clock">00:00:00</div>
    <div class="account-area">
      <button v-if="can('manage:users')" class="account-manage" type="button" @click="usersOpen = true">用户管理</button>
      <div class="account-identity" :title="roleLabels[auth.user?.role]">
        <span>{{ auth.user?.displayName || auth.user?.username }}</span><small>{{ roleLabels[auth.user?.role] }}</small>
      </div>
      <button class="account-logout" type="button" title="退出登录" @click="signOut">退出</button>
    </div>
  </header>
  <UserManagement :open="usersOpen" @close="usersOpen = false" />
</template>

<script setup>
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { callEngine, twin } from '../store/twin';
import { auth, can, logout, roleLabels } from '../store/auth';
import UserManagement from './UserManagement.vue';

const route = useRoute();
const router = useRouter();
const isTwin = computed(() => route.name === 'twin');
const isEngineering = computed(() => route.name === 'devices' || route.name === 'simulator');
const engineeringLabel = computed(() => route.name === 'devices' ? '真实 PLC' : route.name === 'simulator' ? '模拟 PLC' : '');

// 顶栏其余部分仍由三维引擎与 module-navigation.js 更新；看板入口在工程路由时先回三维再打开。
const dash = computed(() => twin.dash);
const usersOpen = ref(false);
const openDash = () => {
  if (isTwin.value) { callEngine('openDash'); return; }
  router.push({ path: '/', hash: '#dash=1' });
};
const goTwin = hash => router.push({ path: '/', hash });
const signOut = async () => { await logout(); location.reload(); };
</script>
