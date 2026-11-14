<template>
  <div class="scene-tools">
    <div class="scene-caption" id="sceneCaption"></div>
    <div class="scene-options">
      <button type="button" id="inspectCrane" title="查看堆垛机的轮组、立柱和升降机构">堆垛机特写</button>
      <button type="button" id="inspectRack" title="隐藏货物并查看货架钢结构">货架结构</button>
      <button type="button" id="inspectConveyor" title="查看滚筒、链传动、驱动电机和支腿">输送线特写</button>
      <label><input type="checkbox" id="showInventory" checked>货物</label>
      <label><input type="checkbox" id="showDeviceLabels">编号</label>
    </div>
  </div>

  <div class="render-toolbar" aria-label="场景显示设置">
    <label for="qualitySelector">画质</label>
    <select id="qualitySelector">
      <option value="performance">流畅</option>
      <option value="balanced" selected>均衡</option>
      <option value="high">精细</option>
    </select>
    <label class="environment-toggle"><input type="checkbox" id="showEnvironment" checked>厂房环境</label>
    <span id="renderStats">场景加载中</span>
  </div>

  <div class="footer-note">左键旋转 · 滚轮缩放 · 右键平移 <span>设备运动 · 仿真</span></div>
</template>

<script setup>
// 场景工具条：画质、环境开关与特写入口，事件由 twin-scene.js 绑定。
</script>
