/* 模拟 PLC 控制页逻辑：SPA 的 SimulatorView 挂载时调用，返回销毁函数（清定时器与全局监听）。 */
window.WcsPages = window.WcsPages || {};
window.WcsPages.initSimulator = () => {
  'use strict';

  const $ = id => document.getElementById(id) || stubEl;
  // 视图卸载后所有 id 都取不到，落到这个占位元素上：迟到的异步写操作变成无操作。
  const stubEl = document.createElement('div');
  let destroyed = false;
  const api = window.WcsApi.request;
  const codes = ['TC01', 'TC02', 'TC03', 'TC04', 'TC05', 'CV01', 'CV02'];
  const requestedCode = new URLSearchParams(window.location.search).get('equipment');
  const requestedConveyor = new URLSearchParams(window.location.search).get('conveyor');
  const entries = new Map(codes.map((code, index) => [code, { snapshot: null, draft: new Map(), portDraft: null, defaultPort: 1102 + index, deviceId: null, devicePort: null, gateway: null, conveyorId: code === requestedCode ? requestedConveyor : null }]));
  const state = { code: codes.includes(requestedCode) ? requestedCode : 'TC01', renderedCode: null, tags: [], busy: false, refreshing: false, revision: 0, online: false };
  const keyNames = ['PLC_PATTERN', 'PLC_ERROR', 'PLC_DISPATCH', 'PLC_VANSTATE', 'PLC_LOCATX', 'PLC_LOCATY', 'PLC_LOCATZ', 'PLC_POSX', 'PLC_POSY', 'PLC_POSZ', 'PLC_TASKNO'];
  const labels = { PLC_PATTERN: '运行模式', PLC_ERROR: '当前故障码', PLC_DISPATCH: '准备就绪 / 可调度', PLC_VANSTATE: '载货台有无货', PLC_LOCATX: '行走位置 · mm', PLC_LOCATY: '提升位置 · mm', PLC_LOCATZ: '货叉位置 · mm', PLC_POSX: '当前排', PLC_POSY: '当前列', PLC_POSZ: '当前层', PLC_TASKNO: '当前任务号' };
  const enums = { PLC_PATTERN: { 1: '自动', 2: '手动', 3: '离线', 4: '维护' }, PLC_DISPATCH: { 0: '不可调度', 1: '可调度' }, PLC_VANSTATE: { 0: '无货', 1: '有货' }, PLC_TASKTYPE: { 1: '入库', 2: '出库', 3: '移库', 4: '站台移动' } };
  const hints = { PLC_PATTERN: '1 自动 · 2 手动 · 3 离线 · 4 维护', PLC_ERROR: '0 无故障 · 例如 1001', PLC_DISPATCH: '0 不可调度 · 1 可调度', PLC_VANSTATE: '0 无货 · 1 有货', PLC_LOCATX: '三维参考 700–39300 mm', PLC_LOCATY: '三维参考 700–19300 mm', PLC_LOCATZ: '5000 mm 为中位' };
  let toastTimer;

  const active = () => entries.get(state.code);
  const isConveyor = () => active().snapshot?.kind === 'conveyor' || state.code.startsWith('CV');
  // 设备 / 机段切换写历史（pushState），Back 键可回退；popstate 应用期间不再回写。
  let applyingPopstate = false;
  function writeUrl(url) {
    if (applyingPopstate) return;
    window.history.pushState(null, '', url);
  }
  const selectedConveyor = () => active().snapshot?.conveyors?.find(item => String(item.id) === active().conveyorId);
  const heartbeatTag = snapshot => snapshot?.tags?.find(tag => /HEART/i.test(tag.name));
  const currentScope = () => state.code + (isConveyor() ? '/' + (active().conveyorId || '') : '');
  const simulatorPath = code => 'api/s7/simulators/' + encodeURIComponent(code);
  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
  function time(value) { if (!value) return '--'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '--' : date.toLocaleTimeString('zh-CN', { hour12: false }); }
  function maxValue(tag) { return tag.dataType === 'UInt32' ? 4294967295 : 65535; }
  function stringTag(tag) { return /^String/i.test(tag.dataType); }
  function tagLabel(tag) {
    if (/PLC_STATUS_STATE_/.test(tag.name)) return '输送状态';
    if (/PLC_STATUS_HASGOODS_/.test(tag.name)) return '机段占位';
    if (/PLC_STATUS_CONTNO_/.test(tag.name)) return '托盘条码';
    return labels[tag.name] || tag.description || tag.name;
  }
  function meaning(name, value) {
    if (/PLC_STATUS_STATE_/.test(name)) return ({ 0: '停止', 1: '运行', 2: '报警', 3: '离线' })[value] || '未知状态 ' + value;
    if (/PLC_STATUS_HASGOODS_/.test(name)) return ({ 0: '无货', 1: '有货' })[value] || '未知占位 ' + value;
    if (name === 'PLC_ERROR') return Number(value) === 0 ? '无故障' : '故障 ' + value;
    return enums[name]?.[value] || '';
  }
  function sourceValue(snapshot, tag) { return snapshot.values?.[tag.name] ?? tag.value ?? 0; }
  function notify(message, error = false) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').className = 'toast show' + (error ? ' error' : ''); toastTimer = setTimeout(() => { $('toast').className = 'toast'; }, 5000); }
  function errorBanner(message) { $('pageError').hidden = !message; $('pageError').textContent = message || ''; }
  function currentRequest(code, revision) { return code === state.code && revision === state.revision; }

  function buildEquipmentTabs() {
    $('equipmentTabs').innerHTML = codes.map(code => `<button class="equipment-tab" id="tab-${code}" type="button" role="tab" aria-selected="false" data-equipment="${code}"><span class="equipment-tab-top"><strong>${code}</strong><small data-fleet-state="${code}">等待服务</small></span><span class="equipment-tab-endpoint" data-fleet-endpoint="${code}">127.0.0.1:${entries.get(code).defaultPort}</span><span class="equipment-tab-foot"><span data-fleet-mode="${code}">--</span><span data-fleet-draft="${code}">独立点位</span></span></button>`).join('');
    for (const button of document.querySelectorAll('[data-equipment]')) button.addEventListener('click', () => switchEquipment(button.dataset.equipment));
    $('equipmentTabs').addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || state.busy) return;
      event.preventDefault();
      let index = codes.indexOf(state.code);
      index = event.key === 'Home' ? 0 : event.key === 'End' ? codes.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + codes.length) % codes.length;
      switchEquipment(codes[index]);
      $('tab-' + codes[index]).focus();
    });
  }

  function renderFleet() {
    for (const code of codes) {
      const entry = entries.get(code), snapshot = entry.snapshot, button = $('tab-' + code);
      button.setAttribute('aria-selected', String(code === state.code));
      button.tabIndex = code === state.code ? 0 : -1;
      button.disabled = state.busy;
      const status = document.querySelector(`[data-fleet-state="${code}"]`);
      status.textContent = !state.online ? '服务未连接' : snapshot?.running ? '监听中' : '已停止';
      status.className = state.online && snapshot?.running ? 'running' : '';
      document.querySelector(`[data-fleet-endpoint="${code}"]`).textContent = `127.0.0.1:${snapshot?.port || entry.defaultPort}`;
      document.querySelector(`[data-fleet-mode="${code}"]`).textContent = snapshot ? (snapshot.mode === 'auto' ? '自动演示' : '手动输入') + (code.startsWith('CV') ? ` · ${snapshot.floor || (code === 'CV01' ? 1 : 2)}F` : ` · ${snapshot.clientCount || 0} 连接`) : '--';
      const draft = document.querySelector(`[data-fleet-draft="${code}"]`);
      draft.textContent = entry.draft.size ? `${entry.draft.size} 项待应用` : '独立点位';
      draft.className = entry.draft.size ? 'pending' : '';
    }
  }

  function storeSnapshot(snapshot) {
    const entry = entries.get(snapshot?.equipmentCode);
    if (!entry) return;
    if (entry.deviceId && entry.devicePort !== null && snapshot.port !== entry.devicePort) {
      entry.deviceId = null;
      entry.devicePort = null;
      entry.gateway = null;
    }
    entry.snapshot = snapshot;
  }

  function renderRows(tags) {
    return tags.map(tag => {
      const name = esc(tag.name), rawAddress = tag.fullAddress || tag.address || '', address = esc(/^DB\d+\./.test(rawAddress) ? rawAddress : `DB${active().snapshot?.dbNumber || (isConveyor() ? 600 : 2000)}.${rawAddress}`);
      const inputType = stringTag(tag) ? 'type="text" maxlength="10" autocomplete="off" spellcheck="false"' : `type="number" min="0" max="${maxValue(tag)}" step="1" required inputmode="numeric"`;
      const hint = stringTag(tag) ? '最多 10 个 ASCII 字符，保留前导零；允许空条码。' : hints[tag.name] || (/PLC_STATUS_STATE_/.test(tag.name) ? '0 停止 · 1 运行 · 2 报警 · 3 离线' : '');
      return `<tr><td><label class="tag-description" for="input-${name}">${esc(tagLabel(tag))}</label><span class="tag-name">${name}</span><span class="tag-address">${address} · ${esc(tag.dataType)}</span></td><td><span class="tag-current" data-current="${name}">--</span><span class="tag-meaning" data-meaning="${name}"></span></td><td><input class="tag-input" id="input-${name}" data-tag="${name}" ${inputType} aria-label="${esc(tagLabel(tag))}输入值"${hint ? ` title="${esc(hint)}"` : ''}></td><td><span class="tag-readback invalid" data-table-readback="${name}">--</span></td></tr>`;
    }).join('');
  }

  function buildInputs(snapshot) {
    const entry = active();
    const segment = selectedConveyor();
    const visibleNames = isConveyor() ? [segment?.stateTag, segment?.hasGoodsTag, segment?.trayCodeTag, heartbeatTag(snapshot)?.name].filter(Boolean) : null;
    state.tags = visibleNames ? visibleNames.map(name => snapshot.tags?.find(tag => tag.name === name)).filter(Boolean) : snapshot.tags || [];
    state.renderedCode = currentScope();
    const byName = new Map(state.tags.map(tag => [tag.name, tag]));
    const key = isConveyor() ? state.tags : keyNames.map(name => byName.get(name)).filter(Boolean);
    const other = isConveyor() ? [] : state.tags.filter(tag => !keyNames.includes(tag.name));
    $('keyTagRows').innerHTML = renderRows(key);
    $('otherTagRows').innerHTML = renderRows(other);
    $('moreTagCount').textContent = `${other.length} 个`;
    $('moreTags').hidden = !other.length;
    for (const input of document.querySelectorAll('[data-tag]')) {
      input.addEventListener('input', () => {
        input.setCustomValidity('');
        input.removeAttribute('aria-invalid');
        entry.draft.set(input.dataset.tag, input.value);
        input.classList.add('dirty');
        renderDraft();
        renderFleet();
      });
    }
  }

  function renderDraft() {
    const count = active().draft.size, visibleCount = state.tags.filter(tag => active().draft.has(tag.name)).length, otherCount = count - visibleCount;
    $('draftBadge').textContent = count ? `${count} 项待应用` : '已同步';
    $('draftBadge').className = 'draft-pill' + (count ? ' dirty' : '');
    $('draftText').textContent = count ? `${state.code}${isConveyor() ? ' / ' + (active().conveyorId || '') : ''} 当前 ${visibleCount} 项待应用。${otherCount ? `其他机段保留 ${otherCount} 项草稿。` : ''}` : `输入点位后，点击应用写入 ${state.code}${isConveyor() ? ' 当前机段' : ' 模拟 PLC'}。`;
  }

  function setButtons() {
    const disabled = state.busy || !state.online || !active().snapshot;
    const running = !!active().snapshot?.running;
    $('port').disabled = disabled || running;
    $('startButton').disabled = disabled || running;
    $('stopButton').disabled = disabled || !running;
    for (const id of ['connectButton', 'manualButton', 'autoButton', 'resetButton', 'applyButton', 'syncButton']) $(id).disabled = disabled;
    $('connectAllButton').disabled = state.busy || !state.online;
    $('allMode').disabled = state.busy || !state.online;
    $('conveyorSearch').disabled = disabled;
    $('conveyorSelect').disabled = disabled;
    for (const button of document.querySelectorAll('[data-preset]')) button.disabled = disabled;
    for (const input of document.querySelectorAll('[data-tag]')) input.disabled = disabled;
    $('connectButton').textContent = state.busy ? '正在操作…' : running ? `连接 ${state.code} 到网关` : '启动当前设备并连接网关';
    $('connectAllButton').textContent = state.busy ? '正在操作…' : '全部启动并连接网关';
    renderFleet();
  }

  function renderSelectionLabels() {
    const entry = active(), name = entry.snapshot?.deviceName || state.code + '-SIM';
    $('selectedEquipment').textContent = state.code;
    $('selectedDeviceName').textContent = name;
    $('flowEquipment').textContent = state.code;
    $('portHint').textContent = `默认 ${entry.defaultPort}；各设备使用独立端口，也可自定义。`;
    const conveyorQuery = isConveyor() && entry.conveyorId ? '&conveyor=' + encodeURIComponent(entry.conveyorId) : '';
    $('viewTwin').href = 'index.html?equipment=' + state.code + conveyorQuery + (entry.deviceId ? '&deviceId=' + encodeURIComponent(entry.deviceId) : '');
    $('dbSpec').textContent = `DB${entry.snapshot?.dbNumber || (isConveyor() ? 600 : 2000)}`;
    $('byteSpec').textContent = `${entry.snapshot?.startAddress || 0} / ${entry.snapshot?.readLength || (isConveyor() ? '--' : 70)} B`;
    $('editorTitle').textContent = isConveyor() ? `输送设备 ${entry.conveyorId || ''} 点位输入` : 'PLC 点位输入';
    $('editorCaption').textContent = isConveyor() ? `${entry.snapshot?.floor || (state.code === 'CV01' ? 1 : 2)}F · DB${entry.snapshot?.dbNumber || 600} · ${entry.snapshot?.conveyors?.length || 0} 个机段 · 按机段编辑` : 'DB2000 · 29 个反馈点 · S7 大端字节';
    $('rangeNote').hidden = isConveyor();
    $('conveyorStateNote').hidden = !isConveyor();
    $('conveyorPicker').hidden = !isConveyor();
    $('resetButton').textContent = isConveyor() ? '恢复整个 PLC 初始值' : '恢复初始值';
    const presetLabels = isConveyor() ? { normal: '运行有货', alarm: '报警停机', position: '空载停止' } : { normal: '正常自动', alarm: '报警 1001', position: '移动到演示位置' };
    for (const button of document.querySelectorAll('[data-preset]')) button.textContent = presetLabels[button.dataset.preset];
    document.title = state.code + ' 本地 S7 模拟 PLC · WCS 数字孪生';
  }

  function renderConveyorOptions() {
    const entry = active(), items = entry.snapshot?.conveyors || [], query = $('conveyorSearch').value.trim();
    const filtered = items.filter(item => String(item.id).includes(query) || String(item.sourceId).includes(query) || String(item.id) === entry.conveyorId);
    $('conveyorSelect').innerHTML = filtered.map(item => `<option value="${esc(item.id)}"${String(item.id) === entry.conveyorId ? ' selected' : ''}>${esc(item.id)}${item.mapped === false ? ' · 未绑定模型' : ''} · ${esc(item.sourceId)}</option>`).join('');
  }

  function prepareConveyor(snapshot) {
    if (!isConveyor()) return;
    const entry = active(), items = snapshot.conveyors || [];
    if (!items.some(item => String(item.id) === entry.conveyorId)) entry.conveyorId = items.length ? String(items[0].id) : null;
    if (state.renderedCode !== currentScope()) { $('conveyorSearch').value = ''; renderConveyorOptions(); }
    const segment = selectedConveyor();
    const unmapped = items.filter(item => item.mapped === false).map(item => item.id);
    let note = segment ? `当前机段 ${segment.id} · PLC 源编号 ${segment.sourceId}。应用仅提交当前机段与心跳的修改项。` : '当前 PLC 没有输送机段定义。';
    if (segment?.mapped === false) note += ' 该机段仅有源变量，未绑定三维模型，仍可输入并验证读回。';
    if (state.code === 'CV02') note += ' 源表没有 2056，三维中的 2056 保持未绑定。';
    else if (unmapped.length) note += ` ${unmapped.join('、')} 仅有变量、未绑定模型。`;
    $('conveyorMappingNote').textContent = note;
    $('conveyorMappingNote').className = segment?.mapped === false ? 'unmapped' : '';
  }

  function switchConveyor(id) {
    if (state.busy || !isConveyor() || !active().snapshot?.conveyors?.some(item => String(item.id) === id)) return;
    active().conveyorId = id;
    errorBanner('');
    const url = new URL(window.location.href);
    url.searchParams.set('conveyor', id);
    writeUrl(url);
    renderSnapshot(active().snapshot);
    renderGateway();
  }

  function renderSnapshot(snapshot) {
    if (!snapshot || snapshot.equipmentCode !== state.code) return;
    storeSnapshot(snapshot);
    prepareConveyor(snapshot);
    const entry = active(), rebuild = state.renderedCode !== currentScope() || !state.tags.length;
    if (rebuild) buildInputs(snapshot);
    if (entry.portDraft === null || snapshot.running) entry.portDraft = String(snapshot.port);
    if (rebuild || snapshot.running || document.activeElement !== $('port')) $('port').value = entry.portDraft;
    $('listenerState').textContent = snapshot.running ? '监听中' : '已停止';
    $('listenerState').className = snapshot.running ? 'running' : 'stopped';
    $('listenerEndpoint').textContent = `${snapshot.ipAddress || '127.0.0.1'}:${snapshot.port}`;
    $('clientCount').textContent = snapshot.clientCount ?? 0;
    $('readCount').textContent = snapshot.readCount ?? 0;
    $('lastReadAt').textContent = time(snapshot.lastReadAt);
    $('modeCaption').textContent = snapshot.mode === 'auto' ? '周期信号' : '保持输入值';
    $('manualButton').setAttribute('aria-pressed', String(snapshot.mode !== 'auto'));
    $('autoButton').setAttribute('aria-pressed', String(snapshot.mode === 'auto'));
    $('modeNote').textContent = snapshot.mode === 'auto' ? '当前设备正在周期性改变信号。可以先编辑输入值，点击应用后转为手动并保持。' : '输入并应用后保持当前设备信号不变。切换自动演示可连续查看运动、模式与报警变化。';
    for (const tag of state.tags) {
      const value = sourceValue(snapshot, (snapshot.tags || []).find(item => item.name === tag.name) || tag);
      const input = $('input-' + tag.name);
      if (input && (rebuild || document.activeElement !== input)) input.value = entry.draft.has(tag.name) ? entry.draft.get(tag.name) : value;
      input?.classList.toggle('dirty', entry.draft.has(tag.name));
      const current = document.querySelector(`[data-current="${tag.name}"]`);
      if (current) current.textContent = value === '' ? '（空）' : value;
      const label = document.querySelector(`[data-meaning="${tag.name}"]`);
      if (label) label.textContent = meaning(tag.name, value);
    }
    if (snapshot.lastError) errorBanner(snapshot.lastError);
    renderSelectionLabels();
    renderDraft();
    setButtons();
  }

  function switchEquipment(code) {
    if (!codes.includes(code) || state.busy || code === state.code) return;
    state.revision++;
    state.code = code;
    // A selected device is rediscovered against its own endpoint and name.
    const entry = active();
    entry.deviceId = null;
    entry.devicePort = null;
    entry.gateway = null;
    errorBanner('');
    const url = new URL(window.location.href);
    url.searchParams.set('equipment', code);
    if (isConveyor() && entry.conveyorId) url.searchParams.set('conveyor', entry.conveyorId);
    else url.searchParams.delete('conveyor');
    writeUrl(url);
    if (entry.snapshot) renderSnapshot(entry.snapshot);
    else {
      state.tags = [];
      state.renderedCode = null;
      $('keyTagRows').innerHTML = '<tr><td colspan="4" class="empty">正在加载当前设备点位…</td></tr>';
      $('otherTagRows').innerHTML = '';
      $('port').value = entry.portDraft ?? entry.defaultPort;
      $('listenerState').textContent = '等待服务';
      $('listenerEndpoint').textContent = `127.0.0.1:${entry.defaultPort}`;
      for (const id of ['clientCount', 'readCount', 'lastReadAt']) $(id).textContent = '--';
    }
    renderSelectionLabels();
    renderDraft();
    renderGateway();
    setButtons();
    refresh();
  }

  function blockQuality(block) { return block?.isStale && block.quality === 'good' ? 'stale' : block?.quality || 'unknown'; }

  function gatewayTags() {
    const tags = new Map();
    for (const block of active().gateway?.blocks || []) for (const tag of block.tags || []) tags.set(tag.name, { ...tag, block });
    return tags;
  }

  function readbackSummary(tags) {
    const segment = selectedConveyor();
    const names = isConveyor() ? [segment?.stateTag, segment?.hasGoodsTag, segment?.trayCodeTag].filter(Boolean) : ['PLC_PATTERN'];
    const blocks = [...new Set(names.map(name => tags.get(name)?.block).filter(Boolean))];
    if (!blocks.length) return { quality: 'unknown', lastReadAt: null };
    const priority = { bad: 5, stale: 4, unknown: 3, disabled: 2, good: 1 };
    const quality = blocks.map(blockQuality).sort((a, b) => (priority[b] || 0) - (priority[a] || 0))[0];
    const times = blocks.map(block => block.lastReadAt).filter(Boolean).sort();
    return { quality, lastReadAt: times.length ? times[0] : null };
  }

  function renderReadbackRows() {
    const segment = selectedConveyor(), heart = heartbeatTag(active().snapshot);
    const rows = isConveyor() ? [
      { label: '输送状态', name: segment?.stateTag }, { label: '机段占位', name: segment?.hasGoodsTag },
      { label: '托盘条码', name: segment?.trayCodeTag }, { label: 'PLC 心跳', name: heart?.name }
    ].filter(item => item.name) : [
      { label: '运行模式', name: 'PLC_PATTERN' }, { label: '当前故障', name: 'PLC_ERROR' }, { label: '准备就绪', name: 'PLC_DISPATCH' },
      { label: '载货台', name: 'PLC_VANSTATE' }, { label: '行走位置', name: 'PLC_LOCATX' }, { label: '提升位置', name: 'PLC_LOCATY' },
      { label: '货叉位置', name: 'PLC_LOCATZ' }, { label: '当前任务号', name: 'PLC_TASKNO' }
    ];
    const signature = rows.map(row => row.name).join('|');
    if ($('readbackValues').dataset.signature === signature) return;
    $('readbackValues').dataset.signature = signature;
    $('readbackValues').innerHTML = rows.map(row => `<div><span>${esc(row.label)}</span><strong data-readback="${esc(row.name)}">--</strong></div>`).join('');
  }

  function renderGateway(message) {
    const entry = active(), tags = gatewayTags(), summary = readbackSummary(tags), name = entry.snapshot?.deviceName || state.code + '-SIM';
    const quality = summary.quality;
    const good = state.online && quality === 'good';
    const qualityNames = { good: '正常读回', bad: '读取失效', stale: '数据过期', disabled: '已停用', unknown: '等待数据' };
    const shownQuality = !entry.deviceId ? '' : !state.online ? 'bad' : quality;
    $('gatewayQuality').textContent = !entry.deviceId ? '未连接' : !state.online ? '网关离线' : qualityNames[quality] || '等待数据';
    $('gatewayQuality').className = 'quality-badge' + (shownQuality ? ' ' + shownQuality : '');
    $('gatewayName').textContent = entry.gateway?.name || (entry.deviceId ? name + ' · 等待首次读回' : '等待连接 ' + name);
    const dbNumber = entry.snapshot?.dbNumber || (isConveyor() ? 600 : 2000);
    $('gatewayEndpoint').textContent = entry.deviceId ? `127.0.0.1:${entry.devicePort || entry.snapshot?.port || '--'} · DB${dbNumber}${isConveyor() ? ' · 机段 ' + (entry.conveyorId || '--') : ''}` : 'S7/TCP → 网关 → 当前页面';
    $('gatewayLastRead').textContent = time(summary.lastReadAt);
    $('gatewayMessage').textContent = message || (!entry.deviceId ? `连接 ${name} 或全部启动，验证数据是否经过 S7 正常读取。` : good ? '数据已通过真实 S7 连接读回。下方显示当前设备或机段的值，可与输入值对照。' : summary.lastReadAt ? '上次成功值已失效，请检查当前模拟 PLC 是否监听、网关设备是否启用。' : `正在等待网关建立 S7 连接并读取 DB${dbNumber}。`);
    renderReadbackRows();
    $('readbackValues').classList.toggle('invalid', !good);
    for (const element of document.querySelectorAll('[data-readback]')) {
      const tag = element.dataset.readback, result = tags.get(tag), value = result?.value;
      element.textContent = value === undefined ? '--' : value === '' ? '（空）' : meaning(tag, value) || (tag.startsWith('PLC_LOCAT') ? `${value} mm` : value);
      element.style.color = !state.online || blockQuality(result?.block) !== 'good' ? '#94a3b8' : '';
      element.title = result ? `所属 DB${result.block.dbNumber} · ${blockQuality(result.block)} · ${time(result.block.lastReadAt)}` : '尚未读取';
    }
    for (const element of document.querySelectorAll('[data-table-readback]')) {
      const result = tags.get(element.dataset.tableReadback), value = result?.value;
      const tagGood = state.online && blockQuality(result?.block) === 'good';
      element.textContent = value === undefined ? '--' : value === '' ? '（空）' : value;
      element.classList.toggle('invalid', !tagGood);
      element.title = tagGood ? `网关当前正常读回 · ${time(result.block.lastReadAt)}` : value === undefined ? '尚未读取' : '上次成功值，当前已失效';
    }
    renderSelectionLabels();
    $('deviceLink').href = '/devices';
  }

  async function discoverDevice(snapshot, code, revision) {
    const entry = entries.get(code);
    if (entry.deviceId || !snapshot.running) return;
    const devices = await api('api/s7/devices', { timeoutMs: 6000 });
    if (!currentRequest(code, revision)) return;
    const name = snapshot.deviceName || code + '-SIM';
    const device = devices.find(item => item.name === name && item.ipAddress === '127.0.0.1' && item.port === snapshot.port && item.rack === 0 && item.slot === 0);
    if (device) { entry.deviceId = device.id; entry.devicePort = snapshot.port; }
  }

  async function refresh() {
    if (destroyed || state.refreshing || state.busy) return;
    state.refreshing = true;
    const revision = state.revision, code = state.code;
    try {
      const snapshots = await api('api/s7/simulators', { timeoutMs: 6000 });
      if (!currentRequest(code, revision)) return;
      if (!Array.isArray(snapshots)) throw new Error('模拟 PLC 列表格式无效。');
      if (!state.online) errorBanner('');
      state.online = true;
      $('service').className = 'service ok';
      $('serviceText').textContent = '网关已连接';
      snapshots.forEach(storeSnapshot);
      const snapshot = active().snapshot;
      if (!snapshot) throw new Error(code + ' 模拟 PLC 不存在。');
      renderSnapshot(snapshot);
      await discoverDevice(snapshot, code, revision);
      if (!currentRequest(code, revision)) return;
      const entry = entries.get(code), deviceId = entry.deviceId;
      if (deviceId) {
        try {
          const gateway = await api(`api/s7/devices/${encodeURIComponent(deviceId)}/tags`, { timeoutMs: 6000 });
          if (!currentRequest(code, revision)) return;
          entry.gateway = gateway;
          renderGateway();
        } catch (error) {
          if (!currentRequest(code, revision)) return;
          entry.gateway = null;
          // Rediscover after a device configuration has been deleted or replaced.
          entry.deviceId = null;
          entry.devicePort = null;
          renderGateway('当前网关设备读取失败：' + error.message);
        }
      } else renderGateway();
    } catch (error) {
      if (!currentRequest(code, revision)) return;
      state.online = false;
      $('service').className = 'service bad';
      $('serviceText').textContent = '网关未连接';
      errorBanner('无法读取模拟 PLC 服务：' + error.message + ' 请确认网关已启动。');
      $('listenerState').textContent = '服务不可用';
      $('listenerState').className = 'stopped';
      renderGateway();
      setButtons();
    } finally { state.refreshing = false; }
  }

  async function action(operation, success) {
    if (state.busy || !state.online) return;
    state.busy = true;
    const code = state.code, path = simulatorPath(code), revision = ++state.revision;
    setButtons();
    errorBanner('');
    try {
      const response = await operation(path, code);
      if (!currentRequest(code, revision)) return;
      if (response?.tags && response?.values) renderSnapshot(response);
      if (success) notify(code + '：' + success);
    } catch (error) { if (currentRequest(code, revision)) { errorBanner(error.message); notify(error.message, true); } }
    finally { state.busy = false; setButtons(); await refresh(); }
  }

  function portValue() {
    const input = $('port'), raw = input.value.trim(), value = Number(raw);
    if (!raw || !Number.isInteger(value) || value < 1 || value > 65535) { input.setCustomValidity('请输入 1–65535 之间的整数端口。'); input.reportValidity(); return null; }
    input.setCustomValidity('');
    return value;
  }

  function clearDraft(code = state.code, names = null) {
    if (names) for (const name of names) entries.get(code).draft.delete(name);
    else entries.get(code).draft.clear();
    if (code !== state.code) return;
    for (const input of document.querySelectorAll('[data-tag]')) if (!names || names.includes(input.dataset.tag)) { input.classList.remove('dirty'); input.removeAttribute('aria-invalid'); input.setCustomValidity(''); }
    renderDraft();
    renderFleet();
  }

  function fillPreset(name) {
    const segment = selectedConveyor();
    const presets = isConveyor() && segment ? {
      normal: { [segment.stateTag]: 1, [segment.hasGoodsTag]: 1, [segment.trayCodeTag]: '0000123456' },
      alarm: { [segment.stateTag]: 2 },
      position: { [segment.stateTag]: 0, [segment.hasGoodsTag]: 0, [segment.trayCodeTag]: '' }
    } : { normal: { PLC_PATTERN: 1, PLC_ERROR: 0, PLC_DISPATCH: 1, PLC_VANSTATE: 0 }, alarm: { PLC_PATTERN: 4, PLC_ERROR: 1001, PLC_DISPATCH: 0 }, position: { PLC_LOCATX: 18000, PLC_LOCATY: 12000, PLC_LOCATZ: 5000, PLC_POSX: 1, PLC_POSY: 12, PLC_POSZ: 6, PLC_VANSTATE: 1 } };
    for (const [tag, value] of Object.entries(presets[name] || {})) {
      const input = $('input-' + tag);
      if (!input) continue;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    notify(state.code + ' 示例已填入，点击“应用输入值”生效。');
  }

  $('port').addEventListener('input', () => { $('port').setCustomValidity(''); active().portDraft = $('port').value; });
  $('startButton').addEventListener('click', () => { const port = portValue(); if (port !== null) action(path => api(path + '/start', { method: 'POST', body: JSON.stringify({ port }) }), '模拟 PLC 已启动监听。'); });
  $('stopButton').addEventListener('click', () => action(path => api(path + '/stop', { method: 'POST' }), '模拟 PLC 已停止，网关随后显示断连状态。'));
  $('connectButton').addEventListener('click', () => {
    const port = portValue();
    if (port === null) return;
    action(async (path, code) => {
      const snapshot = await api(path + '/start', { method: 'POST', body: JSON.stringify({ port }) });
      renderSnapshot(snapshot);
      const result = await api(path + '/connect', { method: 'POST' });
      const entry = entries.get(code);
      entry.deviceId = result.deviceId;
      entry.devicePort = snapshot.port;
      entry.gateway = null;
      renderGateway();
    }, '设备已交给网关连接，正在等待 S7 数据读回。');
  });
  $('connectAllButton').addEventListener('click', () => {
    const mode = $('allMode').value;
    action(async () => {
      const result = await api('api/s7/simulators/connect-all', { method: 'POST', body: JSON.stringify({ mode }), timeoutMs: 30000 });
      for (const device of result.devices || []) {
        const entry = entries.get(device.equipmentCode);
        if (!entry) continue;
        if (device.simulator) storeSnapshot(device.simulator);
        entry.deviceId = device.deviceId;
        entry.devicePort = device.simulator?.port ?? entry.snapshot?.port;
        entry.gateway = null;
      }
      const failures = result.failures || [], count = result.devices?.length || 0;
      $('fleetResult').hidden = false;
      $('fleetResult').className = 'fleet-result' + (failures.length ? ' error' : '');
      $('fleetResult').textContent = failures.length ? `已连接 ${count} 台；${failures.map(item => item.equipmentCode + '：' + item.detail).join('；')}` : `${count} 台模拟 PLC 已启动并交给网关连接，使用${mode === 'auto' ? '自动演示' : '手动输入'}模式。点击各设备查看真实读回。`;
      if (active().snapshot) renderSnapshot(active().snapshot);
      renderGateway();
      if (failures.length) notify('部分模拟 PLC 未能启动，请查看设备概览上方的说明。', true);
      else notify('TC01–TC05、CV01–CV02 已全部启动并连接网关。');
    });
  });
  $('manualButton').addEventListener('click', () => action(path => api(path + '/mode', { method: 'PUT', body: JSON.stringify({ mode: 'manual' }) }), '已切换手动模式，保持当前模拟值。'));
  $('autoButton').addEventListener('click', () => action(path => api(path + '/mode', { method: 'PUT', body: JSON.stringify({ mode: 'auto' }) }), '已启动自动演示。'));
  $('resetButton').addEventListener('click', () => action(async (path, code) => { const response = await api(path + '/reset', { method: 'POST' }); clearDraft(code); return response; }, '已恢复初始值并切换手动模式。'));
  $('syncButton').addEventListener('click', () => { clearDraft(state.code, state.tags.map(tag => tag.name)); renderSnapshot(active().snapshot); notify(state.code + ' 当前输入框已同步为模拟值。'); });
  $('conveyorSearch').addEventListener('input', renderConveyorOptions);
  $('conveyorSelect').addEventListener('change', () => switchConveyor($('conveyorSelect').value));
  for (const button of document.querySelectorAll('[data-preset]')) button.addEventListener('click', () => fillPreset(button.dataset.preset));
  $('valuesForm').addEventListener('submit', event => {
    event.preventDefault();
    const values = {};
    for (const tag of state.tags.filter(item => active().draft.has(item.name))) {
      const input = $('input-' + tag.name), raw = input.value, value = stringTag(tag) ? raw : Number(raw.trim());
      const invalid = stringTag(tag) ? raw.length > (tag.length || 10) || /[^\x00-\x7F]/.test(raw) : !raw.trim() || !Number.isInteger(value) || value < 0 || value > maxValue(tag);
      if (invalid) {
        const message = `${state.code} ${tagLabel(tag)}：` + (stringTag(tag) ? `请输入不超过 ${tag.length || 10} 个 ASCII 字符，可保留前导零或清空。` : `请输入 0–${maxValue(tag)} 之间的整数。`);
        input.setCustomValidity(message);
        input.setAttribute('aria-invalid', 'true');
        if ($('otherTagRows').contains(input)) $('moreTags').open = true;
        input.reportValidity();
        errorBanner(message);
        return;
      }
      values[tag.name] = value;
    }
    if (!Object.keys(values).length) { notify(isConveyor() ? '当前机段没有待应用的修改，其他机段草稿会继续保留。' : '当前设备没有待应用的修改。'); return; }
    action(async (path, code) => { const response = await api(path + '/values', { method: 'PUT', body: JSON.stringify({ values }) }); clearDraft(code, Object.keys(values)); return response; }, '已应用修改项到模拟 PLC。查看右侧读回，或打开三维效果。');
  });

  buildEquipmentTabs();
  // 前进 / 后退：按 URL 中的 equipment / conveyor 还原选中，应用期间不再回写历史。
  const onPopState = () => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('equipment');
    const conveyorId = params.get('conveyor');
    applyingPopstate = true;
    try {
      if (code && codes.includes(code) && code !== state.code) switchEquipment(code);
      if (isConveyor() && conveyorId && String(conveyorId) !== String(active().conveyorId)) switchConveyor(conveyorId);
    } finally {
      applyingPopstate = false;
    }
  };
  window.addEventListener('popstate', onPopState);
  renderSelectionLabels();
  renderGateway();
  setButtons();
  refresh();
  let timer = setInterval(() => { if (!destroyed) refresh(); }, 1000);
  const onPageHide = () => { clearInterval(timer); timer = null; };
  const onPageShow = event => { if (event.persisted && timer === null && !destroyed) { refresh(); timer = setInterval(() => { if (!destroyed) refresh(); }, 1000); } };
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  return () => {
    destroyed = true;
    if (timer !== null) { clearInterval(timer); timer = null; }
    clearTimeout(toastTimer);
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
  };
};
