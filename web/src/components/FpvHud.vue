<template>
  <div v-if="fpv.placing" class="fpv-banner">第一视角 · 点击地面选择站立位置，ESC 取消</div>
  <template v-if="fpv.active">
    <div class="fpv-cross" aria-hidden="true"><i></i></div>
    <div class="fpv-status">
      <b>第一视角 · {{ fpv.floor }}</b>
      <span class="mono">X {{ fpv.x }} m · Z {{ fpv.z }} m</span>
      <small>拖拽环视 · W/A/S/D 或滚轮行走 · 点击附近设备看详情 · ESC 返回总览</small>
    </div>
    <div v-if="fpv.nearby.length" class="fpv-nearby">
      <h3>视野周边设备 <span>{{ fpv.nearby.length }}</span></h3>
      <button v-for="item in fpv.nearby" :key="item.id" type="button" @click="locate(item.id)">
        <b class="mono">{{ item.id }}</b>
        <i>{{ item.kind }}</i>
        <em>{{ item.direction }} · {{ item.distance }} m</em>
      </button>
    </div>
  </template>
</template>

<script setup>
import { computed } from 'vue';
import { callEngine, twin } from '../store/twin';

const fpv = computed(() => twin.fpv);
// 点清单里的设备：选中并出详情卡，但第一视角下不挪相机。
const locate = id => callEngine('selectDevice', id);
</script>
