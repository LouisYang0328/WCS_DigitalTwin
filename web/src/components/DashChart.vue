<template>
  <div ref="host" :class="hostClass"></div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { loadEcharts } from '../charts/load-echarts';

const props = defineProps({
  // builder(echarts, data, size) → option；返回 null 时跳过本次绘制。
  builder: { type: Function, required: true },
  data: { type: Object, default: null },
  // 图表容器的类名：环形图要沿用 .d-ring 的固定尺寸。
  hostClass: { type: String, default: 'chart' }
});

const host = ref(null);
let chart = null;
let echartsLib = null;
let observer = null;
let disposed = false;

function draw() {
  if (!chart || disposed) return;
  const option = props.builder(echartsLib, props.data, {
    width: chart.getWidth(),
    height: chart.getHeight()
  });
  if (option) chart.setOption(option);
}

onMounted(async () => {
  echartsLib = await loadEcharts();
  if (!echartsLib || disposed || !host.value) return;
  chart = echartsLib.init(host.value, null, { renderer: 'canvas' });
  draw();
  // 面板尺寸随窗口与看板布局变化：热力图的字号也依赖宽度，resize 后重画一次。
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => {
      if (!chart) return;
      const width = host.value ? host.value.clientWidth : 0;
      if (!width) return;
      chart.resize();
      draw();
    });
    observer.observe(host.value);
  }
});

watch(() => props.data, draw);

onBeforeUnmount(() => {
  disposed = true;
  if (observer) observer.disconnect();
  if (chart) chart.dispose();
  chart = null;
});
</script>
