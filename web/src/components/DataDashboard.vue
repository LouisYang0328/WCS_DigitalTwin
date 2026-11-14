<template>
  <section
    class="dash"
    id="dash"
    aria-label="WCS 任务库位报警数据看板"
    :class="{ on: dash.open }"
    :aria-hidden="dash.open ? 'false' : 'true'"
  >
    <svg width="0" height="0" style="position:absolute" aria-hidden="true">
      <symbol id="i-trend" viewBox="0 0 24 24"><path d="M3 17l5-6 4 3 4-6 5 4"/><path d="M3 21h18"/></symbol>
      <symbol id="i-bar" viewBox="0 0 24 24"><path d="M4 20V11M9.5 20V5M15 20v-6M20.5 20V9"/></symbol>
      <symbol id="i-pie" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3v9l7.5 5"/></symbol>
      <symbol id="i-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></symbol>
      <symbol id="i-list" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></symbol>
      <symbol id="i-cpu" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M10 2v2M14 2v2M10 20v2M14 20v2M2 10h2M2 14h2M20 10h2M20 14h2"/></symbol>
      <symbol id="i-alert" viewBox="0 0 24 24"><path d="M12 4l8.5 15h-17L12 4Z"/><path d="M12 10v4M12 17h.01"/></symbol>
      <symbol id="i-cube" viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/></symbol>
    </svg>

    <header class="dash-top">
      <div class="dash-brand">
        <span class="db-mark"></span>
        <h2>{{ dashboard.title }}</h2>
        <span class="db-tag">{{ scopeText }}</span>
      </div>
      <nav class="dash-nav">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          :class="{ on: dash.domain === tab.key }"
          @click="setDomain(tab.key)"
        >{{ tab.label }}</button>
      </nav>
      <div class="dash-spacer"></div>
      <div class="dash-sync"><i></i>实时数据 <b>{{ displayUpdatedAt }}</b> 更新</div>
      <div class="dash-clock"><b>{{ dash.clock.time }}</b><span>{{ dash.clock.date }}</span></div>
      <button v-if="can('manage:dashboard')" class="dash-settings-btn" type="button" @click="settingsOpen = true">看板配置</button>
      <button ref="backButton" class="dash-back" type="button" @click="closeDash">← 返回孪生</button>
    </header>

    <div class="dash-grid">
      <!-- 左列：任务 -->
      <div class="dash-col left">
        <section v-if="panelVisible('task-overview')" class="dash-panel" :class="panelClass('task')" :style="panelStyle('task-overview', 1.14)">
          <div class="p-head">
            <span class="p-ico"><svg><use href="#i-bar"/></svg></span>
            <h3>任务总览</h3>
            <span class="p-tag">今日 · {{ taskTag }}</span>
          </div>
          <div class="p-body">
            <div class="dash-kpis">
              <div v-for="card in kpiCards" :key="card.k" class="dash-kpi">
                <div class="dk-main">
                  <div class="dk-k">{{ card.k }}</div>
                  <div class="dk-v">{{ card.v }}<small v-if="card.unit">{{ card.unit }}</small></div>
                  <div class="dk-goal">{{ card.goal }}</div>
                </div>
                <div class="dk-ring" :style="{ '--p': card.p.toFixed(1), '--c': card.c }">
                  <span>{{ card.p.toFixed(1) }}%</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section v-if="panelVisible('task-trend')" class="dash-panel" :class="panelClass('task')" :style="panelStyle('task-trend', 1.4)">
          <div class="p-head">
            <span class="p-ico"><svg><use href="#i-trend"/></svg></span>
            <h3>任务趋势</h3>
            <span class="p-tag">近 7 天 · 均节拍 <b>{{ cycleText }}</b></span>
          </div>
          <div class="p-body">
            <DashChart v-if="dash.opened" :builder="builders.taskTrend" :data="snapshot" />
          </div>
        </section>

        <section v-if="panelVisible('task-type')" class="dash-panel" :class="panelClass('task')" :style="panelStyle('task-type', 1.06)">
          <div class="p-head">
            <span class="p-ico"><svg><use href="#i-pie"/></svg></span>
            <h3>任务类型占比</h3>
            <span class="p-tag">入库 / 出库 / 移库</span>
          </div>
          <div class="p-body">
            <DashChart v-if="dash.opened" :builder="builders.taskType" :data="snapshot" />
          </div>
        </section>
      </div>

      <!-- 中列：库位矩阵 + 实时告警 + 设备状态 -->
      <div class="dash-col">
        <section v-if="panelVisible('cell-heatmap')" class="dash-panel" :class="panelClass('cell')" :style="panelStyle('cell-heatmap', 1.5)">
          <div class="p-head">
            <span class="p-ico"><svg><use href="#i-grid"/></svg></span>
            <h3>库位占用矩阵</h3>
            <span class="p-tag">巷道 A01–A05 × 货架层 1–10（1F 1–5 / 2F 6–10）</span>
          </div>
          <div class="p-body">
            <DashChart v-if="dash.opened" :builder="builders.cellHeat" :data="snapshot" />
          </div>
        </section>

        <div class="dash-subgrid">
          <section v-if="panelVisible('alarm-list')" class="dash-panel" :class="panelClass('alarm')" :style="panelStyle('alarm-list', 1)">
            <div class="p-head">
              <span class="p-ico"><svg><use href="#i-list"/></svg></span>
              <h3>实时告警</h3>
              <span class="p-tag">最近 8 条 · 点击定位</span>
            </div>
            <div class="p-body">
              <div class="d-table-wrap">
                <table class="d-table">
                  <thead><tr><th>时间</th><th>设备 / 库位</th><th>告警内容</th><th>状态</th></tr></thead>
                  <tbody>
                    <tr v-for="entry in dash.log" :key="entry.id" title="点击在三维场景中定位" @click="locate(entry.id)">
                      <td class="al-t">{{ entry.t }}</td>
                      <td class="al-who">{{ entry.who }}</td>
                      <td class="al-what"><i class="lv-dot" :class="entry.level"></i>{{ entry.what }}</td>
                      <td><span class="pill-st" :class="entry.active ? 'bad' : 'ok'">{{ entry.active ? '处理中' : '已处理' }}</span></td>
                    </tr>
                    <tr v-if="!dash.log.length">
                      <td colspan="4" style="color:#5f7c9e;padding:10px 4px">暂无报警</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section v-if="panelVisible('device-state')" class="dash-panel" :class="panelClass('alarm')" :style="panelStyle('device-state', 1)">
            <div class="p-head">
              <span class="p-ico"><svg><use href="#i-cpu"/></svg></span>
              <h3>设备运行状态</h3>
              <span class="p-tag">{{ deviceTag }}</span>
            </div>
            <div class="p-body">
              <DashChart v-if="dash.opened" :builder="builders.deviceState" :data="snapshot" />
            </div>
          </section>
        </div>
      </div>

      <!-- 右列：库位数据 / 报警数据 / 成因 -->
      <div class="dash-col right">
        <section v-if="panelVisible('cell-data')" class="dash-panel" :class="panelClass('cell')" :style="panelStyle('cell-data', 1.2)">
          <div class="p-head">
            <span class="p-ico"><svg><use href="#i-cube"/></svg></span>
            <h3>库位数据</h3>
            <span class="p-tag">1F + 2F</span>
          </div>
          <div class="p-body">
            <div class="d-cells">
              <div v-for="card in cellCards" :key="card.k" class="d-cell">
                <div class="k">{{ card.k }}</div>
                <div class="v">{{ card.v }}<small>{{ card.unit }}</small></div>
                <div class="d"><span :class="card.tone">{{ card.toneText }}</span> {{ card.tail }}</div>
              </div>
            </div>
            <div class="d-subtitle"><span>巷道占用率</span><b>A01 – A05</b></div>
            <DashChart v-if="dash.opened" :builder="builders.cellAisle" :data="snapshot" />
          </div>
        </section>

        <section v-if="panelVisible('alarm-data')" class="dash-panel" :class="panelClass('alarm')" :style="panelStyle('alarm-data', 1.34)">
          <div class="p-head">
            <span class="p-ico"><svg><use href="#i-alert"/></svg></span>
            <h3>报警数据</h3>
            <span class="p-tag">今日 / 较昨日</span>
          </div>
          <div class="p-body">
            <div class="d-ringtop">
              <DashChart v-if="dash.opened" :builder="builders.alarmRing" :data="snapshot" host-class="d-ring" />
              <div v-if="alarmStats" class="d-ringstats">
                <div class="d-ringk">
                  <span>今日报警</span>
                  <b>{{ alarmStats.today }}<small>次</small></b>
                  <i :class="alarmStats.trendClass">较昨日 {{ alarmStats.arrow }} {{ alarmStats.delta }}%</i>
                </div>
                <div class="d-ringk">
                  <span>处理中</span>
                  <b>{{ alarmStats.pending }}<small>条</small></b>
                  <i>已闭环 {{ alarmStats.handled }} 条</i>
                </div>
              </div>
            </div>
            <div class="d-subtitle"><span>报警趋势</span><b>按等级 · 近 7 天</b></div>
            <DashChart v-if="dash.opened" :builder="builders.alarmTrend" :data="snapshot" />
          </div>
        </section>

        <section v-if="panelVisible('alarm-reasons')" class="dash-panel" :class="panelClass('alarm')" :style="panelStyle('alarm-reasons', .96)">
          <div class="p-head">
            <span class="p-ico"><svg><use href="#i-bar"/></svg></span>
            <h3>报警成因 TOP5</h3>
            <span class="p-tag">今日累计</span>
          </div>
          <div class="p-body">
            <div class="d-reasons">
              <div v-for="reason in reasons" :key="reason.name" class="d-reason">
                <span class="r-name"><i class="lv-dot" :class="reason.level"></i>{{ reason.name }}</span>
                <span class="r-n">{{ reason.n }} 次</span>
                <span class="r-bar"><i :style="{ width: reason.width + '%' }"></i></span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
    <DashboardSettings :open="settingsOpen" @close="settingsOpen = false" />
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import DashChart from './DashChart.vue';
import DashboardSettings from './DashboardSettings.vue';
import { callEngine, twin } from '../store/twin';
import { can } from '../store/auth';
import { dashboard, dashboardPanel } from '../store/dashboard';
import { DC, fmt } from '../charts/dash-charts';
import {
  taskTrend, taskType, cellHeat, deviceState, cellAisle, alarmRing, alarmTrend
} from '../charts/dash-charts';

// 图表宿主只认构造器：option 在拿到快照后按需现算，不在此处持有 echarts 实例。
const builders = { taskTrend, taskType, cellHeat, deviceState, cellAisle, alarmRing, alarmTrend };

const tabs = [
  { key: 'all', label: '总览' },
  { key: 'task', label: '任务' },
  { key: 'cell', label: '库位' },
  { key: 'alarm', label: '报警' }
];

const dash = computed(() => twin.dash);
const renderedSnapshot = ref(null);
const snapshot = computed(() => renderedSnapshot.value);
const displayUpdatedAt = ref('--:--:--');
const settingsOpen = ref(false);
const backButton = ref(null);
let lastRenderAt = 0;

function renderSnapshot(force = false) {
  const now = Date.now();
  if (!twin.dash.snapshot) return;
  const interval = Math.max(1, Number(dashboard.refreshSeconds) || 2) * 1000;
  if (!force && renderedSnapshot.value && now - lastRenderAt < interval) return;
  renderedSnapshot.value = twin.dash.snapshot;
  lastRenderAt = now;
  displayUpdatedAt.value = new Date(now).toLocaleTimeString('zh-CN', { hour12: false });
}
watch(() => twin.dash.snapshot, () => renderSnapshot(), { immediate: true });
const refreshTimer = window.setInterval(() => { if (dash.value.open) renderSnapshot(); }, 500);
watch(() => dashboard.refreshSeconds, () => renderSnapshot(true));
onBeforeUnmount(() => window.clearInterval(refreshTimer));

const panelVisible = id => dashboardPanel(id).visible !== false;
const panelStyle = (id, flex) => ({ order: dashboardPanel(id).order || 0, flex });

const scopeText = computed(() => snapshot.value
  ? 'A01–A05 · ' + fmt(snapshot.value.cell.total) + ' 库位 · ' + fmt(snapshot.value.dev.total) + ' 设备'
  : 'A01–A05 · 库位');

const deviceTag = computed(() => snapshot.value ? '全库 ' + fmt(snapshot.value.dev.total) + ' 台' : '全库设备');
const taskTag = computed(() => snapshot.value ? '今日 · ' + fmt(snapshot.value.task.total) + ' 条' : '今日');
const cycleText = computed(() => snapshot.value ? snapshot.value.task.cycle.toFixed(1) + ' s' : '--');

const kpiCards = computed(() => {
  const s = snapshot.value;
  if (!s) return [];
  const cards = [
    { k: '今日任务', v: fmt(s.task.total), unit: '', goal: '目标 ' + fmt(dashboard.taskTarget), p: s.task.total / Math.max(1, dashboard.taskTarget) * 100, c: DC.cyan },
    { k: '任务完成率', v: s.task.rate.toFixed(1), unit: '%', goal: '目标 ' + Number(dashboard.taskRateTarget).toFixed(1) + '%', p: s.task.rate, c: DC.blue },
    { k: '库位占用率', v: s.cell.pct.toFixed(1), unit: '%', goal: '目标 ' + Number(dashboard.cellTarget).toFixed(1) + '%', p: s.cell.pct, c: DC.teal },
    { k: '在办任务', v: String(s.task.active), unit: '条', goal: '满载 5 台堆垛机', p: s.task.active / 5 * 100, c: DC.violet }
  ];
  return cards.map(card => Object.assign({}, card, {
    p: Math.min(100, Math.max(0, Number.isFinite(card.p) ? card.p : 0))
  }));
});

const cellCards = computed(() => {
  const s = snapshot.value;
  if (!s) return [];
  const delta = s.cell.delta.toFixed(1) + '%';
  return [
    { k: '库位总数', v: fmt(s.cell.total), unit: '个', tone: '', toneText: '', tail: '1F + 2F' },
    { k: '已占用', v: fmt(s.cell.occ), unit: '个', tone: 'up', toneText: '↑ ' + delta, tail: '昨日' },
    { k: '空库位', v: fmt(s.cell.free), unit: '个', tone: 'down', toneText: '↓ ' + delta, tail: '昨日' }
  ];
});

const alarmStats = computed(() => {
  const s = snapshot.value;
  if (!s) return null;
  const delta = s.alarm.delta;
  return {
    today: fmt(s.alarm.today),
    pending: fmt(s.alarm.pending),
    handled: fmt(s.alarm.handled),
    delta: Math.abs(delta).toFixed(1),
    arrow: delta > 0 ? '↑' : '↓',
    trendClass: delta > 0 ? 'up' : 'down'
  };
});

const reasons = computed(() => {
  const s = snapshot.value;
  if (!s || !s.reasons.length) return [];
  const max = s.reasons[0].n || 1;
  return s.reasons.slice(0, 5).map(reason => Object.assign({}, reason, {
    width: Math.max(8, reason.n / max * 100).toFixed(0)
  }));
});

// 领域筛选：只有当前领域的面板保持亮度，其余压暗 —— 等价于原来的 dim/focus 类切换。
function panelClass(domain) {
  return {
    dim: dash.value.domain !== 'all' && domain !== dash.value.domain,
    focus: dash.value.domain !== 'all' && domain === dash.value.domain
  };
}

const setDomain = domain => callEngine('setDashDomain', domain);
const closeDash = () => callEngine('closeDash');
const locate = id => callEngine('locateAlarm', id);

// 打开时把焦点交给“返回”按钮，关闭后交还顶栏入口，键盘操作不用再摸黑找位置。
watch(() => dash.value.open, open => {
  if (open) {
    nextTick(() => backButton.value && backButton.value.focus && backButton.value.focus());
    return;
  }
  const entry = document.getElementById('btnDash');
  if (entry && entry.focus) entry.focus();
});
</script>
