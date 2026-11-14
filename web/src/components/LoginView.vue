<template>
  <main class="login-shell industrial-login">
    <div class="login-atmosphere" aria-hidden="true">
      <div class="login-blueprint-grid"></div>
      <svg class="warehouse-elevation" viewBox="0 0 1440 820" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="rackStroke" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#8fa8ae" stop-opacity=".34"/>
            <stop offset=".55" stop-color="#6d878e" stop-opacity=".18"/>
            <stop offset="1" stop-color="#516a72" stop-opacity=".05"/>
          </linearGradient>
          <linearGradient id="beamStroke" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#f2be54" stop-opacity=".42"/>
            <stop offset="1" stop-color="#b7832a" stop-opacity=".08"/>
          </linearGradient>
        </defs>
        <g class="warehouse-ceiling">
          <path d="M-60 75H1500M-20 115H1460M30 152H1420"/>
          <path d="M90 75 130 152M310 75 350 152M530 75 570 152M750 75 790 152M970 75 1010 152M1190 75 1230 152M1410 75 1450 152"/>
          <path d="M-40 180H1480"/>
        </g>
        <g class="warehouse-lights">
          <path d="M240 115v34M520 115v34M800 115v34M1080 115v34M1360 115v34"/>
          <path d="M210 149h60M490 149h60M770 149h60M1050 149h60M1330 149h60"/>
          <ellipse cx="240" cy="162" rx="80" ry="8"/><ellipse cx="520" cy="162" rx="80" ry="8"/>
          <ellipse cx="800" cy="162" rx="80" ry="8"/><ellipse cx="1080" cy="162" rx="80" ry="8"/>
        </g>
        <g class="warehouse-racks" fill="none" stroke="url(#rackStroke)">
          <path d="M70 235v420M740 235v420M80 260h660M80 340h660M80 420h660M80 500h660M80 575h660M80 650h660"/>
          <path d="M150 235v420M225 235v420M300 235v420M375 235v420M450 235v420M525 235v420M600 235v420M675 235v420"/>
          <path d="M125 282h50M200 282h50M275 282h50M350 282h50M425 282h50M500 282h50M575 282h50M650 282h50"/>
          <path d="M125 362h50M200 362h50M275 362h50M350 362h50M425 362h50M500 362h50M575 362h50M650 362h50"/>
          <path d="M125 442h50M200 442h50M275 442h50M350 442h50M425 442h50M500 442h50M575 442h50M650 442h50"/>
          <path d="M125 522h50M200 522h50M275 522h50M350 522h50M425 522h50M500 522h50M575 522h50M650 522h50"/>
          <path d="M125 602h50M200 602h50M275 602h50M350 602h50M425 602h50M500 602h50M575 602h50M650 602h50"/>
        </g>
        <g class="warehouse-crane">
          <path d="M72 214h670M90 188h634" fill="none" stroke="url(#beamStroke)"/>
          <path d="M208 188v-44h28v44M241 188v-44h28v44" fill="none"/>
          <path d="M228 188v108h20V188M226 296h24" fill="none"/>
          <rect x="213" y="296" width="50" height="20" fill="none"/>
          <path d="M218 316v62M258 316v62M218 378h40" fill="none"/>
        </g>
        <g class="warehouse-floor" fill="none">
          <path d="M-40 660H1480M40 700H1440"/>
          <path d="M104 660 18 820M670 660 575 820M810 660 905 820M1380 660 1470 820"/>
          <path d="M260 660 188 820M560 660 512 820M918 660 966 820M1220 660 1292 820"/>
        </g>
        <g class="warehouse-zone">
          <path d="M760 250h430v390H760zM780 270h390v350H780z"/>
          <path d="M820 350h310M820 440h310M820 530h310M920 270v350M1040 270v350M1160 270v350"/>
          <text x="786" y="238">ZONE B / 02F</text>
          <text x="84" y="228">ZONE A / 01F · HIGH-BAY</text>
        </g>
        <g class="handling-cell" transform="translate(-170 0)">
          <path class="cell-rail" d="M780 596h330M800 578v44M1080 578v44"/>
          <path class="conveyor-frame" d="M810 552h175v34H810zM820 586v22M970 586v22"/>
          <path class="conveyor-line" d="M824 552v34M840 552v34M856 552v34M872 552v34M888 552v34M904 552v34M920 552v34M936 552v34M952 552v34M968 552v34"/>
          <path class="conveyor-roller" d="M832 560h4M848 560h4M864 560h4M880 560h4M896 560h4M912 560h4M928 560h4M944 560h4M960 560h4"/>
          <path class="pallet" d="M844 535h54v18h-54zM850 529h42v6h-42M848 553v7M892 553v7"/>
          <path class="carton" d="M853 502h36v27h-36zM853 511h36M866 502v27"/>
          <path class="robot-base" d="M1002 587h78v20h-78zM1015 579h50v8h-50z"/>
          <circle class="robot-joint" cx="1040" cy="570" r="12"/>
          <path class="robot-arm arm-lower" d="M1040 567 1088 447"/>
          <path class="robot-inner" d="M1039 561 1080 458"/>
          <circle class="robot-joint" cx="1089" cy="445" r="10"/>
          <path class="robot-arm arm-upper" d="M1082 439 980 472"/>
          <path class="robot-inner" d="M1076 445 987 475"/>
          <circle class="robot-joint wrist" cx="978" cy="474" r="8"/>
          <path class="robot-wrist" d="M972 478v22M984 478v22M968 500h20M968 500v9M988 500v9"/>
          <path class="robot-cable" d="M1040 570c-18-20 22-48 11-86s-18-24-17-39"/>
          <path class="robot-cell" d="M792 592h318v9H792z"/>
          <path class="equipment-dims" d="M812 568v76M1088 568v76M812 630h276M812 624v12M1088 624v12"/>
          <g class="agv">
            <path d="M1100 555h104v29h-104zM1111 546h80v9h-80z"/>
            <path d="M1116 584v8M1186 584v8"/>
            <circle cx="1124" cy="591" r="5"/><circle cx="1180" cy="591" r="5"/>
            <path d="M1117 559h16v18h-16zM1142 559h16v18h-16z"/>
          </g>
        </g>
        <g class="warehouse-scan"><path d="M0 470h1440"/></g>
      </svg>
      <div class="industrial-glow"></div>
      <div class="hazard-rail"></div>
      <span class="scene-coordinate coord-a">X 127.004</span>
      <span class="scene-coordinate coord-b">Y 030.842</span>
      <span class="scene-coordinate coord-c">AISLE / A01—A05</span>
      <span class="equipment-tag equipment-robot"><i></i><b>R01</b> 码垛机械手</span>
      <span class="equipment-tag equipment-conveyor"><i></i><b>CV</b> 物料输送线</span>
      <span class="equipment-tag equipment-agv"><i></i><b>AGV</b> 托盘搬运</span>
    </div>

    <section class="login-intro industrial-intro">
      <header class="login-brand">
        <span class="industrial-logo"><i></i><i></i><i></i></span>
        <span class="brand-lockup"><b>WCS</b><small>DIGITAL TWIN / 数字孪生</small></span>
        <em class="brand-divider"></em>
        <span class="brand-plant">智能仓储控制中心</span>
      </header>

      <div class="intro-system-line">
        <span><i class="signal-dot"></i>系统待授权</span>
        <span>S7 · MODBUS TCP</span>
        <span>READ ONLY</span>
      </div>

      <div class="intro-workspace">
        <div class="intro-content">
          <div class="login-copy industrial-copy">
            <span class="login-eyebrow"><i></i>WAREHOUSE CONTROL SYSTEM / 01</span>
            <h1>让仓储运行<br><span>清晰可见</span></h1>
            <p>连接现场设备与业务视图，统一呈现堆垛机、输送线、库位任务与告警状态。每一层库区、每一条链路，都在同一张数字现场中持续同步。</p>
          </div>

          <div class="industrial-specs" aria-label="系统范围">
            <div><small>FLOORS</small><b>02</b><span>双层库区</span></div>
            <div><small>AISLES</small><b>05</b><span>巷道区域</span></div>
            <div><small>DEVICES</small><b>07</b><span>采集节点</span></div>
            <div class="spec-live"><small>LINK</small><b class="spec-link">S7</b><span>只读监控</span></div>
          </div>

          <div class="intro-channels" aria-label="系统接入能力">
            <div><span class="ch-tag">PLC</span><b>S7 直连采集</b><small>只读读取，不向现场写回</small></div>
            <div><span class="ch-tag">BUS</span><b>实时数据总线</b><small>库位与任务状态持续同步</small></div>
            <div><span class="ch-tag">DB</span><b>权限与审计</b><small>会话留痕，三级角色管理</small></div>
            <div><span class="ch-tag">RBAC</span><b>客户视图隔离</b><small>仅开放整体视图与看板</small></div>
          </div>

          <div class="intro-track">
            <span class="track-code">SYS / WCS-DT-01</span>
            <span class="track-line"><i></i></span>
            <span class="track-label">AUTHORIZED PERSONNEL ONLY</span>
          </div>
        </div>
        <LoginEquipmentDemo />
      </div>

      <footer class="industrial-footer">
        <span>01F · 02F STORAGE</span><span>TC01—TC05</span><span>CV01—CV02</span>
        <b>SAFETY FIRST / 安全生产</b>
      </footer>
    </section>

    <section class="login-form-wrap industrial-access">
      <div class="access-topline"><span>WCS / CONTROL ACCESS</span><b>SECURE CHANNEL · SESSION AUDIT</b></div>
      <div class="access-frame">
        <span class="frame-bolt bolt-tl"></span><span class="frame-bolt bolt-tr"></span>
        <span class="frame-bolt bolt-bl"></span><span class="frame-bolt bolt-br"></span>
        <div class="access-hazard"></div>
        <div class="access-code">ACCESS PANEL <b>02</b></div>
        <form class="login-card industrial-card" @submit.prevent="submit">
          <div class="control-label">
            <span class="control-led"></span>
            <span>操作授权</span>
            <small>CONTROL ACCESS</small>
          </div>
          <h2>进入数字现场</h2>
          <p>请使用已分配权限的账号登录控制台</p>
          <div class="access-rule"><i></i><span>AUTHORIZATION REQUIRED</span></div>

          <label>操作员账号
            <div class="login-input">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>
              <input v-model.trim="username" autocomplete="username" maxlength="32" required autofocus placeholder="请输入账号">
              <span class="input-code">ID</span>
            </div>
          </label>
          <label>访问密码
            <div class="login-input">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></svg>
              <input v-model="password" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" required placeholder="请输入密码">
              <button class="password-toggle" type="button" :aria-label="showPassword ? '隐藏密码' : '显示密码'" @click="showPassword = !showPassword">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>
              </button>
            </div>
          </label>

          <div v-if="message" class="login-error industrial-error" role="alert"><i></i><span>{{ message }}</span></div>

          <button class="login-submit industrial-submit" type="submit" :disabled="busy">
            <span class="submit-led"></span>
            <b>{{ busy ? '正在校验身份' : '进入控制台' }}</b>
            <span class="submit-arrow">{{ busy ? '···' : '→' }}</span>
          </button>

          <div class="access-security">
            <span><i></i>会话审计</span><span><i></i>最小权限</span><span><i></i>链路加密</span>
          </div>
        </form>
        <div class="access-bottom-code">
          <span>RBAC // AUTH-02</span><b>AUTHORIZED ACCESS ONLY</b><span>2026</span>
        </div>
      </div>
      <p class="access-support">如无法登录，请联系系统管理员核对账号状态与访问权限。</p>
    </section>
  </main>
</template>

<script setup>
import { ref } from 'vue';
import { auth, login } from '../store/auth';
import LoginEquipmentDemo from './LoginEquipmentDemo.vue';

const username = ref('');
const password = ref('');
const busy = ref(false);
const message = ref('');
const showPassword = ref(false);

async function submit() {
  busy.value = true;
  message.value = '';
  try { await login(username.value, password.value); }
  catch (error) { message.value = error.message; }
  finally { busy.value = false; }
  if (auth.error && !message.value) message.value = auth.error;
}
</script>
