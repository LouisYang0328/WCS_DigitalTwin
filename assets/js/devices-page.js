/* 设备连接管理页逻辑：SPA 的 DevicesView 挂载时调用，返回销毁函数（清定时器、断引用）。 */
window.WcsPages = window.WcsPages || {};
window.WcsPages.initDevices = () => {
  'use strict';
  // 协议元数据驱动表单：新增协议只需后端注册并在 /api/s7/protocols 下发，前端按定义渲染。
  const FALLBACK_PROTOCOLS = [
    {
      id: 's7', name: 'Siemens S7', defaultPort: 102, usesRackSlot: true, usesUnitId: false,
      cpuTypes: ['S7-1200', 'S7-1500', 'S7-300', 'S7-400', 'S7-200'],
      areas: [{ id: 'db', name: 'DB 数据块', shortName: 'DB' }], defaultArea: 'db',
      connectionHint: 'S7 通常端口 102；S7-1200/1500 为 Rack 0 / Slot 0，S7-300/400 为 Rack 0 / Slot 2。'
    },
    {
      id: 'modbus-tcp', name: 'Modbus TCP', defaultPort: 502, usesRackSlot: false, usesUnitId: true,
      cpuTypes: [],
      areas: [
        { id: 'holding', name: '保持寄存器 (4x)', shortName: '4x' },
        { id: 'input', name: '输入寄存器 (3x)', shortName: '3x' },
        { id: 'coil', name: '线圈 (0x)', shortName: '0x', bitArea: true },
        { id: 'discrete', name: '离散输入 (1x)', shortName: '1x', bitArea: true }
      ],
      defaultArea: 'holding',
      connectionHint: 'Modbus TCP 通常端口 502；站地址 Unit ID 一般为 1，串口网关场景按从站号填写。'
    }
  ];
  const state = {
    devices: [], profiles: [], profilesLoaded: false, profilesLoading: false,
    protocols: FALLBACK_PROTOCOLS, protocolsLoaded: false,
    gatewayOnline: false, detail: null, selectedDeviceId: null, selectedBlockId: null, editingId: null,
    busy: new Set(), refreshing: false
  };
  const $ = id => document.getElementById(id) || stubEl;
  // 视图卸载后所有 id 都取不到，落到这个占位元素上：迟到的异步写操作变成无操作。
  const stubEl = document.createElement('div');
  let destroyed = false;
  const api = window.WcsApi.request;
  const stateNames = { online: '在线', degraded: '部分异常', connecting: '连接中', reconnecting: '重连中', offline: '已断开', waiting: '等待数据', faulted: '读取异常', disabled: '已停用' };
  const qualityNames = { good: '正常', unknown: '无数据', bad: '失效', stale: '过期', disabled: '停用' };
  const enumText = {
    PLC_PATTERN: { 1: '自动', 2: '手动', 3: '离线', 4: '维护' },
    PLC_VANSTATE: { 0: '无货', 1: '有货' },
    PLC_TASKTYPE: { 1: '入库', 2: '出库', 3: '移库', 4: '站台移动' }
  };
  let toastTimer;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }
  function showToast(message, error = false) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').className = 'toast show' + (error ? ' error' : '');
    toastTimer = setTimeout(() => { $('toast').className = 'toast'; }, 4500);
  }
  function formatTime(value) {
    if (!value) return '--';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '--' : date.toLocaleTimeString('zh-CN', { hour12: false });
  }
  function formatTimestamp(value) {
    if (!value) return '--';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '--' : date.toLocaleString('zh-CN', { hour12: false });
  }
  function protocolDef(id) {
    return state.protocols.find(item => item.id === id) || state.protocols[0];
  }
  function currentProtocol() {
    return protocolDef($('protocol').value);
  }
  function areaDef(protocol, areaId) {
    return protocol.areas.find(area => area.id === areaId) || protocol.areas[0];
  }
  function isS7(id) {
    return protocolDef(id).id === 's7';
  }
  function selectedProfile() {
    return state.profiles.find(profile => profile.id === $('profileSelect').value) || state.profiles.find(profile => profile.id === 'tc') || state.profiles[0];
  }
  function profileBlock(profile, overrides = {}) {
    const protocol = currentProtocol();
    return {
      name: profile.name, dbNumber: isS7(protocol.id) ? profile.defaultDbNumber : 0,
      area: protocol.defaultArea,
      startAddress: profile.defaultStartAddress,
      readLength: profile.readLength, pollIntervalMs: profile.defaultPollIntervalMs,
      decoder: profile.id, enabled: true, ...overrides
    };
  }
  function decoderOptions(current) {
    const profiles = [...state.profiles];
    if (!profiles.some(profile => profile.id === current)) profiles.push({ id: current, name: current });
    return profiles.map(profile => `<option value="${esc(profile.id)}"${profile.id === current ? ' selected' : ''}>${esc(profile.name)}</option>`).join('');
  }
  function areaOptions(protocol, current) {
    return protocol.areas.map(area => `<option value="${esc(area.id)}"${area.id === current ? ' selected' : ''}>${esc(area.name)}</option>`).join('');
  }
  function renderProfileHint() {
    const profile = selectedProfile();
    if (!profile) return;
    $('profileHint').textContent = `${profile.tags.length} 个点位 · DB${profile.defaultDbNumber} · 起始 ${profile.defaultStartAddress} · ${profile.readLength} B · ${profile.defaultPollIntervalMs} ms。${profile.description || ''}`;
  }
  async function loadProtocols() {
    if (state.protocolsLoaded) return;
    try {
      const protocols = await api('api/s7/protocols');
      if (Array.isArray(protocols) && protocols.length) state.protocols = protocols;
      state.protocolsLoaded = true;
    } catch (_) {
      // 网关版本较旧时回退到内置定义，页面保持可用。
    }
    const current = $('protocol').value;
    $('protocol').innerHTML = state.protocols.map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
    $('protocol').value = state.protocols.some(item => item.id === current) ? current : state.protocols[0].id;
    applyProtocolUI();
  }
  function applyProtocolUI() {
    const protocol = currentProtocol();
    document.querySelectorAll('[data-protocol-field]').forEach(field => {
      const show = field.dataset.protocolField === protocol.id;
      field.hidden = !show;
      field.querySelectorAll('input, select').forEach(input => {
        if (input.dataset.baseRequired === undefined) input.dataset.baseRequired = input.required ? '1' : '';
        input.disabled = !show;
        input.required = show && input.dataset.baseRequired === '1';
      });
    });
    $('protocolHint').textContent = protocol.connectionHint || protocol.description || '';
    $('portHint').textContent = `${protocol.name} 默认端口 ${protocol.defaultPort}`;
    document.querySelectorAll('#blockEditors .block-editor').forEach(applyBlockProtocolLayout);
    updateBlockIndexes();
  }
  async function loadProfiles() {
    if (state.profilesLoaded || state.profilesLoading) return;
    state.profilesLoading = true;
    try {
      const profiles = await api('api/s7/profiles');
      if (!Array.isArray(profiles) || !profiles.length) throw new Error('网关未返回可用的点位模板。');
      state.profiles = profiles;
      state.profilesLoaded = true;
      $('profileSelect').innerHTML = profiles.map(profile => `<option value="${esc(profile.id)}">${esc(profile.name)}</option>`).join('');
      $('profileSelect').value = profiles.some(profile => profile.id === 'tc') ? 'tc' : profiles[0].id;
      $('profileSelect').disabled = false;
      $('applyProfile').disabled = false;
      $('saveButton').disabled = false;
      renderProfileHint();
      if (!$('blockEditors').children.length) addBlockEditor(profileBlock(selectedProfile()));
      for (const select of $('blockEditors').querySelectorAll('[data-field="decoder"]')) select.innerHTML = decoderOptions(select.value);
    } catch (error) {
      $('profileHint').textContent = `模板加载失败：${error.message}；连接恢复后自动重试。`;
    } finally { state.profilesLoading = false; }
  }
  function setService(online, message) {
    $('service').className = 'service ' + (online ? 'ok' : 'bad');
    $('serviceText').textContent = message;
  }
  function selectedDevice() {
    return state.devices.find(item => item.id === state.selectedDeviceId) || null;
  }
  async function refresh(silent = true) {
    if (destroyed || state.refreshing) return;
    state.refreshing = true;
    try {
      if (!state.protocolsLoaded) await loadProtocols();
      if (!state.profilesLoaded) await loadProfiles();
      const data = await api('api/s7/devices');
      state.devices = Array.isArray(data) ? data : [];
      if (state.selectedDeviceId && !state.devices.some(item => item.id === state.selectedDeviceId)) {
        state.selectedDeviceId = null; state.selectedBlockId = null; state.detail = null;
      }
      if (!state.selectedDeviceId) {
        state.selectedDeviceId = state.devices.find(item => item.state === 'online')?.id || state.devices[0]?.id || null;
      }
      if (state.selectedDeviceId) {
        try { state.detail = await api(`api/s7/devices/${encodeURIComponent(state.selectedDeviceId)}`); }
        catch (_) { state.detail = null; }
      } else state.detail = null;
      const blocks = currentDetail()?.blocks || [];
      if (!state.selectedBlockId || !blocks.some(block => block.id === state.selectedBlockId))
        state.selectedBlockId = blocks[0]?.id || null;
      state.gatewayOnline = true;
      setService(true, '采集网关正常');
      render();
    } catch (error) {
      state.gatewayOnline = false;
      setService(false, '网关未连接');
      render();
      if (!silent) showToast(error.message, true);
    } finally { state.refreshing = false; }
  }
  function currentDetail() {
    return state.detail && state.detail.id === state.selectedDeviceId ? state.detail : selectedDevice();
  }
  function render() {
    const connected = state.devices.filter(item => ['online', 'degraded'].includes(item.state)).length;
    const blocks = state.devices.flatMap(item => item.blocks || []);
    const faults = blocks.filter(block => block.state === 'faulted').length;
    $('totalCount').textContent = state.devices.length;
    $('onlineCount').textContent = state.gatewayOnline ? connected : '--';
    $('blockCount').textContent = blocks.length;
    $('faultCount').textContent = faults;
    $('tableCaption').textContent = `${state.devices.length} 台设备 · ${blocks.length} 个读取块`;
    renderDevices();
    renderBlockTabs();
    renderBlockDetail();
  }
  function deviceSubline(item) {
    return isS7(item.protocol)
      ? `${item.cpuType} · Rack ${item.rack} / Slot ${item.slot}`
      : `${protocolDef(item.protocol).name} · Unit ${item.unitId}`;
  }
  function blockAddressLabel(protocol, block) {
    const area = areaDef(protocol, block.area || protocol.defaultArea);
    return isS7(protocol.id) ? `DB${block.dbNumber}` : `${area.shortName}:${block.startAddress}`;
  }
  function blockSummary(device) {
    const protocol = protocolDef(device.protocol);
    const blocks = device.blocks || [];
    if (!blocks.length) return '<span class="block-count">0</span>';
    return `<span class="block-count">${blocks.length}</span><span class="block-names" title="${esc(blocks.map(block => `${block.name} ${blockAddressLabel(protocol, block)}`).join(' / '))}">${esc(blocks.map(block => block.name).join(' · '))}</span>`;
  }
  function renderDevices() {
    if (!state.devices.length) {
      $('deviceRows').innerHTML = '<tr><td colspan="6" class="empty">暂无设备，请在左侧选择协议、填写参数并添加读取块。</td></tr>';
      return;
    }
    $('deviceRows').innerHTML = state.devices.map(item => {
      const selected = item.id === state.selectedDeviceId ? ' class="selected"' : '';
      const disabled = state.busy.has(item.id) ? ' disabled' : '';
      const toggle = item.enabled
        ? `<button class="text-btn" data-action="disconnect" data-id="${esc(item.id)}"${disabled}>断开</button>`
        : `<button class="text-btn" data-action="connect" data-id="${esc(item.id)}"${disabled}>连接</button>`;
      return `<tr${selected}>
        <td><button class="device-name" data-action="select" data-id="${esc(item.id)}">${esc(item.name)}</button> <span class="protocol-chip">${esc(protocolDef(item.protocol).name)}</span><span class="subline">${esc(deviceSubline(item))}</span></td>
        <td><span class="endpoint">${esc(item.ipAddress)}:${item.port}</span></td>
        <td>${blockSummary(item)}</td>
        <td><span class="badge ${esc(item.state)}">${esc(stateNames[item.state] || item.state)}</span>${item.lastError ? `<span class="subline" title="${esc(item.lastError)}">${esc(item.lastError)}</span>` : ''}</td>
        <td>${formatTime(item.lastReadAt)}<span class="subline">${item.readCount} 次读取</span></td>
        <td><div class="actions"><button class="text-btn" data-action="edit" data-id="${esc(item.id)}"${disabled}>编辑</button>${toggle}<button class="text-btn" data-action="reconnect" data-id="${esc(item.id)}"${disabled}>重连</button><button class="text-btn danger" data-action="remove" data-id="${esc(item.id)}"${disabled}>删除</button></div></td>
      </tr>`;
    }).join('');
  }
  function renderBlockTabs() {
    const detail = currentDetail();
    if (!detail || !detail.blocks?.length) {
      $('detailTitle').textContent = '选择一个设备';
      $('detailEndpoint').textContent = '--';
      $('detailState').className = 'badge offline'; $('detailState').textContent = '未选择';
      $('detailUpdated').textContent = '';
      $('blockTabs').innerHTML = '<div class="tag-empty">选择设备后显示读取块</div>';
      return;
    }
    const protocol = protocolDef(detail.protocol);
    $('detailTitle').textContent = detail.name;
    $('detailEndpoint').textContent = `${protocol.name} · ${detail.ipAddress}:${detail.port}`;
    $('detailState').className = `badge ${detail.state}`;
    $('detailState').textContent = stateNames[detail.state] || detail.state;
    $('detailUpdated').textContent = detail.lastReadAt ? `最近成功 ${formatTime(detail.lastReadAt)}` : '';
    $('blockTabs').innerHTML = detail.blocks.map(block => {
      const on = block.id === state.selectedBlockId ? ' on' : '';
      const encoded = stateNames[block.state] || block.state;
      return `<button class="block-tab${on}" data-block-id="${esc(block.id)}" type="button"><b>${esc(block.name)}</b><small class="tone-${esc(block.state)}"><i class="mini-dot"></i>${esc(blockAddressLabel(protocol, block))} · ${esc(encoded)}</small></button>`;
    }).join('');
  }
  function tagAddress(protocol, block, tag) {
    if (isS7(protocol.id)) return tag.address;
    const area = areaDef(protocol, block.area || protocol.defaultArea);
    const offset = tag.byteAddress ?? 0;
    return area.bitArea ? `${area.shortName}:${block.startAddress + offset * 8}` : `${area.shortName}:${block.startAddress + Math.floor(offset / 2)}`;
  }
  function renderBlockDetail() {
    const detail = currentDetail();
    const block = detail?.blocks?.find(item => item.id === state.selectedBlockId);
    if (!detail || !block) {
      $('blockDetail').innerHTML = '<div class="tag-empty">在设备列表选择一台设备，查看各读取块的实时数据。</div>';
      return;
    }
    const protocol = protocolDef(detail.protocol);
    const area = areaDef(protocol, block.area || protocol.defaultArea);
    const meta = `<div class="block-meta">
      <div class="meta-item"><span>${isS7(protocol.id) ? 'DB 编号' : '数据区'}</span><b>${isS7(protocol.id) ? `DB${block.dbNumber}` : esc(area.name)}</b></div>
      <div class="meta-item"><span>${isS7(protocol.id) ? '起始字节' : '起始地址'}</span><b>${block.startAddress}</b></div>
      <div class="meta-item"><span>读取长度</span><b>${block.readLength} B</b></div>
      <div class="meta-item"><span>轮询周期</span><b>${block.pollIntervalMs} ms</b></div>
      <div class="meta-item"><span>解析模板</span><b>${esc(block.decoder.toUpperCase())}</b></div>
      <div class="meta-item"><span>块读取次数</span><b>${block.readCount}</b></div>
    </div>`;
    const error = block.lastError ? `<div class="error-callout"><b>${esc(block.name)} 读取异常：</b>${esc(block.lastError)}<br>其他读取块不受影响；当前块将在退避后自动重试。</div>` : '';
    const quality = !state.gatewayOnline && block.hasData ? 'bad' : block.quality || (!block.enabled ? 'disabled' : !block.hasData ? 'unknown' : block.state === 'online' && detail.isConnected ? 'good' : 'bad');
    const retained = block.hasData && (quality !== 'good' || block.isStale);
    const qualityMessage = retained
      ? `当前显示上次成功值${block.isStale ? '，数据已过期' : ''}；请核对采集状态与时间。`
      : !block.hasData ? '尚无设备实测数据。' : '显示最近一次成功采样值。';
    const qualityStrip = `<div class="quality-strip${retained ? ' retained' : ''}"><span class="quality-badge quality-${esc(quality)}">数据质量 · ${esc(qualityNames[quality] || quality)}</span><span>最近成功 ${formatTimestamp(block.lastReadAt)}</span><a class="text-btn" href="api/s7/devices/${encodeURIComponent(detail.id)}/tags" target="_blank" rel="noopener">点位 JSON ↗</a></div>`;
    const dataNotice = `<div class="${retained ? 'retained-callout' : 'data-note'}" role="status">${esc(qualityMessage)}</div>`;
    let content;
    if (block.decoder !== 'raw') {
      if (!block.tags?.length) content = `<div class="tag-empty">${block.hasData ? '该块没有可解析的点位字段。' : (block.enabled ? '等待首次成功读取…' : '该读取块已停用。')}</div>`;
      else content = `<div class="data-caption"><b>${esc(state.profiles.find(profile => profile.id === block.decoder)?.name || block.decoder)} · 点位反馈</b><span>大端数值 / 字符串 · ${formatTime(block.lastReadAt)}</span></div>
        <div class="table-wrap"><table><thead><tr><th>变量</th><th>地址</th><th>类型</th><th>原始值</th><th>说明</th></tr></thead><tbody>
        ${block.tags.map(tag => {
          const meaning = enumText[tag.name]?.[tag.value];
          return `<tr><td>${esc(tag.name)}</td><td class="endpoint">${esc(tagAddress(protocol, block, tag))}</td><td>${esc(tag.dataType)}</td><td class="tag-value">${esc(tag.value)}${meaning ? ` <span class="tag-desc">${esc(meaning)}</span>` : ''}</td><td class="tag-desc">${esc(tag.description)}</td></tr>`;
        }).join('')}
        </tbody></table></div>`;
    } else {
      content = block.rawBase64
        ? `<div class="data-caption"><b>原始字节 · Hex Dump</b><span>${block.readLength} B · ${formatTime(block.lastReadAt)}</span></div><pre class="hex">${esc(hexDump(block.rawBase64))}</pre>`
        : `<div class="tag-empty">${block.enabled ? '等待首次成功读取原始字节…' : '该读取块已停用。'}</div>`;
    }
    $('blockDetail').innerHTML = meta + qualityStrip + dataNotice + error + content;
  }
  function hexDump(base64) {
    try {
      const binary = atob(base64);
      const rows = [];
      for (let offset = 0; offset < binary.length; offset += 16) {
        const bytes = Array.from(binary.slice(offset, offset + 16), char => char.charCodeAt(0));
        const hex = bytes.map(byte => byte.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ');
        const ascii = bytes.map(byte => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.').join('');
        rows.push(`${offset.toString(16).padStart(4, '0')}  ${hex}  |${ascii}|`);
      }
      return rows.join('\n');
    } catch (_) { return '原始字节解码失败。'; }
  }
  function resetEditor() {
    state.editingId = null;
    $('deviceForm').reset();
    $('protocol').value = state.protocols[0].id;
    $('name').value = 'TC01'; $('ipAddress').value = ''; $('port').value = String(state.protocols[0].defaultPort);
    $('cpuType').value = 'S7-1200'; $('rack').value = '0'; $('slot').value = '0'; $('unitId').value = '1';
    $('slotHint').textContent = 'S7-1200 通常 Rack 0 / Slot 0';
    $('formTitle').textContent = '新增 PLC 设备'; $('formMode').textContent = '新增';
    $('saveButton').textContent = '保存并连接'; $('cancelEdit').hidden = true;
    $('saveButton').disabled = !state.profilesLoaded;
    $('blockEditors').innerHTML = '';
    applyProtocolUI();
    if (state.profilesLoaded) {
      $('profileSelect').value = state.profiles.some(profile => profile.id === 'tc') ? 'tc' : state.profiles[0].id;
      addBlockEditor(profileBlock(selectedProfile()));
      renderProfileHint();
    }
  }
  function startEdit(id) {
    const device = state.devices.find(item => item.id === id);
    if (!device) return;
    state.editingId = id; state.selectedDeviceId = id;
    $('protocol').value = device.protocol || 's7';
    $('name').value = device.name; $('ipAddress').value = device.ipAddress; $('port').value = device.port;
    $('cpuType').value = isS7(device.protocol) ? device.cpuType : 'S7-1200';
    $('rack').value = device.rack; $('slot').value = device.slot;
    $('unitId').value = device.unitId ?? 1;
    $('slotHint').textContent = ['S7-300', 'S7-400'].includes(device.cpuType) ? `${device.cpuType} 通常 Rack 0 / Slot 2` : `${device.cpuType} 通常 Rack 0 / Slot 0`;
    $('formTitle').textContent = `编辑 ${device.name}`; $('formMode').textContent = '编辑中';
    $('saveButton').textContent = '保存修改'; $('cancelEdit').hidden = false;
    $('blockEditors').innerHTML = '';
    applyProtocolUI();
    (device.blocks || []).forEach(block => addBlockEditor(block));
    if (state.profiles.some(profile => profile.id === device.blocks?.[0]?.decoder)) $('profileSelect').value = device.blocks[0].decoder;
    renderProfileHint();
    updateBlockIndexes();
    $('editorCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function applyBlockProtocolLayout(editor) {
    const protocol = currentProtocol();
    const areaField = editor.querySelector('[data-role="area"]');
    const areaSelect = editor.querySelector('[data-field="area"]');
    const dbField = editor.querySelector('[data-role="dbNumber"]');
    const previousArea = areaSelect.value || protocol.defaultArea;
    areaSelect.innerHTML = areaOptions(protocol, protocol.areas.some(area => area.id === previousArea) ? previousArea : protocol.defaultArea);
    areaField.hidden = protocol.areas.length <= 1;
    dbField.hidden = !isS7(protocol.id);
  }
  function addBlockEditor(block = {}) {
    const protocol = currentProtocol();
    const index = $('blockEditors').children.length;
    const dbNumber = block.dbNumber || 2001 + index;
    const fallbackName = isS7(protocol.id) ? `DB${dbNumber}` : areaDef(protocol, block.area || protocol.defaultArea).name;
    const editor = document.createElement('div');
    editor.className = 'block-editor';
    if (block.id) editor.dataset.blockId = block.id;
    editor.innerHTML = `<div class="block-editor-head"><span class="block-index">01</span><strong data-block-label>${esc(block.name || fallbackName)}</strong><button class="remove-block" type="button" title="移除该读取块">×</button></div>
      <div class="block-grid">
        <div class="block-field wide"><label>块名称</label><input data-field="name" maxlength="40" value="${esc(block.name || fallbackName)}" required></div>
        <div class="block-field" data-role="area"><label>数据区</label><select data-field="area">${areaOptions(protocol, block.area || protocol.defaultArea)}</select></div>
        <div class="block-field" data-role="dbNumber"><label>DB 编号</label><input data-field="dbNumber" type="number" min="1" max="65535" value="${block.dbNumber || dbNumber}"></div>
        <div class="block-field"><label>起始地址</label><input data-field="startAddress" type="number" min="0" max="65535" value="${block.startAddress ?? 0}" required></div>
        <div class="block-field"><label>读取长度 (B)</label><input data-field="readLength" type="number" min="1" max="960" value="${block.readLength || 32}" required></div>
        <div class="block-field"><label>轮询周期 (ms)</label><input data-field="pollIntervalMs" type="number" min="200" max="60000" step="100" value="${block.pollIntervalMs || 500}" required></div>
        <div class="block-field"><label>解析模板</label><select data-field="decoder">${decoderOptions(block.decoder || 'raw')}</select></div>
        <div class="block-field enable-field"><label><input data-field="enabled" type="checkbox"${block.enabled === false ? '' : ' checked'}> 启用读取</label></div>
      </div><div class="block-editor-foot" data-address>读取地址</div>`;
    $('blockEditors').appendChild(editor);
    applyBlockProtocolLayout(editor);
    updateBlockIndexes();
    const name = editor.querySelector('[data-field="name"]');
    if (!block.name) { name.focus(); name.select(); }
  }
  function updateBlockIndexes() {
    const protocol = currentProtocol();
    const editors = [...$('blockEditors').querySelectorAll('.block-editor')];
    editors.forEach((editor, index) => {
      editor.querySelector('.block-index').textContent = String(index + 1).padStart(2, '0');
      const name = editor.querySelector('[data-field="name"]').value.trim() || '未命名块';
      editor.querySelector('[data-block-label]').textContent = name;
      const start = editor.querySelector('[data-field="startAddress"]').value || '0';
      const length = editor.querySelector('[data-field="readLength"]').value || '?';
      if (isS7(protocol.id)) {
        const db = editor.querySelector('[data-field="dbNumber"]').value || '?';
        editor.querySelector('[data-address]').textContent = `地址 DB${db}.DBB${start} · 长度 ${length} B`;
      } else {
        const area = areaDef(protocol, editor.querySelector('[data-field="area"]').value);
        editor.querySelector('[data-address]').textContent = `地址 ${area.shortName}:${start}（${area.name}）· 长度 ${length} B`;
      }
    });
    $('editorBlockCount').textContent = `${editors.length} 个块`;
    $('addBlock').disabled = editors.length >= 32;
  }
  function collectBlocks() {
    const protocol = currentProtocol();
    return [...$('blockEditors').querySelectorAll('.block-editor')].map(editor => ({
      id: editor.dataset.blockId || undefined,
      name: editor.querySelector('[data-field="name"]').value.trim(),
      dbNumber: isS7(protocol.id) ? Number(editor.querySelector('[data-field="dbNumber"]').value) : 0,
      area: isS7(protocol.id) ? 'db' : editor.querySelector('[data-field="area"]').value,
      startAddress: Number(editor.querySelector('[data-field="startAddress"]').value),
      readLength: Number(editor.querySelector('[data-field="readLength"]').value),
      pollIntervalMs: Number(editor.querySelector('[data-field="pollIntervalMs"]').value),
      decoder: editor.querySelector('[data-field="decoder"]').value,
      enabled: editor.querySelector('[data-field="enabled"]').checked
    }));
  }
  async function deviceAction(id, action) {
    if (state.busy.has(id)) return;
    if (action === 'select') {
      state.selectedDeviceId = id; state.selectedBlockId = null; state.detail = null; render(); await refresh(false); return;
    }
    if (action === 'edit') { startEdit(id); return; }
    if (action === 'remove' && !window.confirm('确认删除此设备及其全部读取块配置？该操作只会断开连接，不会写入设备。')) return;
    state.busy.add(id); renderDevices();
    try {
      if (action === 'reconnect') {
        await api(`api/s7/devices/${encodeURIComponent(id)}/disconnect`, { method: 'POST' });
        await api(`api/s7/devices/${encodeURIComponent(id)}/connect`, { method: 'POST' });
      } else if (action === 'remove') {
        await api(`api/s7/devices/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (state.selectedDeviceId === id) { state.selectedDeviceId = null; state.selectedBlockId = null; state.detail = null; }
        if (state.editingId === id) resetEditor();
      } else {
        await api(`api/s7/devices/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
      }
      await refresh(false);
    } catch (error) { showToast(error.message, true); }
    finally { state.busy.delete(id); renderDevices(); }
  }
  $('deviceRows').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (button) deviceAction(button.dataset.id, button.dataset.action);
  });
  $('blockTabs').addEventListener('click', event => {
    const tab = event.target.closest('button[data-block-id]');
    if (!tab) return;
    state.selectedBlockId = tab.dataset.blockId;
    renderBlockTabs(); renderBlockDetail();
  });
  $('blockEditors').addEventListener('click', event => {
    const remove = event.target.closest('.remove-block');
    if (!remove) return;
    if ($('blockEditors').children.length === 1) { showToast('每台设备至少保留一个读取块。', true); return; }
    remove.closest('.block-editor').remove(); updateBlockIndexes();
  });
  $('blockEditors').addEventListener('input', event => {
    if (event.target.matches('[data-field="name"], [data-field="dbNumber"], [data-field="startAddress"], [data-field="readLength"]')) updateBlockIndexes();
  });
  $('blockEditors').addEventListener('change', updateBlockIndexes);
  $('addBlock').addEventListener('click', () => {
    const protocol = currentProtocol();
    if (isS7(protocol.id)) {
      const existing = collectBlocks().map(block => block.dbNumber);
      const dbNumber = Math.min(65535, Math.max(2000, ...existing) + 1);
      addBlockEditor({ name: `DB${dbNumber}`, dbNumber, area: 'db', startAddress: 0, readLength: 32, pollIntervalMs: 500, decoder: 'raw', enabled: true });
    } else {
      const area = areaDef(protocol, protocol.defaultArea);
      addBlockEditor({ name: area.name, dbNumber: 0, area: area.id, startAddress: 0, readLength: 32, pollIntervalMs: 500, decoder: 'raw', enabled: true });
    }
  });
  $('cancelEdit').addEventListener('click', () => resetEditor());
  $('profileSelect').addEventListener('change', renderProfileHint);
  $('protocol').addEventListener('change', () => {
    $('port').value = String(currentProtocol().defaultPort);
    applyProtocolUI();
  });
  $('applyProfile').addEventListener('click', () => {
    const profile = selectedProfile();
    if (!profile) return;
    const existing = collectBlocks();
    const first = existing[0];
    const blocks = [profileBlock(profile, first ? { id: first.id, enabled: first.enabled } : {}), ...existing.slice(1)];
    $('blockEditors').innerHTML = '';
    blocks.forEach(addBlockEditor);
    showToast(`已将首个读取块设置为 ${profile.name}；保存后生效。`);
  });
  $('cpuType').addEventListener('change', event => {
    const legacy = ['S7-300', 'S7-400'].includes(event.target.value);
    $('slot').value = legacy ? 2 : 0;
    $('slotHint').textContent = legacy ? `${event.target.value} 通常 Rack 0 / Slot 2` : `${event.target.value} 通常 Rack 0 / Slot 0`;
  });
  $('deviceForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const blocks = collectBlocks();
    if (!blocks.length) { showToast('请至少添加一个数据读取块。', true); return; }
    const protocol = currentProtocol();
    const payload = {
      protocol: protocol.id,
      name: $('name').value.trim(), ipAddress: $('ipAddress').value.trim(), port: Number($('port').value),
      rack: Number($('rack').value), slot: Number($('slot').value), cpuType: $('cpuType').value,
      unitId: Number($('unitId').value), blocks
    };
    const button = $('saveButton');
    button.disabled = true; button.textContent = '正在保存…';
    try {
      const editing = state.editingId;
      const saved = await api(editing ? `api/s7/devices/${encodeURIComponent(editing)}` : 'api/s7/devices', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      state.selectedDeviceId = saved.id; state.selectedBlockId = saved.blocks?.[0]?.id || null;
      showToast(editing ? `已保存 ${saved.name}，连接参数已重新加载。` : `已创建 ${saved.name}（${protocol.name}），包含 ${saved.blocks.length} 个读取块。`);
      resetEditor();
      await refresh(false);
    } catch (error) { showToast(error.message, true); }
    finally { button.disabled = !state.profilesLoaded; button.textContent = state.editingId ? '保存修改' : '保存并连接'; }
  });
  resetEditor();
  loadProtocols();
  refresh(false);
  const pollTimer = setInterval(() => { if (!destroyed) refresh(true); }, 1000);
  return () => {
    destroyed = true;
    clearInterval(pollTimer);
    clearTimeout(toastTimer);
  };
};
