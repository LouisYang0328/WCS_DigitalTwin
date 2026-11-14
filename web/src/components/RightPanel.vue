<template>
  <aside class="panel right">
    <div class="panel-head"><h2>选中对象</h2><span class="tag">点击设备 / 库位</span></div>
    <div class="panel-body">
      <SelectionCard :selection="right.selection" />

      <div class="sect-title"><b>实时任务</b><span>最近 7 条</span></div>
      <div class="list">
        <div v-if="!right.tasks.length" class="empty">等待 WCS 下发任务…</div>
        <div v-for="(task, index) in right.tasks" :key="task.id + index" class="row tk">
          <div class="tk-top">
            <span class="t">{{ task.t }}</span>
            <span class="pill" :class="task.tone">{{ task.typeText }}</span>
            <span class="who">{{ task.who }}</span>
            <span class="what">{{ task.id }}</span>
          </div>
          <div class="tk-path">{{ task.path }}</div>
        </div>
      </div>

      <div class="sect-title"><b>报警记录</b><span>最近 5 条</span></div>
      <div class="list">
        <div v-if="!right.alarms.length" class="empty">暂无报警</div>
        <div v-for="(alarm, index) in right.alarms" :key="alarm.t + index" class="row alarm">
          <span class="t">{{ alarm.t }}</span>
          <span class="who">{{ alarm.who }}</span>
          <span class="what"><i class="lv-dot" :class="alarm.level"></i>{{ alarm.what }}</span>
        </div>
      </div>

      <div class="sect-title"><b>状态图例</b><span>与图纸一致</span></div>
      <div class="legend">
        <div><i style="background:#22c55e"></i>自动运行</div>
        <div><i style="background:#eab308"></i>任务中 / 暂停</div>
        <div><i style="background:#ef4444"></i>报警</div>
        <div><i style="background:#c2b19b"></i>托盘货物　<i style="background:#dfe6ef;margin-left:8px"></i>透空库位</div>
      </div>
    </div>
  </aside>
</template>

<script setup>
import { computed } from 'vue';
import SelectionCard from './SelectionCard.vue';
import { twin } from '../store/twin';

// 详情卡、任务与报警列表全部来自引擎发布的状态快照。
const right = computed(() => twin.right);
</script>
