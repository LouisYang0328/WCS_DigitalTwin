<template>
  <template v-if="model">
    <div v-if="model.state === 'note'" class="signal-note">{{ model.note }}</div>
    <template v-else>
      <div class="crane-source">
        <span class="source-badge" :class="{ sim: model.isSimulation }">
          {{ model.isSimulation ? 'S7 本地模拟' : 'S7 现场 PLC' }}
        </span>
        <span v-if="model.qualityText" class="signal-tile" :class="model.tone" style="padding:2px 6px;border-radius:12px">
          {{ model.qualityText }}
        </span>
        <time>{{ model.updatedAt }}</time>
      </div>

      <div v-if="model.state === 'waiting'" class="signal-note">{{ model.note }}</div>
      <template v-else>
        <div v-if="model.meta" class="signal-note">{{ model.meta }}</div>

        <div v-if="model.tiles && model.tiles.length" class="signal-grid">
          <div v-for="tile in model.tiles" :key="tile.label" class="signal-tile" :class="tile.tone">
            <span>{{ tile.label }}</span>
            <b>{{ tile.value }}</b>
            <small v-if="tile.hint">{{ tile.hint }}</small>
          </div>
        </div>

        <div v-if="model.coords" class="coord-list">
          <div v-for="coord in model.coords" :key="coord.label" class="coord-item">
            <span>{{ coord.label }}</span>
            <b>{{ coord.text }}</b>
            <small>{{ coord.sub }}</small>
          </div>
        </div>

        <div v-if="model.fork" class="fork-meter">
          <div class="fork-meter-title">
            <span>叉齿位置（5000 为中位）</span><b>{{ model.fork.value }}</b>
          </div>
          <div class="fork-track">
            <span class="fork-center"></span>
            <span class="fork-marker" :style="{ left: model.fork.left.toFixed(1) + '%' }"></span>
          </div>
          <div class="fork-scale"><span>0</span><span>5000 中位</span><span>10000</span></div>
          <div class="signal-note">相对中位：{{ model.fork.offset }} · 左右方向以现场定义为准</div>
        </div>

        <div v-if="model.barcode" class="signal-note">容器条码：<span class="mono">{{ model.barcode }}</span></div>
        <div v-for="(note, index) in model.notes" :key="index" class="signal-note">{{ note }}</div>
      </template>
    </template>
  </template>
</template>

<script setup>
defineProps({
  // 引擎发布的 S7 信号快照：state=note|waiting|ok，其余字段按状态出现。
  model: { type: Object, default: null }
});
</script>
