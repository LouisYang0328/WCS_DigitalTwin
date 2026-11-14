<template>
  <!-- 结构与样式沿用原静态设备页（assets/css/devices.css 已加 .eng-devices 作用域），
       交互由 assets/js/devices-page.js 工厂驱动；顶栏导航由统一的 TopBar 提供。 -->
  <div class="eng-devices">
    <main>
      <div class="page-status"><span class="service" id="service"><span class="dot"></span><span id="serviceText">正在连接网关</span></span></div>
      <div class="title-row"><div><div class="eyebrow">PLC Communication Gateway</div><h1>设备连接管理</h1><p class="subtitle">选择协议与点位模板，填写设备地址，即可按配置读取设备信号。</p></div><div class="readonly">● 只读监控 · 不写 PLC</div></div>
      <div class="flow"><span>浏览器</span><span class="arrow">→ HTTP →</span><b>采集网关</b><span class="arrow">→ 每台设备单连接 →</span><b>多个读取块</b><span class="note">S7 / Modbus TCP · 按块计时 · 独立错误 · 单块故障不影响其他块</span></div>
      <section class="metrics">
        <div class="metric"><span class="label">PLC 设备</span><span class="value" id="totalCount">0</span></div>
        <div class="metric"><span class="label">已连接设备</span><span class="value green" id="onlineCount">0</span></div>
        <div class="metric"><span class="label">数据读取块</span><span class="value" id="blockCount">0</span></div>
        <div class="metric"><span class="label">异常读取块</span><span class="value red" id="faultCount">0</span></div>
      </section>
      <div class="layout">
        <section class="card" id="editorCard">
          <div class="card-head"><h2 id="formTitle">新增 PLC 设备</h2><span class="mode-badge" id="formMode">新增</span></div>
          <div class="card-body">
            <form id="deviceForm">
              <div class="form-grid">
                <div class="field full"><label for="protocol">协议类型</label><select id="protocol" name="protocol" aria-describedby="protocolHint"><option value="s7">Siemens S7</option><option value="modbus-tcp">Modbus TCP</option></select><span class="hint" id="protocolHint">选择设备通信协议；后续协议由网关统一下发。</span></div>
                <div class="field full"><label for="name">设备名称</label><input id="name" name="name" value="TC01" maxlength="40" required autocomplete="off"></div>
                <div class="field full"><label for="ipAddress">设备 IP 地址</label><input id="ipAddress" name="ipAddress" placeholder="例如 192.168.0.10" required autocomplete="off" inputmode="decimal"></div>
                <div class="field full"><label for="profileSelect">点位模板</label><div class="profile-controls"><select id="profileSelect" disabled aria-describedby="profileHint"><option>正在加载模板…</option></select><button class="secondary" id="applyProfile" type="button" disabled>应用到首个块</button></div><span class="hint" id="profileHint">模板由网关配置统一加载，按字节布局解析，同样适用于 Modbus 寄存器数据。</span></div>
                <div class="field"><label for="port">端口</label><input id="port" name="port" type="number" value="102" min="1" max="65535" required><span class="hint" id="portHint"></span></div>
                <div class="field" data-protocol-field="s7"><label for="cpuType">CPU 类型</label><select id="cpuType" name="cpuType"><option>S7-1200</option><option>S7-1500</option><option>S7-300</option><option>S7-400</option><option>S7-200</option></select></div>
                <div class="field" data-protocol-field="modbus-tcp" hidden><label for="unitId">站地址 Unit ID</label><input id="unitId" name="unitId" type="number" value="1" min="0" max="255"></div>
                <div class="field" data-protocol-field="s7"><label for="rack">机架 Rack</label><input id="rack" name="rack" type="number" value="0" min="0" max="7" required></div>
                <div class="field" data-protocol-field="s7"><label for="slot">插槽 Slot</label><input id="slot" name="slot" type="number" value="0" min="0" max="31" required><span class="hint" id="slotHint">S7-1200 通常 Rack 0 / Slot 0</span></div>
              </div>
              <div class="section-label"><b>数据读取块</b><span id="editorBlockCount">1 个块</span><button class="add-block" id="addBlock" type="button">+ 添加读取块</button></div>
              <div id="blockEditors"></div>
              <div class="form-actions"><button class="primary" id="saveButton" type="submit">保存并连接</button><button class="secondary" id="cancelEdit" type="button" hidden>取消编辑</button></div>
              <p class="form-note">同一协议 + 网络参数（S7 含 Rack/Slot，Modbus 含站地址）只建立一条长连接，可挂载多个读取块。配置在服务重启后自动恢复；监控保持只读，不写入 PLC。</p>
            </form>
          </div>
        </section>
        <div class="stack">
          <section class="card">
            <div class="card-head"><h2>设备连接状态</h2><span id="tableCaption">0 台设备</span></div>
            <div class="table-wrap"><table><thead><tr><th>设备</th><th>网络参数</th><th>读取块</th><th>状态</th><th>最近读取</th><th style="text-align:right">操作</th></tr></thead><tbody id="deviceRows"><tr><td colspan="6" class="empty">正在读取设备配置…</td></tr></tbody></table></div>
            <div class="legend"><span><b>连接失败排查：</b>S7 放行 TCP 102 并确认 Rack/Slot（1200/1500 需允许 PUT/GET，DB 非优化访问）；Modbus TCP 放行 TCP 502 并确认站地址与数据区地址映射。</span></div>
          </section>
          <section class="card">
            <div class="card-head detail-head"><div class="detail-title"><h2 id="detailTitle">选择一个设备</h2><span class="endpoint-chip" id="detailEndpoint">--</span></div><div class="detail-state"><span class="badge offline" id="detailState">未选择</span><span id="detailUpdated" class="hint"></span></div></div>
            <div class="block-tabs" id="blockTabs"><div class="tag-empty">选择设备后显示读取块</div></div>
            <div class="detail-body" id="blockDetail"><div class="tag-empty">在设备列表选择一台设备，查看各读取块的实时数据。</div></div>
          </section>
        </div>
      </div>
    </main>
    <div class="toast" id="toast" role="status"></div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted } from 'vue';
import '../../../assets/css/devices.css';
import '../../../assets/js/api-client.js';
import '../../../assets/js/devices-page.js';

let destroy = null;
onMounted(() => { destroy = window.WcsPages.initDevices(); });
onBeforeUnmount(() => { destroy?.(); destroy = null; });
</script>

<style>
/* 网关状态指示从原静态页顶栏移到内容区右上角。 */
.eng-devices .page-status { display: flex; justify-content: flex-end; margin-bottom: 8px; }
</style>
