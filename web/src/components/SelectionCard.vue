<template>
  <div class="sel-card" id="selCard">
    <template v-if="selection.kind === 'empty'">
      点击输送设备、堆垛机或货架库位查看详情，也可输入设备编号定位。
    </template>

    <template v-else>
      <div class="sel-head">
        <b>{{ selection.title }}</b>
        <span v-if="selection.meta">{{ selection.meta }}</span>
      </div>

      <div v-if="selection.rows && selection.rows.length" class="sel-rows">
        <div v-for="row in selection.rows" :key="row.label" class="sel-row">
          <span>{{ row.label }}</span>
          <b :class="{ mono: row.mono }" :style="row.color ? { color: row.color } : null">{{ row.value }}</b>
        </div>
      </div>

      <div v-for="(note, index) in selection.notes" :key="'note' + index" class="signal-note">{{ note }}</div>

      <SignalBlock v-if="can('manage:connections')" :model="selection.signal" />
    </template>
  </div>
</template>

<script setup>
import SignalBlock from './SignalBlock.vue';
import { can } from '../store/auth';

defineProps({
  // 引擎发布的结构化选中对象：kind=crane|conveyor|cell。
  selection: { type: Object, required: true }
});
</script>
