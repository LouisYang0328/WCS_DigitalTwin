<template>
  <section class="equipment-demo" aria-label="设备交互演示">
    <header class="demo-head">
      <div><span class="demo-eyebrow">DIGITAL TWIN SANDBOX</span><h2>设备演示舱</h2></div>
      <span class="demo-state" :class="{ paused: !running }"><i></i>{{ running ? '演示运行中' : '演示已暂停' }}</span>
    </header>

    <div class="demo-meta"><span>LOCAL SIMULATION</span><b>本地交互 · 非现场数据</b></div>

    <div class="demo-scene" :class="{ paused: !running, fast: speed === 2 }">
      <svg viewBox="0 0 460 285" aria-label="可点击的码垛机械手、输送线与 AGV">
        <defs>
          <linearGradient id="demoFloor" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#19384b"/><stop offset="1" stop-color="#0b1e2d"/></linearGradient>
          <linearGradient id="demoArm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#70e4f4"/><stop offset="1" stop-color="#3484ac"/></linearGradient>
          <filter id="demoGlow"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <path class="demo-floor" d="M32 206 220 98 432 201 244 285Z" fill="url(#demoFloor)"/>
        <g class="demo-grid">
          <path d="M55 206 244 105M82 221 271 120M110 235 299 134M138 249 327 148M166 264 355 162M194 278 383 176"/>
          <path d="M70 185 282 265M101 166 313 246M132 148 344 227M163 129 375 208M194 110 406 189"/>
        </g>
        <g class="demo-rack">
          <path d="M301 68h108v80H301zM301 92h108M301 116h108M301 140h108M327 68v80M355 68v80M383 68v80"/>
          <path d="M307 99h14v11h-14zM333 99h16v11h-16zM361 99h16v11h-16zM389 99h14v11h-14zM307 123h14v11h-14zM361 123h16v11h-16z"/>
        </g>
        <path class="demo-route" d="M64 231 135 192 177 210 111 251"/>

        <g class="demo-equipment demo-conveyor" :class="{ selected: selected === 'conveyor' }" role="button" tabindex="0" aria-label="选择物料输送线" @click="select('conveyor')" @keydown.enter.prevent="select('conveyor')" @keydown.space.prevent="select('conveyor')">
          <path class="conveyor-base" d="M52 164 129 119 195 152 118 198Z"/>
          <path class="conveyor-side" d="M52 164v12l66 36v-14M118 198v14l77-46v-14"/>
          <g class="conveyor-rollers">
            <path d="M64 164 133 125M77 171 146 132M90 178 159 139M103 185 172 146"/>
          </g>
          <g class="demo-box"><path d="M92 151 110 141 128 151 110 162Z"/><path d="M92 151v15l18 10 18-10v-15M110 162v14"/></g>
          <path class="demo-point" d="M117 117v-17h29"/>
          <text x="149" y="102">CV-02</text>
        </g>

        <g class="demo-equipment demo-robot" :class="{ selected: selected === 'robot' }" role="button" tabindex="0" aria-label="选择码垛机械手" @click="select('robot')" @keydown.enter.prevent="select('robot')" @keydown.space.prevent="select('robot')">
          <path class="robot-platform" d="M213 202 267 172 315 199 261 231Z"/>
          <path class="robot-base" d="M235 197 265 180 292 195 262 213Z"/>
          <ellipse class="robot-joint" cx="264" cy="187" rx="12" ry="7"/>
          <g class="demo-robot-arm">
            <path class="robot-link" d="M264 184 300 112"/>
            <path class="robot-link-core" d="M264 184 300 112"/>
            <circle class="robot-joint" cx="301" cy="111" r="8"/>
            <path class="robot-link" d="M298 106 247 80"/>
            <path class="robot-link-core" d="M298 106 247 80"/>
            <circle class="robot-joint" cx="245" cy="80" r="7"/>
            <path class="robot-gripper" d="M240 84v17M250 84v17M236 101h18M236 101v7M254 101v7"/>
            <path class="robot-load" d="M230 108 245 100 260 108 245 116ZM230 108v14l15 8 15-8v-14M245 116v14"/>
          </g>
          <path class="demo-point" d="M302 91 332 58h32"/>
          <text x="335" y="53">R01</text>
        </g>

        <g class="demo-equipment demo-agv" :class="{ selected: selected === 'agv' }" role="button" tabindex="0" aria-label="选择托盘搬运 AGV" @click="select('agv')" @keydown.enter.prevent="select('agv')" @keydown.space.prevent="select('agv')">
          <g class="demo-agv-vehicle">
            <path class="agv-body" d="M72 225 108 204 145 224 109 246Z"/>
            <path class="agv-top" d="M84 216 108 202 132 215 108 230Z"/>
            <path class="agv-cargo" d="M90 207 108 197 126 207 108 217ZM90 207v13l18 9 18-9v-13M108 217v12"/>
            <circle class="agv-wheel" cx="91" cy="236" r="3"/><circle class="agv-wheel" cx="123" cy="231" r="3"/>
          </g>
          <path class="demo-point" d="M100 251v15h-35"/>
          <text x="45" y="273">AGV-03</text>
        </g>
        <g class="demo-signals"><path d="M196 141 219 126M319 173l20-12M153 219l20-12"/></g>
      </svg>
      <span class="demo-live-chip">LIVE DEMO</span>
      <span class="demo-scan-line" aria-hidden="true"></span>
    </div>

    <div class="demo-selection">
      <div class="demo-selection-main"><span>{{ current.code }} / SELECTED</span><h3>{{ current.name }}</h3><p>{{ current.description }}</p></div>
      <dl><div><dt>{{ current.metric }}</dt><dd>{{ current.value }}<small>{{ current.unit }}</small></dd></div><div><dt>演示倍率</dt><dd>{{ speed }}<small>×</small></dd></div></dl>
    </div>

    <div class="demo-equipment-tabs" role="group" aria-label="选择演示设备">
      <button v-for="item in equipment" :key="item.id" type="button" :class="{ on: selected === item.id }" @click="select(item.id)"><i></i>{{ item.short }}</button>
    </div>

    <div class="demo-controls">
      <button type="button" class="demo-play" @click="running = !running"><span>{{ running ? 'Ⅱ' : '▶' }}</span>{{ running ? '暂停演示' : '运行演示' }}</button>
      <button type="button" @click="speed = speed === 1 ? 2 : 1">倍率 {{ speed }}×</button>
      <button type="button" @click="reset">重置</button>
    </div>
    <footer class="demo-foot"><i></i>仅用于界面交互体验，不连接 PLC，不代表现场状态</footer>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';

const running = ref(true);
const speed = ref(1);
const selected = ref('robot');
const INITIAL_TICK = 132;
const tick = ref(INITIAL_TICK);

const equipment = [
  { id: 'robot', short: '机械手', code: 'R01', name: '码垛机械手', description: '关节联动与夹爪取放演示', metric: '码垛循环', unit: '次', value: () => Math.floor(tick.value / 16) },
  { id: 'conveyor', short: '输送线', code: 'CV-02', name: '物料输送线', description: '托盘沿滚筒输送线连续移动', metric: '输送托盘', unit: '件', value: () => Math.floor(tick.value / 12) },
  { id: 'agv', short: 'AGV', code: 'AGV-03', name: '托盘搬运 AGV', description: '沿规划路径往复搬运演示', metric: '路径往返', unit: '次', value: () => Math.floor(tick.value / 20) }
];
const current = computed(() => {
  const item = equipment.find(entry => entry.id === selected.value) || equipment[0];
  return { ...item, value: item.value() };
});
const select = id => { selected.value = id; };
const reset = () => { tick.value = INITIAL_TICK; selected.value = 'robot'; speed.value = 1; running.value = true; };
const timer = window.setInterval(() => { if (running.value) tick.value += speed.value; }, 250);
onBeforeUnmount(() => window.clearInterval(timer));
</script>
