<template>
  <!-- display:contents 让这层包裹在布局上等于不存在：面板、舞台仍是 #app 的直接视觉子级，
       v-show 切显隐时 DOM 不卸载，三维引擎与 WebGL 上下文得以跨路由存活。 -->
  <div class="twin-view">
    <BootScreen />
    <TwinStage />
    <LeftPanel />
    <RightPanel />
    <FpvHud />
    <DataDashboard />
    <SceneTools />
  </div>
</template>

<script setup>
import BootScreen from '../components/BootScreen.vue';
import TwinStage from '../components/TwinStage.vue';
import LeftPanel from '../components/LeftPanel.vue';
import RightPanel from '../components/RightPanel.vue';
import DataDashboard from '../components/DataDashboard.vue';
import SceneTools from '../components/SceneTools.vue';
import FpvHud from '../components/FpvHud.vue';
</script>

<style>
.twin-view { display: contents; }
</style>
