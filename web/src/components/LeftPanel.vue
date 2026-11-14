<template>
  <aside class="panel left">
    <div class="panel-head"><h2>仓库概况</h2><span class="tag">{{ left.floorTag }}</span></div>
    <div class="panel-body">
      <div class="kpis">
        <div class="kpi"><div class="k">库位总数</div><div class="v">{{ left.kpis.total }}</div></div>
        <div class="kpi"><div class="k">库位占用率</div><div class="v">{{ occupancyText }}<small>%</small></div></div>
        <div class="kpi"><div class="k">运行任务</div><div class="v">{{ left.kpis.tasks }}</div></div>
        <div class="kpi" :class="{ bad: left.kpis.alarms > 0 }">
          <div class="k">共享设备报警</div><div class="v">{{ left.kpis.alarms }}</div>
        </div>
      </div>

      <div class="sect-title"><b>全部输送设备</b><span>{{ deviceCountLabel }}</span></div>
      <input
        v-model="query"
        class="device-search"
        type="search"
        placeholder="输入编号定位，如 1074 / 2056"
        aria-label="搜索输送设备编号"
      >
      <div class="device-index">
        <button
          v-for="device in filteredDevices"
          :key="device.id"
          :class="{ on: device.selected }"
          :title="device.floor + ' · ' + device.kind"
          @click="selectDevice(device.id)"
        >{{ device.id }}</button>
        <div v-if="left.devices.items.length && !filteredDevices.length" class="empty" style="grid-column:1/-1">当前楼层没有此编号</div>
      </div>

      <div class="sect-title"><b>巷道负载</b><span>占用率</span></div>
      <div class="list">
        <div class="floor-summary">TC01–TC05 · 5 台设备供两层共用</div>
        <div
          v-for="aisle in left.aisles"
          :key="aisle.code"
          class="aisle-row"
          :class="{ sel: aisle.selected }"
          :title="aisle.hint"
          @click="selectAisle(aisle.index)"
        >
          <span class="dot" :style="{ background: aisle.color }"></span>
          <span class="a-name">{{ aisle.name }}</span>
          <span class="a-dev">{{ aisle.code }}</span>
          <div class="bar"><i :style="{ width: aisle.pct + '%' }"></i></div>
          <span class="pct">{{ aisle.pct }}%</span>
        </div>
      </div>

      <div class="sect-title"><b>巷道口输送段</b><span>{{ left.lineMap.floorTag }}</span></div>
      <div class="line-map">
        <template v-for="(group, index) in left.lineMap.groups" :key="index">
          <div v-if="group.label" class="floor-summary">{{ group.label }}</div>
          <div v-for="row in group.rows" :key="group.label + row.name" class="lm">
            <b>{{ row.name }}</b>
            <span class="in">{{ row.inText }}</span>
            <span class="out">{{ row.outText }}</span>
          </div>
        </template>
      </div>

      <div class="sect-title"><b>运行控制</b><span>{{ speedLabel }}</span></div>
      <div class="ctrl">
        <button class="btn" :class="{ primary: left.controls.paused }" @click="togglePause">
          {{ left.controls.paused ? '继续仿真' : '暂停仿真' }}
        </button>
        <button class="btn" @click="demoAlarm">模拟报警</button>
      </div>
      <div class="ctrl">
        <button class="btn" @click="cycleSpeed">速度 {{ left.controls.speed }}×</button>
        <button class="btn" @click="resetView">重置视角</button>
      </div>
    </div>
  </aside>
</template>

<script setup>
import { computed, ref } from 'vue';
import { twin, callEngine } from '../store/twin';

const left = computed(() => twin.left);
// 设备搜索留在组件内：引擎把当前楼层全部设备发过来，筛选和计数都不必再回引擎。
const query = ref('');

const filteredDevices = computed(() => {
  const keyword = query.value.trim();
  const items = left.value.devices.items;
  return keyword ? items.filter(item => item.id.includes(keyword)) : items;
});

const deviceCountLabel = computed(() => {
  const keyword = query.value.trim();
  return (keyword ? filteredDevices.value.length + ' / ' : '') + left.value.devices.total + ' 台';
});

const occupancyText = computed(() => {
  const value = left.value.kpis.occupancy;
  return value === null || value === undefined ? '--' : value.toFixed(1);
});

const speedLabel = computed(() => left.value.controls.speed.toFixed(1) + '×');

const selectDevice = id => callEngine('selectDevice', id);
const selectAisle = index => callEngine('selectAisle', index);
const togglePause = () => callEngine('togglePause');
const demoAlarm = () => callEngine('demoAlarm');
const cycleSpeed = () => callEngine('cycleSpeed');
const resetView = () => callEngine('resetView');
</script>
