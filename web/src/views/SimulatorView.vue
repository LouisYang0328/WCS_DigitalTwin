<template>
  <!-- 结构与样式沿用原静态模拟器页（assets/css/simulator.css 已加 .eng-simulator 作用域），
       交互由 assets/js/simulator-page.js 工厂驱动；顶栏导航由统一的 TopBar 提供。 -->
  <div class="eng-simulator">
    <main>
      <div class="page-status"><span class="service" id="service"><i></i><span id="serviceText">正在连接网关</span></span></div>
      <div class="title-row">
        <div><div class="eyebrow">LOCAL S7 LAB · TC01–TC05 / CV01–CV02</div><h1>输入信号，看见现场变化</h1><p class="subtitle">五台堆垛机与两层输送线独立模拟，通过真实 S7 连接读取数据并联动三维展示。</p></div>
        <a class="primary view-link" id="viewTwin" href="index.html?equipment=TC01" target="wcs-twin" rel="noopener">查看三维效果 <span aria-hidden="true">↗</span></a>
      </div>
      <div class="signal-flow" aria-label="信号链路"><span><b>01</b> 输入模拟 PLC 数据</span><i>→</i><span><b>02</b> 网关经 S7/TCP 读回</span><i>→</i><span><b>03</b> <span id="flowEquipment">TC01</span> 三维展示</span><em>仅监听本机 127.0.0.1</em></div>
      <section class="fleet-section" aria-label="选择模拟 PLC">
        <div class="fleet-header"><div><strong>堆垛机与输送线 · 独立模拟</strong><span>CV01 对应 1F，CV02 对应 2F；切换设备与机段时保留输入草稿。</span></div><div class="fleet-actions"><label for="allMode">全部运行模式</label><select id="allMode"><option value="auto">自动演示</option><option value="manual">手动输入</option></select><button class="primary" id="connectAllButton" type="button" disabled>全部启动并连接网关</button></div></div>
        <div class="equipment-tabs" id="equipmentTabs" role="tablist" aria-label="模拟 PLC 设备"></div>
        <p class="fleet-result" id="fleetResult" role="status" hidden></p>
      </section>
      <div class="page-error" id="pageError" role="alert" hidden></div>
      <section class="metrics" aria-label="模拟 PLC 运行状态">
        <div class="metric"><span>监听状态</span><b id="listenerState">等待服务</b><small id="listenerEndpoint">127.0.0.1:1102</small></div>
        <div class="metric"><span>S7 客户端连接</span><b id="clientCount">--</b><small>实际 TCP 会话数</small></div>
        <div class="metric"><span>累计 S7 读取</span><b id="readCount">--</b><small>已响应的 DB 读取请求</small></div>
        <div class="metric"><span>最近 S7 读取</span><b class="time-value" id="lastReadAt">--</b><small>无请求时保持上次时间</small></div>
      </section>
      <div class="workspace">
        <aside class="sidebar">
          <section class="card">
            <div class="card-head"><h2><span id="selectedEquipment">TC01</span> 连接设置</h2><span class="label-pill">本地模拟</span></div>
            <div class="card-body">
              <div class="endpoint-display"><span>PLC IP</span><strong>127.0.0.1</strong></div>
              <label class="field" for="port"><span>TCP 端口</span><input id="port" type="number" value="1102" min="1" max="65535" step="1" required inputmode="numeric"><small id="portHint">默认 1102；各设备使用独立端口。</small></label>
              <div class="connection-spec"><span>CPU <b>S7-1200</b></span><span>Rack / Slot <b>0 / 0</b></span><span>数据块 <b id="dbSpec">DB2000</b></span><span>起始 / 长度 <b id="byteSpec">0 / 70 B</b></span></div>
              <div class="button-row"><button class="secondary" id="startButton" type="button" disabled>启动监听</button><button class="danger" id="stopButton" type="button" disabled>停止</button></div>
              <button class="primary connect-button" id="connectButton" type="button" disabled>一键启动并连接网关</button>
              <p class="note">创建或启用 <b id="selectedDeviceName">TC01-SIM</b> 本地设备。连接成功与数据质量以右侧的网关读回为准。</p>
            </div>
          </section>
          <section class="card">
            <div class="card-head"><h2>信号模式</h2><span id="modeCaption">--</span></div>
            <div class="card-body">
              <div class="mode-switch" role="group" aria-label="信号模式"><button id="manualButton" type="button" aria-pressed="false" disabled>手动输入</button><button id="autoButton" type="button" aria-pressed="false" disabled>自动演示</button></div>
              <p class="note" id="modeNote">手动模式保持输入值；自动演示周期性改变坐标、模式与报警。</p>
              <button class="secondary reset-button" id="resetButton" type="button" disabled>恢复初始值</button>
            </div>
          </section>
          <div class="range-note" id="rangeNote"><strong>三维位置参考</strong><p>行走：700–39300 mm<br>提升：700–19300 mm<br>货叉中位：5000 mm</p><span>模型对行走、提升位置限幅；原始点位读回保留输入值。货叉位置在信号卡中展示。</span></div>
          <div class="range-note" id="conveyorStateNote" hidden><strong>输送线模拟约定</strong><p>状态：0 停止 · 1 运行<br>2 报警 · 3 离线<br>占位：0 无货 · 1 有货</p><span>未知状态值仍保留读回，模型不作为运行状态。托盘条码最多 10 个 ASCII 字符，保留前导零。</span></div>
        </aside>
        <section class="card editor-card">
          <div class="card-head"><div><h2 id="editorTitle">PLC 点位输入</h2><p id="editorCaption">DB2000 · 29 个反馈点 · S7 大端字节</p></div><span class="draft-pill" id="draftBadge">已同步</span></div>
          <div class="conveyor-picker" id="conveyorPicker" hidden><div class="conveyor-picker-controls"><label for="conveyorSearch">输送设备编号</label><input id="conveyorSearch" type="search" placeholder="搜索，例如 1001" autocomplete="off"><select id="conveyorSelect" aria-label="选择输送设备编号"></select></div><p id="conveyorMappingNote"></p></div>
          <form id="valuesForm" novalidate>
            <div class="preset-bar"><span>填入示例</span><button class="text-button" type="button" data-preset="normal" disabled>正常自动</button><button class="text-button" type="button" data-preset="alarm" disabled>报警 1001</button><button class="text-button" type="button" data-preset="position" disabled>移动到演示位置</button></div>
            <div class="table-wrap"><table class="tag-table"><thead><tr><th>信号 / DB 地址</th><th>模拟当前值</th><th>输入值</th><th>网关读回</th></tr></thead><tbody id="keyTagRows"><tr><td colspan="4" class="empty">正在加载点位…</td></tr></tbody></table></div>
            <details class="more-tags" id="moreTags"><summary>其他反馈点位 <span id="moreTagCount"></span></summary><div class="table-wrap"><table class="tag-table"><thead><tr><th>信号 / DB 地址</th><th>模拟当前值</th><th>输入值</th><th>网关读回</th></tr></thead><tbody id="otherTagRows"></tbody></table></div></details>
            <div class="editor-footer"><div><strong id="draftText">输入点位后，点击应用写入模拟 PLC。</strong><p>应用输入值会切换为手动模式。网关通常在 500 ms 内读回。</p></div><div class="submit-buttons"><button class="secondary" id="syncButton" type="button" disabled>同步当前值</button><button class="primary" id="applyButton" type="submit" disabled>应用输入值</button></div></div>
          </form>
        </section>
        <aside class="readback-column">
          <section class="card readback-card">
            <div class="card-head"><h2>网关真实读回</h2><span class="quality-badge" id="gatewayQuality">未连接</span></div>
            <div class="card-body">
              <div class="readback-source"><b id="gatewayName">等待连接 TC01-SIM</b><span id="gatewayEndpoint">S7/TCP → 网关 → 当前页面</span></div>
              <p class="readback-message" id="gatewayMessage">点击“一键启动并连接网关”，验证数据是否经过 S7 正常读取。</p>
              <div class="readback-values" id="readbackValues"><div><span>运行模式</span><strong data-readback="PLC_PATTERN">--</strong></div><div><span>当前故障</span><strong data-readback="PLC_ERROR">--</strong></div><div><span>准备就绪</span><strong data-readback="PLC_DISPATCH">--</strong></div><div><span>载货台</span><strong data-readback="PLC_VANSTATE">--</strong></div><div><span>行走位置</span><strong data-readback="PLC_LOCATX">--</strong></div><div><span>提升位置</span><strong data-readback="PLC_LOCATY">--</strong></div><div><span>货叉位置</span><strong data-readback="PLC_LOCATZ">--</strong></div><div><span>当前任务号</span><strong data-readback="PLC_TASKNO">--</strong></div></div>
              <div class="readback-time">最近成功 <span id="gatewayLastRead">--</span></div>
              <a class="secondary readback-link" id="deviceLink" href="/devices">查看设备与全部点位 →</a>
            </div>
          </section>
          <div class="howto"><span>操作提示</span><ol><li>启动当前设备，或全部启动并连接网关。</li><li>输入状态、坐标或条码，应用输入值。</li><li>确认网关读回正常后，查看三维效果。</li></ol><p>停止模拟 PLC 后，网关会显示断连或失效。手动输入值在本次网关运行期间保留。</p></div>
        </aside>
      </div>
    </main>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted } from 'vue';
import '../../../assets/css/simulator.css';
import '../../../assets/js/api-client.js';
import '../../../assets/js/simulator-page.js';

let destroy = null;
onMounted(() => { destroy = window.WcsPages.initSimulator(); });
onBeforeUnmount(() => { destroy?.(); destroy = null; });
</script>

<style>
/* 网关状态指示从原静态页顶栏移到内容区右上角。 */
.eng-simulator .page-status { display: flex; justify-content: flex-end; margin-bottom: 8px; }
</style>
