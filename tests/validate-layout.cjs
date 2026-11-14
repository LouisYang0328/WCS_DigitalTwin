/* Run with: node tests/validate-layout.cjs
 * Uses the bundled Three.js geometry with a renderer/DOM stub. It verifies
 * layout and interaction state; browser rendering is checked separately.
 *
 * KNOWN GAP (pending migration): this harness still assumes the pre-Vue scene wrote HTML
 * straight into the page. The scene now publishes structured models
 * (selectionModel / publishKpis / publishAisles / publishLineMap) and Vue renders them, so the
 * remaining DOM assertions around updateKpis / renderAisleList / renderLineMap / renderConveyorCard
 * still need to move to payload assertions. Treat this file as a partial baseline, not a gate.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const layoutSource = fs.readFileSync(path.join(root, 'assets/conveyor-layout.js'), 'utf8');
const layoutContext = { window: {} };
vm.runInNewContext(layoutSource, layoutContext, { filename: 'conveyor-layout.js' });
const layout = layoutContext.window.WCS_CONVEYOR_LAYOUT;
assert.ok(layout, 'The layout must expose window.WCS_CONVEYOR_LAYOUT');

const absent1F = new Set([1005, 1030, 1052, 1098]);
const expected1F = Array.from({ length: 100 }, (_, i) => 1001 + i).filter(id => !absent1F.has(id));
const expected2F = Array.from({ length: 56 }, (_, i) => 2001 + i);
const allIds = new Set();
for (const [floorId, expected] of [[1, expected1F], [2, expected2F]]) {
  const records = layout[floorId];
  assert.equal(records.length, expected.length, `${floorId}F equipment count`);
  assert.deepEqual(Array.from(records, record => Number(record.id)).sort((a, b) => a - b), expected,
    `${floorId}F IDs must exactly match the drawing, including its gaps`);
  for (const record of records) {
    assert.ok(!allIds.has(record.id), `Duplicate equipment ID ${record.id}`);
    allIds.add(record.id);
    assert.match(record.id, /^\d{4}$/, `Equipment ID ${record.id}`);
    assert.ok(['branch', 'junction', 'trunk', 'header'].includes(record.kind), `Kind of ${record.id}`);
    for (const field of ['x1', 'y1', 'x2', 'y2']) {
      assert.ok(Number.isFinite(record[field]), `${record.id}.${field} must be finite`);
    }
    assert.ok(record.x2 > record.x1 && record.y2 > record.y1,
      `${record.id} must have a positive width and depth`);
    for (const extension of record.extensions || []) {
      for (const field of ['x1', 'y1', 'x2', 'y2']) {
        assert.ok(Number.isFinite(extension[field]), `${record.id} extension.${field} must be finite`);
      }
      assert.ok(extension.x2 > extension.x1 && extension.y2 > extension.y1,
        `${record.id} extension must have positive dimensions`);
    }
  }
}
console.log('PASS: 1F has 96 drawing IDs; 2F has 56; all IDs and bounding boxes are valid.');

class Element {
  constructor(id = '') {
    this.id = id;
    this.clientWidth = 1600;
    this.clientHeight = 1000;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.checked = true;
    this.value = '';
    this.innerHTML = '';
    this.textContent = '';
    this.listeners = {};
    this.attributes = new Map();
    const classes = new Set();
    this.classList = {
      toggle(name, force) {
        const enabled = force === undefined ? !classes.has(name) : Boolean(force);
        if (enabled) classes.add(name); else classes.delete(name);
        return enabled;
      },
      add(...names) { names.forEach(name => classes.add(name)); },
      remove(...names) { names.forEach(name => classes.delete(name)); },
      contains(name) { return classes.has(name); }
    };
  }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener(event, callback) { (this.listeners[event] ??= []).push(callback); }
  removeEventListener() {}
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  dispatch(event, fields = {}) {
    const payload = { type: event, target: this, currentTarget: this, preventDefault() {}, ...fields };
    for (const listener of this.listeners[event] || []) listener(payload);
  }
  setPointerCapture() {}
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  getContext() {
    return new Proxy({ measureText: text => ({ width: String(text).length * 28 }) }, {
      get(target, property) { return property in target ? target[property] : () => {}; }
    });
  }
}

const elements = new Map();
const getElement = id => {
  if (!elements.has(id)) elements.set(id, new Element(id));
  return elements.get(id);
};
for (const [id, field, values] of [
  ['floorTabs', 'mode', ['1', '2', '3']],
  ['viewBtns', 'view', ['overview', 'top', 'aisle', 'walk']]
]) {
  getElement(id).children = values.map(value => {
    const element = new Element();
    element.dataset[field] = value;
    return element;
  });
}

class Renderer {
  constructor() {
    this.domElement = new Element('canvas');
    this.shadowMap = {};
    this.renderCalls = [];
    this.sizeCalls = [];
    this.pixelRatio = 1;
  }
  setPixelRatio(value) { this.pixelRatio = value; }
  getPixelRatio() { return this.pixelRatio; }
  setSize(width, height) { this.sizeCalls.push({ width, height }); }
  setClearColor() {}
  render(scene, camera) { this.renderCalls.push({ scene, camera }); }
}

const THREE = { ...require(path.join(root, 'assets/three.min.js')), WebGLRenderer: Renderer };
const windowListeners = new Map();
const documentListeners = new Map();
const animationRequests = [];
const context = {
  THREE,
  console,
  document: {
    getElementById: getElement,
    createElement: tag => new Element(tag),
    querySelectorAll() { return []; },
    addEventListener(event, callback) {
      if (!documentListeners.has(event)) documentListeners.set(event, []);
      documentListeners.get(event).push(callback);
    },
    body: getElement('body'),
    documentElement: getElement('documentElement')
  },
  location: { hash: '' },
  URLSearchParams,
  performance: { now: () => 1000 },
  requestAnimationFrame(callback) { animationRequests.push(callback); return animationRequests.length; },
  addEventListener(event, callback) {
    if (!windowListeners.has(event)) windowListeners.set(event, []);
    windowListeners.get(event).push(callback);
  },
  dispatchEvent(event) {
    for (const listener of windowListeners.get(event.type) || []) listener(event);
  },
  Event: class Event { constructor(type) { this.type = type; } },
  devicePixelRatio: 1,
  innerWidth: 1600,
  innerHeight: 1000
};
context.window = context;
context.self = context;
vm.createContext(context);
vm.runInContext(layoutSource, context, { filename: 'conveyor-layout.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'assets/conveyor-s7-mapping.js'), 'utf8'), context,
  { filename: 'conveyor-s7-mapping.js' });

const requiredEquipmentModules = [
  'assets/js/equipment/rack-model.js',
  'assets/js/equipment/crane-model.js',
  'assets/js/equipment/inventory-model.js',
  'assets/js/equipment/conveyor-model.js',
  'assets/js/equipment/pallet-magazine.js',
  'assets/js/equipment/warehouse-environment.js',
  'assets/js/rendering/postprocessing.js'
];
const directModules = Array.from(html.matchAll(/<script src="(assets\/js\/(?:equipment|rendering)\/[^"<>]+\.js)"><\/script>/g), match => match[1]);
const loaderFiles = Array.from(html.matchAll(/'(assets\/[^']+\.js)'/g), match => match[1]);
const equipmentModules = [...new Set([...directModules, ...loaderFiles.filter(file => /assets\/js\/(?:equipment|rendering)\//.test(file))])];
for (const modulePath of requiredEquipmentModules)
  assert.ok(equipmentModules.includes(modulePath), `The page must load the equipment module ${modulePath}`);
const sceneIndex = Math.max(loaderFiles.indexOf('assets/js/twin-scene.js'), loaderFiles.indexOf('assets/js/legacy/twin-scene-legacy.js'));
assert.ok(sceneIndex >= 0, 'The page must load the dedicated scene module');
for (const modulePath of equipmentModules) {
  const moduleIndex = loaderFiles.indexOf(modulePath);
  if (moduleIndex >= 0) assert.ok(moduleIndex < sceneIndex, `Equipment module ${modulePath} must be loaded before the scene`);
  vm.runInContext(fs.readFileSync(path.join(root, modulePath), 'utf8'), context, { filename: modulePath });
}

assert.ok(fs.existsSync(path.join(root, 'assets/js/twin-scene.js')), 'The current scene module must exist');
const script = fs.readFileSync(path.join(root, 'assets/js/twin-scene.js'), 'utf8');
assert.ok(script.includes('function buildFloor'), 'The scene module must contain floor construction');
const end = script.lastIndexOf('})();');
assert.ok(end > 0, 'The scene must have an IIFE closing point for test-only injection');
const exposedFields = [
  'state', 'floors', 'cam', 'scene', 'sharedCranes', 'CFG', 'FLOOR_RISE', 'RACK_H', 'ROW_STATIONS',
  'applyMode', 'applyView', 'selectCrane', 'selectConveyor', 'clearSelection',
  'renderLineMap', 'renderAisleList', 'updateKpis', 'visibleFloors', 'triggerAlarm',
  'startTask', 'finishTask', 'stepCrane', 'tick', 'selectCell', 'setCell', 'pickables', 'ROW_OFF', 'LEN', 'CRANE_H',
  'triggerConveyorAlarm', 'clearTransientAlarms', 'craneSignals', 's7Link', 'selectionModel', 'craneSelection',
  'findCraneSignalDevice', 'applyLocalPlcMotion', 'updateSignalLink', 'conveyorSignals', 'conveyorSignalFromDetail',
  'findConveyorSignalDevice', 'getConveyorSignal', 'applyConveyorPlcMotion', 'conveyorSelection', 'selectRequestedConveyor',
  'renderer', 'camera', 'postFX', 'warehouseEnvironment',
  'renderSettings', 'setRenderQuality', 'setEnvironmentVisible', 'setImmersive'
].map(name => `${name}: typeof ${name} === 'undefined' ? undefined : ${name}`).join(',');
const injected = script.slice(0, end) + `\nglobalThis.__sceneTest = {${exposedFields}};\n` + script.slice(end);
vm.runInContext(injected, context, { filename: 'assets/js/twin-scene.js', timeout: 15000 });
const app = context.__sceneTest;

for (const floor of app.floors) {
  assert.equal(floor.conveyors.length, layout[floor.def.id].length, `${floor.def.label} model count`);
  assert.deepEqual(Array.from(floor.conveyors, conveyor => String(conveyor.id)).sort(),
    Array.from(layout[floor.def.id], record => String(record.id)).sort(),
    `${floor.def.label} must model every drawing ID once`);
  for (const conveyor of floor.conveyors) {
    assert.equal(conveyor.floor, floor, `Floor binding for ${conveyor.id}`);
    assert.ok(Number.isFinite(conveyor.x) && Number.isFinite(conveyor.z), `World position for ${conveyor.id}`);
    assert.ok(conveyor.body?.isMesh && conveyor.label, `Mesh and label for ${conveyor.id}`);
    assert.equal(conveyor.body.userData.conveyor, conveyor, `Picking binding for ${conveyor.id}`);
    assert.equal(conveyor.body.material.transparent, true, 'Conveyor picking volumes must not render as solid equipment');
    assert.equal(conveyor.body.material.opacity, 0);
    assert.equal(conveyor.body.material.depthWrite, false);
    assert.equal(conveyor.body.position.x, conveyor.x);
    assert.equal(conveyor.body.position.z, conveyor.z);
    assert.equal((conveyor.parts || []).length, (conveyor.extensions || []).length,
      `${conveyor.id} preserves all drawing extensions`);
    for (const part of conveyor.parts || []) {
      assert.equal(part.userData.conveyor, conveyor, `Extension picking binding for ${conveyor.id}`);
      assert.equal(part.material.opacity, 0, 'Extension picking volumes must not render as solid equipment');
      assert.equal(part.material.depthWrite, false);
    }
  }
}
console.log('PASS: all 152 drawing IDs have a floor-bound conveyor mesh and label.');

const [f1, f2] = app.floors;
assert.ok(Array.isArray(app.sharedCranes), 'The scene must have one shared physical-crane collection');
assert.equal(app.sharedCranes.length, 5, 'Both floors must share exactly five physical cranes');
assert.deepEqual(Array.from(app.sharedCranes, crane => crane.code), ['TC01', 'TC02', 'TC03', 'TC04', 'TC05']);
assert.equal(new Set(app.sharedCranes).size, 5, 'Every shared crane must be a unique physical object');
assert.equal(f1.cranes, app.sharedCranes, '1F must refer to the shared physical fleet');
assert.equal(f2.cranes, app.sharedCranes, '2F must refer to the same shared physical fleet');
for (let aisle = 0; aisle < 5; aisle++) {
  const crane = app.sharedCranes[aisle];
  assert.equal(f1.cranes[aisle], f2.cranes[aisle], 'The same aisle must use the same crane on both floors');
  assert.equal(crane.aisle, aisle, `${crane.code} aisle binding`);
  assert.equal(crane.group.parent, app.scene, `${crane.code} must not be a per-floor model`);
  assert.equal(crane.hit.userData.crane, crane, `${crane.code} picking must bind to its shared state`);
}
console.log('PASS: 1F and 2F share exactly five scene-level TC01–TC05 physical cranes.');

context.window.WcsApi = { request: async () => [] };
app.s7Link.gatewayOnline = true;
app.s7Link.devices = [{ id: 'sim-device', name: 'TC01-SIM', ipAddress: '127.0.0.1' }];
assert.equal(app.findCraneSignalDevice(app.sharedCranes[0])?.id, 'sim-device', 'TC01 must match the local TC01-SIM gateway device');
app.craneSignals.set('TC01', {
  deviceId: 'sim-device', deviceState: 'online', isSimulation: true,
  block: { hasData: true, quality: 'good', lastReadAt: '2026-11-08T01:00:00+08:00' },
  tags: {
    PLC_ERROR: 1001, PLC_PATTERN: 4, PLC_DISPATCH: 0, PLC_VANSTATE: 1,
    PLC_LOCATX: 31000, PLC_LOCATY: 6200, PLC_LOCATZ: 5800
  },
  updatedAt: '2026-11-08T01:00:00+08:00'
});
app.state.selected = app.sharedCranes[0];
// The selection card is rendered by Vue (web/src/components/SelectionCard.vue); the engine
// only publishes a structured model, so assert on the model instead of DOM HTML.
const craneCard = app.selectionModel();
assert.equal(craneCard.kind, 'crane', 'Selecting a crane must publish a structured card model');
assert.equal(craneCard.signal.isSimulation, true, 'Local S7 simulation must be flagged on the card model');
const signalCard = JSON.stringify(craneCard.signal);
for (const expected of ['故障码 1001', '维护', '不可调度', '行走 X', '31,000 mm', '+800 mm'])
  assert.ok(signalCard.includes(expected), `Selected crane card must show ${expected}`);

// Display controls must never rewrite operational state, identities, layouts or
// the latest controller sample. Exercise UI handlers without advancing time.
const initialCraneObjects = Array.from(app.sharedCranes);
const operationalState = () => JSON.stringify({
  cranes: app.sharedCranes.map(crane => ({
    code: crane.code, x: crane.x, y: crane.y, targetX: crane.targetX, targetY: crane.targetY,
    state: crane.state, floor: crane.floor.def.id, taskId: crane.task?.id ?? null,
    mast: crane.mast.position.toArray(), carriage: crane.carriage.position.toArray(),
    group: crane.group.position.toArray()
  })),
  conveyors: app.floors.flatMap(floor => floor.conveyors.map(conveyor => ({
    id: conveyor.id, floor: floor.def.id, x: conveyor.x, z: conveyor.z,
    hit: conveyor.body.position.toArray(), parts: (conveyor.parts || []).map(part => part.position.toArray())
  }))),
  cells: app.floors.map(floor => floor.cells.map(cell => [cell.code, cell.occupied, Boolean(cell.alarm)])),
  signal: Array.from(app.craneSignals.entries())
});
const beforeDisplayChanges = operationalState();
const initialTaskObjects = app.sharedCranes.map(crane => crane.task);
const latestSignal = app.craneSignals.get('TC01');
// The loop is scheduled through a guard wrapper, so count scheduled frames rather than the raw callback identity.
const tickRequestsBeforeDisplayChanges = animationRequests.length;
assert.equal(tickRequestsBeforeDisplayChanges, 1, 'Scene initialization schedules one animation loop');
assert.equal(app.postFX.stats.mode, 'direct', 'A renderer stub uses the direct-render fallback');

for (const quality of ['high', 'performance', 'balanced', 'high', 'balanced']) {
  getElement('qualitySelector').value = quality;
  getElement('qualitySelector').dispatch('change');
  assert.equal(app.renderSettings.quality, quality);
  assert.equal(app.postFX.stats.quality, quality, 'UI quality changes reach the rendering pipeline');
  assert.equal(operationalState(), beforeDisplayChanges, 'Quality changes preserve operational state and PLC samples');
}
const environmentGroup = app.warehouseEnvironment.group;
assert.equal(environmentGroup.parent, app.scene, 'Warehouse context has its own scene group');
for (const visible of [false, true, false, true]) {
  getElement('showEnvironment').checked = visible;
  getElement('showEnvironment').dispatch('change');
  assert.equal(app.renderSettings.environment, visible);
  assert.equal(environmentGroup.visible, visible);
  assert.equal(operationalState(), beforeDisplayChanges, 'Environment visibility cannot alter machines or their data');
}
assert.ok(app.sharedCranes.every(crane => !belongsTo(crane.group, environmentGroup)),
  'Physical cranes must not be children of the optional warehouse context');
for (const floor of app.floors) assert.ok(!belongsTo(floor.group, environmentGroup),
  'Hiding context must not hide equipment or inventory floors');

// Workshop atmosphere: lamps, aisle haze, floor pools and drifting dust all live
// inside the optional environment group so hiding the context stays consistent.
const atmosphereMeta = app.warehouseEnvironment.metadata.atmosphere;
assert.ok(atmosphereMeta, 'The environment publishes its lighting atmosphere');
assert.ok(atmosphereMeta.lampCount >= 5, 'Every aisle carries suspended LED fixtures');
assert.ok(atmosphereMeta.bayLampCount >= 10,
  'Open-floor strips share the same high-bay lighting as the aisles');
assert.ok(atmosphereMeta.aisleHazeCount >= 5, 'Each aisle gets a warm light haze band');
assert.ok(atmosphereMeta.dustCount > 0, 'The hall contains suspended dust');
assert.equal(atmosphereMeta.exitSignCount, 3, 'Every dock door keeps an illuminated exit sign');
const atmosphereGroup = environmentGroup.getObjectByName('WorkshopAtmosphere');
assert.ok(atmosphereGroup, 'Atmosphere effects have their own group');
assert.ok(atmosphereGroup.getObjectByName('AisleFloorLightPools')?.isInstancedMesh,
  'Floor light pools are batched into one instanced draw');
const halos = atmosphereGroup.getObjectByName('LedTubeHalos');
assert.ok(halos?.isPoints, 'Lamp halos are drawn as one point cloud');
assert.ok(halos.material.transparent && halos.material.blending === THREE.AdditiveBlending,
  'Lamp halos blend additively and never hide equipment behind them');
assert.ok(!atmosphereGroup.children.some(child => child.name === 'LowBayLightShaft'),
  'No localised light shafts remain; lighting covers the whole workshop evenly');
const dust = atmosphereGroup.getObjectByName('SuspendedDust');
let dustMoved = false;
if (dust) {
  const before = Array.from(dust.geometry.getAttribute('position').array.slice(0, 12));
  app.warehouseEnvironment.updateAtmosphere(4.2);
  const after = Array.from(dust.geometry.getAttribute('position').array.slice(0, 12));
  dustMoved = before.some((value, index) => value !== after[index]);
}
assert.ok(dustMoved, 'Suspended dust drifts when the atmosphere updates');
assert.ok(dust.geometry.getAttribute('position').array.every(Number.isFinite),
  'Dust drift never produces invalid positions');
console.log(`PASS: workshop atmosphere draws ${atmosphereMeta.lampCount + atmosphereMeta.bayLampCount} LED fixtures ` +
  'across the whole hall, ' + `${atmosphereMeta.dustCount} drifting dust motes and instanced floor light pools.`);

for (const immersive of [true, false]) {
  getElement('btnImmersive').dispatch('click');
  assert.equal(app.renderSettings.immersive, immersive);
  assert.equal(context.document.body.classList.contains('immersive'), immersive);
  assert.equal(getElement('btnImmersive').getAttribute('aria-pressed'), String(immersive));
  assert.equal(operationalState(), beforeDisplayChanges, 'Immersive mode only changes the surrounding UI');
}

for (const [width, height] of [[1280, 720], [1920, 1080], [1600, 1000]]) {
  getElement('stage').clientWidth = width;
  getElement('stage').clientHeight = height;
  context.dispatchEvent(new context.Event('resize'));
  assert.equal(app.camera.aspect, width / height, 'Resize updates the camera projection');
  assert.deepEqual(app.renderer.sizeCalls.at(-1), { width, height }, 'Resize updates the existing renderer');
  assert.equal(operationalState(), beforeDisplayChanges, 'Resize cannot reconstruct or reset physical equipment');
}
for (const mode of [2, 1, 3]) {
  app.state.mode = mode;
  app.state.view = 'walk';
  app.applyMode();
  const expectedEyeBase = mode === 2 ? app.FLOOR_RISE : 0;
  assert.equal(app.cam.dTarget.y, expectedEyeBase + 1.6, 'The site view follows the selected floor at human height');
  assert.ok(app.cam.dPhi > 1.5 && app.cam.dRadius < 20, 'The site view looks into the equipment from nearby');
  assert.equal(operationalState(), beforeDisplayChanges, 'Site and floor views preserve real coordinates and PLC samples');
}
initialCraneObjects.forEach((crane, index) => {
  assert.equal(app.sharedCranes[index], crane, 'Display changes preserve physical device identity');
  assert.equal(crane.task, initialTaskObjects[index], 'Display changes preserve the existing running task');
});
assert.equal(app.craneSignals.get('TC01'), latestSignal, 'The latest PLC sample is retained by identity');
assert.equal(animationRequests.length, tickRequestsBeforeDisplayChanges,
  'Quality, environment, immersive, resize and view controls cannot accumulate animation loops');
const renderCallsBeforeFallback = app.renderer.renderCalls.length;
app.postFX.render();
assert.equal(app.renderer.renderCalls.length, renderCallsBeforeFallback + 1,
  'The no-WebGL pipeline still renders one frame through the existing renderer');
assert.equal(app.renderer.renderCalls.at(-1).scene, app.scene);
assert.equal(app.renderer.renderCalls.at(-1).camera, app.camera);
app.state.view = 'overview';
app.applyMode();
console.log('PASS: quality/context/immersive/site/resize controls preserve device identities, PLC samples and one render loop.');
const plcCrane = app.sharedCranes[0];
assert.equal(app.applyLocalPlcMotion(plcCrane), true);
assert.equal(plcCrane.x, 31, 'Local PLC millimetres drive model travel in metres');
assert.equal(plcCrane.y, 6.2, 'Local PLC millimetres drive carriage height');
assert.equal(plcCrane.state, 'alarm', 'PLC_ERROR drives the alarm lamp state');
assert.equal(plcCrane.carried.visible, true, 'PLC_VANSTATE drives the model load');
assert.equal(app.startTask(f1, plcCrane), false, 'Random demo tasks cannot overwrite a local PLC');
latestSignal.block.quality = 'bad';
latestSignal.tags.PLC_LOCATX = 1000;
app.applyLocalPlcMotion(plcCrane);
assert.equal(plcCrane.x, 31, 'A failed read freezes the last model position');
assert.equal(plcCrane.state, 'offline');
latestSignal.block.quality = 'good';
for (const [field, value] of [['gatewayOnline', false], ['deviceId', 'old-device'], ['isStale', true]]) {
  const target = field === 'gatewayOnline' ? app.s7Link : field === 'isStale' ? latestSignal.block : latestSignal;
  const previous = target[field];
  target[field] = value;
  app.applyLocalPlcMotion(plcCrane);
  assert.equal(plcCrane.x, 31, `${field} prevents stale/foreign signals from moving the model`);
  assert.equal(plcCrane.state, 'offline');
  target[field] = previous;
}
app.s7Link.devices.push({ id: 'field-device', name: 'TC01', ipAddress: '192.168.0.10', isConnected: true });
assert.equal(app.findCraneSignalDevice(plcCrane).id, 'field-device', 'An exact equipment name takes priority over a simulation suffix');
app.updateSignalLink();
assert.match(getElement('linkText').textContent, /本地模拟 · 重连中/, 'An online field PLC cannot make an offline local PLC appear online');
app.s7Link.devices.pop();
latestSignal.tags.PLC_LOCATX = 0xffffffff;
latestSignal.tags.PLC_LOCATY = 0xffffffff;
latestSignal.tags.PLC_ERROR = 0;
latestSignal.tags.PLC_PATTERN = 2;
app.applyLocalPlcMotion(plcCrane);
assert.equal(plcCrane.x, app.LEN - 0.7, 'Raw UInt32 values cannot move the model beyond its rail');
assert.equal(plcCrane.y, app.CRANE_H - 0.7, 'Raw UInt32 values cannot move the carriage beyond its mast');
assert.equal(latestSignal.tags.PLC_LOCATX, 0xffffffff, 'Model clamping preserves raw PLC feedback');
assert.equal(plcCrane.state, 'manual');
app.s7Link.devices[0].ipAddress = '192.168.0.10';
assert.equal(app.applyLocalPlcMotion(plcCrane), false, 'Demo coordinate mapping does not apply to field PLCs');
app.s7Link.devices = [];
console.log('PASS: local S7 readback drives motion/load/alarm, clamps model travel, and freezes on invalid data.');
app.s7Link.devices = app.sharedCranes.map((crane, index) => ({
  id: `fleet-${index}`, name: `${crane.code}-SIM`, ipAddress: '127.0.0.1', port: 1102 + index, isConnected: true
}));
app.sharedCranes.forEach((crane, index) => {
  app.craneSignals.set(crane.code, {
    deviceId: `fleet-${index}`, isSimulation: true,
    block: { hasData: true, quality: 'good', isStale: false },
    tags: { PLC_LOCATX: 2000 + index * 6000, PLC_LOCATY: 1000 + index * 3000,
      PLC_PATTERN: 1, PLC_ERROR: index === 3 ? 1004 : 0, PLC_VANSTATE: index % 2 }
  });
  assert.equal(app.applyLocalPlcMotion(crane), true);
  assert.equal(crane.x, 2 + index * 6, `${crane.code} follows its own PLC travel value`);
  assert.equal(crane.y, 1 + index * 3, `${crane.code} follows its own PLC lift value`);
  assert.equal(crane.carried.visible, index % 2 === 1, `${crane.code} follows its own load state`);
  assert.equal(crane.state, index === 3 ? 'alarm' : 'auto');
});
app.updateSignalLink();
assert.match(getElement('linkText').textContent, /5\/5 在线/);
app.s7Link.devices[1].isConnected = false;
app.craneSignals.get('TC02').block.quality = 'bad';
app.craneSignals.get('TC02').tags.PLC_LOCATX = 39000;
app.sharedCranes.forEach(crane => app.applyLocalPlcMotion(crane));
assert.equal(app.sharedCranes[1].x, 8, 'Only the disconnected TC02 freezes');
assert.equal(app.sharedCranes[1].state, 'offline');
assert.equal(app.sharedCranes[4].x, 26, 'TC05 keeps its independent live position');
app.updateSignalLink();
assert.match(getElement('linkText').textContent, /4\/5 在线/);
app.s7Link.devices = [];
console.log('PASS: five local PLCs drive TC01–TC05 independently with per-device fault isolation.');
app.craneSignals.clear();
app.state.selected = null;
delete context.window.WcsApi;
console.log('PASS: selected crane card renders S7 alarm/mode/dispatch/coordinates and fork center.');

function makeFleetIdle() {
  app.clearSelection();
  app.sharedCranes.forEach(crane => {
    app.finishTask(crane);
    crane.alarmUntil = 0;
  });
}

function completeTask(crane) {
  for (let frame = 0; crane.task && frame < 5000; frame++) app.stepCrane(crane, 0.06);
  assert.equal(crane.task, null, `${crane.code} must finish its task`);
  assert.equal(crane.state, 'auto', `${crane.code} must become available after completing the task`);
}

makeFleetIdle();
const sharedCrane = app.sharedCranes[0];
assert.equal(app.startTask(f1, sharedCrane), true, 'An idle shared crane must accept a 1F task');
const firstTask = sharedCrane.task;
assert.equal(firstTask.floor, f1, 'The task must retain its target floor');
assert.equal(sharedCrane.floor, f1, 'The shared device must report its current service floor');
assert.equal(app.startTask(f2, f2.cranes[0]), false, '2F must not overwrite a shared crane busy on 1F');
assert.equal(app.startTask(f1, f1.cranes[0]), false, 'A busy crane must reject a second task on the same floor');
assert.equal(sharedCrane.task, firstTask, 'Rejected dispatches must preserve the running task');
completeTask(sharedCrane);
assert.equal(app.startTask(f2, f2.cranes[0]), true, 'The same crane may serve 2F after completing its 1F task');
assert.equal(sharedCrane.task.floor, f2, 'The second task must belong to 2F');
assert.equal(sharedCrane.floor, f2, 'The shared crane service-floor state must change with its task');
assert.ok(sharedCrane.task.steps.length > 0, 'A task must contain movement steps');
assert.ok(sharedCrane.task.steps.every(step => step.y >= app.FLOOR_RISE && step.y <= app.FLOOR_RISE + app.RACK_H + 1),
  'Every 2F task target must include the upper-floor elevation exactly once');
const secondTask = sharedCrane.task;
assert.equal(app.startTask(f1, f1.cranes[0]), false, '1F must not overwrite the same physical crane while it serves 2F');
assert.equal(sharedCrane.task, secondTask, 'The upper-floor task must remain intact');
completeTask(sharedCrane);
assert.ok(sharedCrane.y >= app.FLOOR_RISE && sharedCrane.y <= app.FLOOR_RISE + app.RACK_H,
  'After serving 2F the carriage must be at a world-space upper-floor height');
app.triggerAlarm(sharedCrane, 'shared fleet regression check');
assert.equal(f1.cranes[0].state, 'alarm');
assert.equal(f2.cranes[0].state, 'alarm', 'Both floor references must report the same device alarm');
assert.equal(app.startTask(f1, sharedCrane), false, 'An alarmed shared device must reject 1F dispatches');
assert.equal(app.startTask(f2, sharedCrane), false, 'An alarmed shared device must reject 2F dispatches');
console.log('PASS: shared dispatch is mutually exclusive across floors; completed cranes accept other-floor work.');

makeFleetIdle();
assert.equal(app.startTask(f1, app.sharedCranes[0]), true);
assert.equal(app.startTask(f2, app.sharedCranes[1]), true);
app.triggerAlarm(app.sharedCranes[2], 'shared KPI regression check');
app.state.mode = 3;
app.updateKpis();
assert.equal(Number(getElement('kpiTask').textContent), 2, 'Both-floor task KPI must count each physical crane once');
assert.equal(Number(getElement('kpiAlarm').textContent), 1, 'Both-floor alarm KPI must count each physical crane once');
assert.equal(Number(getElement('kpiTotal').textContent), f1.cells.length + f2.cells.length,
  'Shared devices must not change the distinct inventory capacity of the two floors');
for (const mode of [1, 2]) {
  app.state.mode = mode;
  app.updateKpis();
  assert.equal(Number(getElement('kpiTask').textContent), 1, 'Single-floor task KPI must report work for the selected floor');
  assert.equal(Number(getElement('kpiAlarm').textContent), 1, 'A shared physical alarm must remain visible on either floor');
}
console.log('PASS: shared crane task/alarm KPIs are counted once in both-floor mode.');

app.state.mode = 3;
app.state.view = 'overview';
app.applyMode();
assert.equal(f1.group.visible, true);
assert.equal(f2.group.visible, true);
assert.equal(f1.group.position.y, 0);
assert.equal(f2.group.position.y, app.FLOOR_RISE);
assert.equal(f1.group.position.x, f2.group.position.x, 'Both floors must share the X origin');
assert.equal(f1.group.position.z, f2.group.position.z, 'Both floors must share the Z origin');
assert.equal(app.FLOOR_RISE, app.RACK_H, 'The upper rack base must meet the lower rack top without an empty gap');

// Compare the actual instances and inventory geometry at every vertical join,
// rather than only checking the floor-spacing configuration.
app.scene.updateMatrixWorld(true);
function instanceBounds(mesh, index) {
  mesh.geometry.computeBoundingBox();
  const instanceMatrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, instanceMatrix);
  const worldMatrix = new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld, instanceMatrix);
  return mesh.geometry.boundingBox.clone().applyMatrix4(worldMatrix);
}

function instanceTransform(mesh, index) {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, rotation, scale);
  return { matrix, position, scale };
}

const conveyorModels = app.floors.flatMap(floor => floor.conveyors.flatMap(conveyor => [
  { floor, conveyor, model: conveyor.model, hit: conveyor.body },
  ...(conveyor.partModels || []).map((model, index) => ({ floor, conveyor, model, hit: conveyor.parts[index] }))
]));
for (const floor of app.floors) {
  const system = floor.conveyorSystem;
  assert.ok(system?.group?.isGroup && belongsTo(system.group, floor.group),
    'Each floor must own a reusable batched physical conveyor system');
  for (const conveyor of floor.conveyors)
    assert.equal((conveyor.partModels || []).length, (conveyor.parts || []).length,
      'Each drawing extension has its own physical segment and picking volume');
}
const geometrySegments = [...conveyorModels, ...app.floors.flatMap(floor =>
  floor.conveyorSystem.metadata.segments.filter(metadata => !conveyorModels.some(descriptor => descriptor.model?.metadata === metadata))
    .map(metadata => ({ floor, conveyor: { id: metadata.id }, model: { metadata }, hit: null })))];
for (const { floor, conveyor, model, hit } of geometrySegments) {
  assert.ok(model?.metadata && (!hit || typeof model.setSelected === 'function'), `${conveyor.id} has a physical segment model`);
  const metadata = model.metadata;
  assert.ok(metadata.axis === 'x' || metadata.axis === 'z', 'A conveyor declares its material travel axis');
  assert.equal(metadata.surfaceHeight, 0.56, 'All connected conveyor segments share a 0.56 m top surface');
  assert.ok(metadata.rollerCount >= 2, 'Every physical segment needs distinct transverse rollers');
  if (hit) {
    assert.equal(metadata.x, hit.position.x, 'Physical equipment must remain aligned with its drawing hit volume');
    assert.equal(metadata.z, hit.position.z);
    const footprint = new THREE.Box3().setFromObject(hit).getSize(new THREE.Vector3());
    if (footprint.x > footprint.z * 1.15) assert.equal(metadata.axis, 'x', 'A horizontal line transports along world X');
    if (footprint.z > footprint.x * 1.15) assert.equal(metadata.axis, 'z', 'A vertical line transports along world Z');
  }

  const system = floor.conveyorSystem;
  const batches = new Map();
  system.group.traverse(object => { if (object.isInstancedMesh) batches.set(object.userData.batchKey, object); });
  const rollers = metadata.ranges.filter(range => range.batchKey === 'cylinder/roller');
  assert.equal(rollers.reduce((count, range) => count + range.count, 0), metadata.rollerCount,
    'The declared roller count matches actual cylinder instances');
  const along = metadata.axis;
  const transverse = along === 'x' ? 'z' : 'x';
  const surfaceY = floor.group.position.y + metadata.surfaceHeight;
  const alongBounds = [];
  for (const range of rollers) {
    const batch = batches.get(range.batchKey);
    assert.ok(batch && /CylinderGeometry/.test(batch.geometry.type), 'Rollers use curved cylinder geometry');
    assert.ok(range.start >= 0 && range.count > 0 && range.start + range.count <= batch.count,
      'Segment roller ranges address real, initialized instances');
    for (let index = range.start; index < range.start + range.count; index++) {
      const { matrix } = instanceTransform(batch, index);
      const axle = new THREE.Vector3(0, 1, 0).transformDirection(matrix);
      assert.ok(Math.abs(axle[transverse]) > 0.999 && Math.abs(axle[along]) < 0.001 && Math.abs(axle.y) < 0.001,
        'Roller axles must lie across the belt and perpendicular to material travel');
      const bounds = instanceBounds(batch, index);
      assert.ok(Math.abs(bounds.max.y - surfaceY) < 0.01, 'All roller tops meet the shared transport plane');
      assert.ok(bounds.min.x >= metadata.x - metadata.w / 2 - 0.001 && bounds.max.x <= metadata.x + metadata.w / 2 + 0.001 &&
        bounds.min.z >= metadata.z - metadata.depth / 2 - 0.001 && bounds.max.z <= metadata.z + metadata.depth / 2 + 0.001,
      'Roller cylinders must fit inside the segment footprint');
      alongBounds.push({ min: bounds.min[along], max: bounds.max[along] });
    }
  }
  alongBounds.sort((a, b) => a.min - b.min);
  for (let index = 1; index < alongBounds.length; index++)
    assert.ok(alongBounds[index].min > alongBounds[index - 1].max + 0.001,
      'Independent roller surfaces retain visible gaps instead of forming a solid slab');

  assert.ok(system.metadata.motion, 'The conveyor system exposes surface motion state');
  const rollerBatch = batches.get('cylinder/roller');
  assert.ok(rollerBatch.material.map, 'Roller steel carries a machined pattern so rotation is visible');
  assert.ok(rollerBatch.material.roughnessMap, 'Roller highlights shift with the machined pattern');
  const rolling = system.metadata.segments.filter(segment => segment.rollerBase?.length);
  assert.ok(rolling.length >= 2, 'Segments retain their roller transforms for runtime spin');
  const [loadedSegment, emptySegment] = rolling;
  const matrixAt = index => {
    const matrix = new THREE.Matrix4();
    rollerBatch.getMatrixAt(index, matrix);
    return Array.from(matrix.elements);
  };
  const beforeLoaded = matrixAt(loadedSegment.rollerStart);
  const beforeEmpty = matrixAt(emptySegment.rollerStart);
  system.updateMotion(0.016, 0.9, new Set([loadedSegment.id]));
  assert.equal(system.metadata.motion.activeSegments, 1,
    'Only the segments that carry a load are driven');
  assert.notDeepEqual(matrixAt(loadedSegment.rollerStart), beforeLoaded,
    'A loaded segment rolls its rollers');
  assert.deepEqual(matrixAt(emptySegment.rollerStart), beforeEmpty,
    'An empty segment stays still');
  const rollingMatrix = matrixAt(loadedSegment.rollerStart);
  system.updateMotion(0, 0.9, new Set([loadedSegment.id]));
  assert.equal(system.metadata.motion.running, false, 'A paused simulation stops every roller bed');
  assert.deepEqual(matrixAt(loadedSegment.rollerStart), rollingMatrix,
    'Pausing freezes the loaded segment exactly where it stopped');
  system.updateMotion(0.016, 0.9, new Set([loadedSegment.id]));
  system.updateMotion(0.016, 0.9, new Set());
  assert.equal(system.metadata.motion.activeSegments, 0, 'No load means no conveyor motion');

  assert.ok(metadata.legInstances?.length > 0 && metadata.footInstances?.length > 0,
    'Every segment has a floor-supported adjustable leg assembly');
  for (const reference of metadata.legInstances) {
    const batch = batches.get(reference.batchKey);
    assert.ok(batch && reference.index >= 0 && reference.index < batch.count);
    const bounds = instanceBounds(batch, reference.index);
    assert.ok(bounds.min.y >= floor.group.position.y - 0.002 && bounds.max.y < surfaceY,
      'The vertical support stays between the floor and transport surface');
    assert.ok(bounds.max.y > surfaceY - 0.2, 'The support reaches the underside of the conveyor frame');
  }
  for (const reference of metadata.footInstances) {
    const batch = batches.get(reference.batchKey);
    assert.ok(batch && reference.index >= 0 && reference.index < batch.count);
    const bounds = instanceBounds(batch, reference.index);
    assert.ok(Math.abs(bounds.min.y - floor.group.position.y) < 0.005,
      'Adjustable conveyor feet rest on the actual floor plane');
  }

  if (hit && hit !== conveyor.body) {
    assert.ok(app.pickables.includes(hit), 'Drawing extensions remain in the shared picking list');
    const centre = new THREE.Box3().setFromObject(hit).getCenter(new THREE.Vector3());
    const ray = new THREE.Raycaster(centre.clone().add(new THREE.Vector3(0, 3, 0)), new THREE.Vector3(0, -1, 0), 0, 6);
    assert.ok(ray.intersectObject(hit, false).length > 0, 'A drawing extension remains ray-selectable');
  }
}
console.log('PASS: conveyor cylinders face across travel, share one transport height, retain roller gaps, and stand on grounded supports.');

// Camera distance should simplify only the upright surface detail. Replacing
// meshes or changing their bounds would move the physical rack grid or picking
// targets as the camera crosses a quality threshold.
for (const floor of app.floors) {
  const rack = floor.rack;
  const posts = floor.posts;
  assert.equal(typeof rack.updateLOD, 'function', 'Rack sections support distance-based surface detail');
  assert.equal(rack.metadata.currentDetail, 'high', 'A newly built rack starts with its close-view detail');
  posts.geometry.computeBoundingBox();
  const originalBounds = posts.geometry.boundingBox.clone();
  const instanceCount = posts.count;
  const instanceAttribute = posts.instanceMatrix;
  const transforms = Array.from(posts.instanceMatrix.array);
  const highGeometry = posts.geometry;
  const highVertexCount = highGeometry.getAttribute('position').count;
  const assertRackIdentity = () => {
    assert.equal(floor.posts, posts, 'LOD keeps the same scene-level upright mesh');
    assert.equal(rack.posts, posts, 'LOD keeps the same section-level upright mesh');
    assert.equal(posts.count, instanceCount, 'LOD preserves all physical upright instances');
    assert.equal(posts.instanceMatrix, instanceAttribute, 'LOD reuses the original instance buffer');
    assert.deepEqual(Array.from(posts.instanceMatrix.array), transforms, 'LOD does not modify any upright transform');
    posts.geometry.computeBoundingBox();
    assert.ok(posts.geometry.boundingBox.equals(originalBounds), 'Near and far detail have exactly identical physical bounds');
    assert.equal(rack.metadata.postTriangles, posts.geometry.getAttribute('position').count / 3,
      'Reported triangle cost follows the active geometry');
  };

  for (const [quality, near, far] of [['balanced', 18, 24], ['high', 35, 45], ['performance', 10, 14]]) {
    const middle = (near + far) / 2;
    rack.updateLOD(0, quality);
    assert.equal(rack.metadata.currentDetail, 'high');
    rack.updateLOD(far, quality);
    assert.equal(posts.geometry, highGeometry, 'An exact far threshold does not prematurely remove close detail');
    rack.updateLOD(far + 1, quality);
    assert.equal(rack.metadata.currentDetail, 'low');
    const lowGeometry = posts.geometry;
    assert.ok(lowGeometry.getAttribute('position').count < highVertexCount,
      'Distant upright geometry actually reduces vertex cost');
    assertRackIdentity();
    for (const distance of [middle, middle + 0.2, middle - 0.2, middle, near]) {
      rack.updateLOD(distance, quality);
      assert.equal(posts.geometry, lowGeometry, 'Mid-distance camera jitter cannot repeatedly rebuild or flip far detail');
    }
    rack.updateLOD(near - 1, quality);
    assert.equal(rack.metadata.currentDetail, 'high');
    assert.equal(posts.geometry, highGeometry, 'Approaching the rack restores the existing detailed geometry');
    assertRackIdentity();
    for (const distance of [middle, middle - 0.2, middle + 0.2, middle]) {
      rack.updateLOD(distance, quality);
      assert.equal(posts.geometry, highGeometry, 'Mid-distance camera jitter preserves close detail after approach');
    }
  }
  rack.updateLOD(0, 'balanced');
  assertRackIdentity();
}
console.log('PASS: rack LOD reduces distant vertices with stable bounds, mesh identity, instance transforms and hysteresis.');

// The rack must support both edges of each storage row. A single line of posts
// down the row centre leaves the shelf and its load visually unsupported.
for (const floor of app.floors) {
  const postCentres = Array.from({ length: floor.posts.count }, (_, index) =>
    instanceTransform(floor.posts, index).position);
  const rowCentres = [...new Set(floor.cells.map(cell => cell.z))];
  for (const rowZ of rowCentres) {
    const rowPosts = postCentres.filter(position => Math.abs(position.z - rowZ) < app.CFG.rackD * 0.8);
    for (const side of [-1, 1]) {
      const edgePosts = rowPosts.filter(position => (position.z - rowZ) * side > app.CFG.rackD * 0.3);
      assert.ok(edgePosts.length > 1, `${floor.def.label} rack row ${rowZ} needs front and rear upright support`);
      assert.ok(Math.min(...edgePosts.map(position => position.x)) < app.CFG.bayW * 0.15,
        'Each rack edge must have support at the first bay');
      assert.ok(Math.max(...edgePosts.map(position => position.x)) > app.LEN - app.CFG.bayW * 0.15,
        'Each rack edge must have support at the final bay');
    }
  }
}
console.log('PASS: each rack row has front and rear upright support across its full length.');
assert.equal(f1.posts.count, f2.posts.count, 'Both rack sections must have matching supporting columns');
for (let index = 0; index < f1.posts.count; index++) {
  const lower = instanceBounds(f1.posts, index);
  const upper = instanceBounds(f2.posts, index);
  assert.ok(Math.abs(lower.max.y - upper.min.y) < 1e-9,
    `Rack column ${index} must meet at the floor boundary without a vertical gap`);
  for (const axis of ['x', 'z']) {
    assert.ok(Math.abs(lower.min[axis] - upper.min[axis]) < 1e-9 &&
      Math.abs(lower.max[axis] - upper.max[axis]) < 1e-9,
    `Rack column ${index} must remain aligned on ${axis}`);
  }
}
const columnKey = cell => `${cell.aisle}/${cell.side}/${cell.bay}`;
const upperBaseCells = new Map(f2.cells.filter(cell => cell.level === 0).map(cell => [columnKey(cell), cell]));
for (const lower of f1.cells.filter(cell => cell.level === app.CFG.levels - 1)) {
  const upper = upperBaseCells.get(columnKey(lower));
  assert.ok(upper, `Rack column ${columnKey(lower)} must continue into the upper section`);
  assert.equal(upper.x + f2.group.position.x, lower.x + f1.group.position.x);
  assert.equal(upper.z + f2.group.position.z, lower.z + f1.group.position.z);
  assert.equal((upper.y + f2.group.position.y) - (lower.y + f1.group.position.y), app.CFG.levelH,
    `Rack cells at ${columnKey(lower)} must retain normal layer spacing across the join`);
  assert.equal(upper.rackLevel, lower.rackLevel + 1,
    'Storage-layer numbering must continue across the logical floor boundary');
}
const rackLevels = new Set(app.floors.flatMap(floor => floor.cells.map(cell => cell.rackLevel)));
assert.deepEqual(Array.from(rackLevels).sort((a, b) => a - b),
  Array.from({ length: app.CFG.levels * 2 }, (_, index) => index + 1),
  'Both logical floors must form one continuous set of storage layers');
f2.slab.geometry.computeBoundingBox();
const platformBounds = f2.slab.geometry.boundingBox.clone().applyMatrix4(f2.slab.matrixWorld);
assert.ok(platformBounds.max.x < 0, 'The upper conveyor platform must stop outside the rack footprint');
assert.ok(f2.seamParts.length > 0, 'Duplicate structure at the upper base must support section display');
assert.ok(f2.seamParts.every(part => !part.visible),
  'Both-floor view must hide duplicate shelf and beam geometry at the shared rack boundary');
assert.equal(f2.grid.visible, false, 'An intermediate floor grid must not divide the continuous racks');
app.state.mode = 2;
app.applyMode();
assert.ok(f2.seamParts.every(part => part.visible),
  'Upper-floor-only view must restore its visible base shelf and beam');
app.state.mode = 3;
app.applyMode();
assert.ok(f2.seamParts.every(part => !part.visible), 'Returning to both floors must remove the duplicate join again');
console.log('PASS: continuous rack layers, aligned column joints, outer-only platform, and clean shared shelf boundary.');

// Empty slots retain stable pick instances but do not display phantom cargo or
// pallets. Both visual layers must react together when occupancy changes.
for (const floor of app.floors) {
  assert.ok(floor.cargoMesh?.isInstancedMesh && floor.palletMesh?.isInstancedMesh,
    'Cargo and pallets must retain batched instance layers');
  assert.equal(floor.cellMesh.count, floor.cells.length, 'Every slot keeps a stable picking index');
  assert.equal(floor.cargoMesh.count, floor.cells.length);
  assert.equal(floor.palletMesh.count, floor.cells.length);
  assert.equal(floor.cellMesh.userData.floor, floor, 'Transparent pick instances retain floor identity');
  assert.equal(floor.cellMesh.material.transparent, true);
  assert.equal(floor.cellMesh.material.opacity, 0, 'Pick volumes must not render as phantom cargo');
  assert.equal(floor.cellMesh.material.depthWrite, false, 'Transparent pick volumes must not occlude real cargo');
  assert.ok(app.pickables.includes(floor.cellMesh), 'Empty slots remain registered for selection');

  for (const cell of floor.cells) {
    for (const layer of [floor.cargoMesh, floor.palletMesh]) {
      const { scale } = instanceTransform(layer, cell.idx);
      assert.ok(cell.occupied ? Math.min(scale.x, scale.y, scale.z) > 0.01 : scale.lengthSq() < 1e-12,
        `${cell.code}: rendered load presence must match occupancy`);
    }
  }
  for (const cell of floor.cells.filter(candidate => candidate.occupied && (candidate.bay === 0 || candidate.bay === app.CFG.bays - 1))) {
    const cargoBounds = instanceBounds(floor.cargoMesh, cell.idx);
    const palletBounds = instanceBounds(floor.palletMesh, cell.idx);
    const baseY = floor.group.position.y + cell.level * app.CFG.levelH;
    for (const bounds of [cargoBounds, palletBounds]) {
      assert.ok(bounds.min.x > cell.x - app.CFG.bayW / 2 && bounds.max.x < cell.x + app.CFG.bayW / 2,
        'Stored loads must fit between their bay uprights');
      assert.ok(bounds.min.z > cell.z - app.CFG.rackD / 2 && bounds.max.z < cell.z + app.CFG.rackD / 2,
        'Stored loads must remain inside their rack row');
      assert.ok(bounds.min.y >= baseY + 0.04 && bounds.max.y < baseY + app.CFG.levelH - 0.1,
        'Stored loads must clear the shelf below and the beam above');
    }
    assert.ok(cargoBounds.min.y >= palletBounds.max.y - 0.02,
      'The carton load must sit on its pallet without intersecting it');
  }

  const cell = floor.cells.find(candidate => !candidate.occupied);
  assert.ok(cell, 'The fixture includes an empty slot');
  const hitBefore = instanceTransform(floor.cellMesh, cell.idx).matrix.clone();
  const alarmBefore = cell.alarm;
  const ray = new THREE.Raycaster(new THREE.Vector3(cell.x, cell.y + floor.group.position.y, cell.z + app.CFG.rackD * 2),
    new THREE.Vector3(0, 0, -1), 0, app.CFG.rackD * 4);
  assert.ok(ray.intersectObject(floor.cellMesh, false).some(hit => hit.instanceId === cell.idx),
    'A ray must intersect the transparent empty-slot picking instance');
  app.selectCell(floor, cell);
  assert.equal(app.state.selectedCell, cell);
  assert.ok(getElement('selCard').innerHTML.includes(cell.code) && getElement('selCard').innerHTML.includes('空库位'));

  app.setCell(floor, cell, true);
  for (const layer of [floor.cargoMesh, floor.palletMesh]) {
    const { scale } = instanceTransform(layer, cell.idx);
    assert.ok(Math.min(scale.x, scale.y, scale.z) > 0.01, 'Occupying a slot displays cargo and its pallet together');
  }
  assert.ok(getElement('selCard').innerHTML.includes('有货'), 'Selected slot details update when occupancy changes');
  const normalColour = new THREE.Color();
  floor.cargoMesh.getColorAt(cell.idx, normalColour);
  cell.alarm = true;
  floor.paintCell(cell);
  const alarmColour = new THREE.Color();
  floor.cargoMesh.getColorAt(cell.idx, alarmColour);
  assert.notEqual(alarmColour.getHex(), normalColour.getHex(), 'Slot alarms remain visible on the real cargo layer');
  cell.alarm = alarmBefore;
  app.setCell(floor, cell, false);
  for (const layer of [floor.cargoMesh, floor.palletMesh])
    assert.ok(instanceTransform(layer, cell.idx).scale.lengthSq() < 1e-12, 'Clearing a slot hides cargo and pallet together');
  assert.ok(instanceTransform(floor.cellMesh, cell.idx).matrix.equals(hitBefore),
    'Painting occupancy or an alarm must not move or remove the stable picking volume');
}
app.clearSelection();
console.log('PASS: empty slots remain selectable; occupancy synchronizes cargo/pallet visibility and preserves picking indices.');

function belongsTo(object, ancestor) {
  for (let node = object; node; node = node.parent) if (node === ancestor) return true;
  return false;
}
for (const crane of app.sharedCranes) {
  assert.ok(belongsTo(crane.carriage, crane.mast), 'The lift carriage must travel with the moving crane');
  assert.ok(belongsTo(crane.cab, crane.mast) && !belongsTo(crane.cab, crane.carriage),
    'The electrical cabinet must travel horizontally without lifting with the carriage');
  for (const rail of [crane.rail, crane.rail2]) {
    assert.ok(belongsTo(rail, crane.group) && !belongsTo(rail, crane.mast),
      'Longitudinal guide rails remain fixed while the crane mast travels');
  }
  const carriageBounds = new THREE.Box3().setFromObject(crane.carriage);
  const groupZ = crane.group.getWorldPosition(new THREE.Vector3()).z;
  assert.ok(carriageBounds.min.z >= groupZ - app.CFG.aisleW / 2 - 0.01 &&
    carriageBounds.max.z <= groupZ + app.CFG.aisleW / 2 + 0.01,
  'A retracted carriage and fork must fit inside its aisle without penetrating the rack');
}
console.log('PASS: crane guides remain fixed, the cabinet follows travel, and the retracted fork fits the aisle.');

app.state.view = 'top';
app.applyMode();
assert.ok(app.cam.dPhi < 0.3, 'Both-floor top view must retain its top-down camera angle');
app.state.view = 'overview';
app.applyMode();
makeFleetIdle();
assert.equal(app.startTask(f2, f2.cranes[0]), true);
completeTask(f2.cranes[0]);
app.selectCrane(f2.cranes[0]);
assert.ok(app.cam.dTarget.y > app.FLOOR_RISE, '2F crane focus must include the floor elevation');
assert.ok(app.cam.dTarget.y < app.FLOOR_RISE + app.RACK_H, '2F crane focus must remain within the crane height');
app.applyView('aisle');
assert.ok(app.cam.dTarget.y > app.FLOOR_RISE, '2F aisle focus must include the floor elevation');

makeFleetIdle();
assert.equal(app.startTask(f2, sharedCrane), true);
const fleetBeforeSwitch = app.sharedCranes.map(crane => ({
  crane, task: crane.task, state: crane.state, floor: crane.floor, x: crane.x, y: crane.y,
  cabPosition: crane.cab.position.clone(), cabScale: crane.cab.scale.clone(),
  carriagePosition: crane.carriage.position.clone(), mastPosition: crane.mast.position.clone()
}));
const conveyorsBeforeSwitch = app.floors.flatMap(floor => floor.conveyors.map(conveyor => ({
  conveyor, x: conveyor.x, z: conveyor.z, position: conveyor.body.position.clone(),
  parts: (conveyor.parts || []).map(part => part.position.clone())
})));
for (const mode of [1, 2, 3, 2, 1, 3]) {
  app.state.mode = mode;
  app.state.view = 'overview';
  app.applyMode();
  assert.equal(f1.group.visible, mode !== 2, `1F visibility in mode ${mode}`);
  assert.equal(f2.group.visible, mode !== 1, `2F visibility in mode ${mode}`);
  assert.equal(app.visibleFloors().length, mode === 3 ? 2 : 1);
  assert.equal(app.state.selected, null, 'Switching floors clears stale device selection');
  assert.equal(f1.group.position.x, 0);
  assert.equal(f2.group.position.x, 0);
  assert.equal(f1.group.position.z, 0);
  assert.equal(f2.group.position.z, 0);
  if (mode === 3) assert.equal(f2.group.position.y, app.FLOOR_RISE);
  for (const before of fleetBeforeSwitch) {
    assert.equal(before.crane.task, before.task, 'Floor display changes must preserve the same running task');
    assert.equal(before.crane.state, before.state, 'Floor display changes must preserve physical device state');
    assert.equal(before.crane.floor, before.floor, 'Floor display changes must not change the device service floor');
    assert.equal(before.crane.x, before.x, 'Floor display changes must not teleport the physical device horizontally');
    assert.equal(before.crane.y, before.y, 'Floor display changes must not teleport the carriage vertically');
    assert.ok(before.crane.cab.position.equals(before.cabPosition) && before.crane.cab.scale.equals(before.cabScale),
      'Section display must not move or resize the electrical cabinet');
    assert.ok(before.crane.carriage.position.equals(before.carriagePosition),
      'Section display must preserve the lift group transform');
    assert.ok(before.crane.mast.position.equals(before.mastPosition),
      'Section display must preserve the physical travel group transform');
  }
  for (const before of conveyorsBeforeSwitch) {
    assert.equal(before.conveyor.x, before.x, 'Floor switching must preserve conveyor layout coordinates');
    assert.equal(before.conveyor.z, before.z);
    assert.ok(before.conveyor.body.position.equals(before.position),
      'Floor switching must not move conveyor hit volumes within their floor');
    (before.conveyor.parts || []).forEach((part, index) => assert.ok(part.position.equals(before.parts[index]),
      'Floor switching must not move extension hit volumes'));
  }
  app.renderAisleList();
  const listHtml = getElement('aisleList').innerHTML;
  assert.equal((listHtml.match(/class="aisle-row/g) || []).length, 5,
    'Every display mode must list the same five shared devices once');
  for (const crane of app.sharedCranes) {
    assert.equal((listHtml.match(new RegExp('a-dev">' + crane.code, 'g')) || []).length, 1,
      `${crane.code} must appear only once in the physical fleet list`);
  }
  app.renderLineMap();
}
console.log('PASS: floor switching preserves shared tasks and carriage positions; fleet rows remain unique.');
console.log('PASS: stacked origins, top view, and elevated 2F focus.');

if (app.selectConveyor) {
  app.state.mode = 3;
  app.applyMode();
  const conveyor = f2.conveyors.find(item => String(item.id) === '2056');
  app.selectConveyor(conveyor);
  assert.ok(getElement('selCard').innerHTML.includes('2056'), 'The selected conveyor card must show its ID');
  assert.ok(getElement('selCard').innerHTML.includes('2F'), 'The selected conveyor card must show its floor');
  assert.ok(app.cam.dTarget.y >= app.FLOOR_RISE, '2F conveyor focus must include the floor elevation');
  console.log('PASS: conveyor selection displays the correct ID/floor and uses its floor elevation.');

  const materialSnapshot = new Map();
  for (const floor of app.floors) floor.conveyorSystem.group.traverse(object => {
    for (const material of [object.material].flat().filter(Boolean)) if (material.isMeshStandardMaterial)
      materialSnapshot.set(material, JSON.stringify({
        color: material.color.getHex(), emissive: material.emissive.getHex(), emissiveIntensity: material.emissiveIntensity,
        roughness: material.roughness, metalness: material.metalness, opacity: material.opacity
      }));
  });
  const extended = f1.conveyors.find(candidate => candidate.partModels?.length > 0);
  assert.ok(extended, 'The drawing fixture includes an extended conveyor');
  for (const selected of [extended, conveyor, f1.conveyors[0], null]) {
    if (selected) app.selectConveyor(selected); else app.clearSelection();
    assert.equal(app.state.selectedConveyor, selected);
    for (const descriptor of conveyorModels) {
      const selection = descriptor.floor.conveyorSystem.group.getObjectByName(descriptor.model.metadata.selectionName);
      assert.ok(selection?.isLineSegments, 'Each segment has an independently controlled selection outline');
      assert.equal(selection.visible, descriptor.conveyor === selected,
        'Selection highlights all parts of one device and clears every other device');
    }
    for (const [material, snapshot] of materialSnapshot) assert.equal(JSON.stringify({
      color: material.color.getHex(), emissive: material.emissive.getHex(), emissiveIntensity: material.emissiveIntensity,
      roughness: material.roughness, metalness: material.metalness, opacity: material.opacity
    }), snapshot, 'Selecting equipment must not mutate shared steel or roller PBR materials');
  }
  console.log('PASS: selection highlights one complete device and leaves shared conveyor materials unchanged.');

  app.selectConveyor(conveyor);
  const alarmTarget = f1.conveyors[0];
  const alarm = app.triggerConveyorAlarm(alarmTarget, 'Conveyor model regression check');
  assert.equal(alarm.active, true);
  assert.equal(app.state.selectedConveyor, conveyor, 'An equipment alarm must preserve an existing device selection');
  assert.equal(alarmTarget.body.material.opacity, 0, 'Alarm display must not reveal the transparent hit block');
  app.clearTransientAlarms(17000);
  assert.equal(alarm.active, false, 'Transient conveyor alarms can be cleared with the new physical model');
  assert.equal(app.state.selectedConveyor, conveyor, 'Clearing an alarm must preserve an unrelated selected device');
  app.clearSelection();
  for (const [material, snapshot] of materialSnapshot) assert.equal(JSON.stringify({
    color: material.color.getHex(), emissive: material.emissive.getHex(), emissiveIntensity: material.emissiveIntensity,
    roughness: material.roughness, metalness: material.metalness, opacity: material.opacity
  }), snapshot, 'Alarm and reset must not recolor shared conveyor PBR materials');
  console.log('PASS: conveyor alarm and reset preserve selection and never expose the solid picking block.');
}

app.state.mode = 3;
app.state.view = 'overview';
app.applyMode();
makeFleetIdle();
assert.equal(app.startTask(f1, sharedCrane), true);
sharedCrane.x = 0;
sharedCrane.y = 1.05;
assert.ok(sharedCrane.task.steps[0].x >= 0.75, 'The smoke-test task must require more than one frame of travel');
const palletPositions = app.floors.flatMap(floor => floor.pallets.map(pallet => ({
  pallet, x: pallet.m.position.x
})));
app.tick(1060);
assert.ok(Math.abs(sharedCrane.x - 9.5 * 0.06) < 1e-9,
  'One animation frame must advance a shared physical device exactly once, despite its two floor references');
assert.equal(sharedCrane.mast.position.x, sharedCrane.x, 'The one physical model must reflect the device position');
app.tick(1120);
for (const { pallet, x } of palletPositions) {
  assert.ok(pallet.m.position.x >= pallet.startX && pallet.m.position.x <= pallet.endX,
    'An animated pallet must remain on its branch');
  const wrapped = Math.abs(pallet.m.position.x - x) > (pallet.endX - pallet.startX) / 2;
  if (!wrapped) {
    assert.equal(Math.sign(pallet.m.position.x - x), Math.sign(pallet.speed),
      'Pallet travel must follow the branch arrow direction');
  }
}
app.scene.updateMatrixWorld(true);
for (const floor of app.floors) for (const pallet of floor.pallets) {
  const bounds = new THREE.Box3().setFromObject(pallet.m);
  const transportY = floor.group.position.y + 0.56;
  assert.ok(bounds.min.y >= transportY && bounds.min.y <= transportY + 0.025,
    'Moving pallet loads must sit on the rollers instead of intersecting or floating above them');
  assert.ok(bounds.max.y > bounds.min.y && bounds.max.x > bounds.min.x && bounds.max.z > bounds.min.z,
    'Moving pallet loads retain finite physical volume');
}
// 输送线只在有载时运动：托盘必须能解析出自己所在的机段，空线段不得转动。
for (const floor of app.floors) {
  const ids = new Set(floor.conveyorSystem.metadata.segments.map(segment => segment.id));
  const withSegments = floor.pallets.filter(pallet => pallet.segments?.length);
  assert.equal(withSegments.length, floor.pallets.length,
    'Every moving pallet resolves the conveyor segments it rides on');
  for (const pallet of floor.pallets)
    for (const segment of pallet.segments) assert.ok(ids.has(segment.id),
      'A pallet only references segments that exist in its floor conveyor system');
}
getElement('showInventory').checked = true;
app.state.paused = false;
app.tick(1150);
app.tick(1200);
for (const floor of app.floors) {
  const meta = floor.conveyorSystem.metadata;
  assert.ok(meta.motion.activeSegments > 0, 'Loaded segments turn while their pallet travels');
  assert.ok(meta.motion.activeSegments < meta.segmentCount,
    'Empty conveyor segments never run alongside the loaded ones');
}
const pausedFloor = app.floors[0];
app.state.paused = true;
app.tick(1260);
assert.equal(pausedFloor.conveyorSystem.metadata.motion.running, false,
  'Pausing the simulation stops every roller bed');
app.state.paused = false;
const labelToggle = getElement('showDeviceLabels');
labelToggle.checked = false;
app.tick(1180);
assert.ok(app.floors.every(floor => floor.conveyors.every(conveyor => !conveyor.label.visible)),
  'The label toggle must hide every equipment label');
labelToggle.checked = true;
app.cam.phi = app.cam.dPhi;
app.tick(1240);
assert.ok(app.floors.every(floor => floor.conveyors.every(conveyor => conveyor.label.visible)),
  'Overview must show both floors equipment labels when enabled');
app.state.view = 'top';
app.applyMode();
app.cam.phi = app.cam.dPhi;
app.tick(1300);
assert.ok(f1.conveyors.every(conveyor => !conveyor.label.visible),
  'Stacked top view must suppress overlapping lower-floor equipment labels');
assert.ok(f2.conveyors.every(conveyor => conveyor.label.visible),
  'Stacked top view must retain upper-floor equipment labels');
console.log('PASS: rendering-loop smoke test, directional pallet travel, and label visibility.');
console.log('PASS: a shared crane advances once per frame, rather than once per floor.');

app.scene.updateMatrixWorld(true);
const inspectedGeometries = new Set();
app.scene.traverse(object => {
  for (const component of [...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray(), ...object.matrixWorld.elements])
    assert.ok(Number.isFinite(component), `${object.name || object.type} has finite transforms`);
  if (object.isInstancedMesh) {
    for (const component of object.instanceMatrix.array.subarray(0, object.count * 16))
      assert.ok(Number.isFinite(component), `${object.name || object.type} has finite instance transforms`);
  }
  if (object.geometry && !inspectedGeometries.has(object.geometry)) {
    inspectedGeometries.add(object.geometry);
    for (const component of object.geometry.attributes.position?.array || [])
      assert.ok(Number.isFinite(component), 'Shared model geometry must not contain NaN or Infinity');
  }
});
console.log('PASS: all model geometry and rendered instance transforms remain finite after tasks and floor switching.');

// CV feedback is split into independent DB600 read slices. A segment's three
// points can belong to different slices, and all three must be fresh to animate.
function makeConveyorDetail(code, overrides = {}) {
  const bindings = context.WCS_CONVEYOR_S7_MAPPING[code];
  const fields = ['stateTag', 'hasGoodsTag', 'trayCodeTag'];
  return {
    id: `${code}-device`, name: `${code}-SIM`, ipAddress: '127.0.0.1', isSimulation: true, state: 'online',
    blocks: fields.map((field, index) => ({
      id: `${code}-slice-${index}`, decoder: `${code.toLowerCase()}-0${index + 1}`, dbNumber: 600,
      hasData: true, quality: 'good', isStale: false, lastReadAt: '2026-11-09T01:00:00+08:00',
      tags: bindings.map(binding => ({ name: binding[field], value: overrides[binding.id]?.[index] ?? (index === 2 ? '' : 0) }))
    }))
  };
}

context.window.WcsApi = { request: async () => [] };
app.s7Link.gatewayOnline = true;
app.s7Link.loading = true; // Test snapshots directly; avoid asynchronous fixture replacement.
app.s7Link.devices = ['CV01', 'CV02'].map((code, index) => ({
  id: `${code}-device`, name: `${code}-SIM`, ipAddress: '127.0.0.1', port: 1107 + index, isConnected: true
}));
const conveyorDevices = [...app.s7Link.devices];
app.s7Link.devices.push(...app.sharedCranes.map(crane => ({
  id: crane.code + '-device', name: crane.code + '-SIM', ipAddress: '127.0.0.1', isConnected: true
})));
app.updateSignalLink();
assert.match(getElement('linkText').textContent, /7\/7 在线/, 'The link counts all five TC and both CV simulators');
app.s7Link.devices = conveyorDevices;
const liveExtended = f1.conveyors.find(c => c.partModels.length);
const cvAlarm = f1.conveyors.find(c => c !== liveExtended);
const cvUnknown = f1.conveyors.find(c => c !== liveExtended && c !== cvAlarm);
const upperLive = f2.conveyors.find(c => String(c.id) === '2001');
const cv1Detail = makeConveyorDetail('CV01', {
  [liveExtended.id]: [1, 1, '0'],
  [cvAlarm.id]: [2, 1, '000123<img src=x onerror="alert(1)">&'],
  [cvUnknown.id]: [99, 1, '000789']
});
const cv2Detail = makeConveyorDetail('CV02', { 2001: [1, 1, '000456'] });
app.conveyorSignals.set('CV01', app.conveyorSignalFromDetail(cv1Detail));
app.conveyorSignals.set('CV02', app.conveyorSignalFromDetail(cv2Detail));
const cv1Running = app.applyConveyorPlcMotion(f1);
const cv2Running = app.applyConveyorPlcMotion(f2);
assert.equal(f1.conveyors.filter(c => app.getConveyorSignal(c).mapped).length, 96);
assert.equal(f2.conveyors.filter(c => app.getConveyorSignal(c).mapped).length, 55);
assert.ok(cv1Running.has(liveExtended.id));
for (const part of liveExtended.partModels)
  assert.ok(cv1Running.has(part.metadata.id), 'An extension follows the feedback of its physical equipment');
assert.equal(cv1Running.size, 1 + liveExtended.partModels.length);
assert.ok(cv2Running.has('2001'));
assert.ok(!cv1Running.has(cvUnknown.id), 'Unknown nonzero states cannot be interpreted as running');
assert.ok(!cv1Running.has(cvAlarm.id), 'An alarmed segment cannot keep turning');
assert.equal(cvAlarm.model.metadata.alarm, true);
assert.equal(cvUnknown.model.metadata.alarm, false);
assert.equal(liveExtended.plcLoad.visible, true);
assert.equal(upperLive.plcLoad.visible, true);
const extendedGoodsPoint = cv1Detail.blocks[1].tags.find(tag =>
  tag.name === app.getConveyorSignal(liveExtended).binding.hasGoodsTag);
extendedGoodsPoint.value = 2;
// Stored point values are immutable decoded samples, so replace the detail
// snapshot as the next gateway poll would do after a controller value changes.
app.conveyorSignals.set('CV01', app.conveyorSignalFromDetail(cv1Detail));
assert.ok(!app.applyConveyorPlcMotion(f1).has(liveExtended.id), 'Unknown occupancy values cannot start a segment');
assert.equal(liveExtended.plcLoad.visible, false);
extendedGoodsPoint.value = 1;
app.conveyorSignals.set('CV01', app.conveyorSignalFromDetail(cv1Detail));
app.applyConveyorPlcMotion(f1);
assert.ok(app.floors.every(F => F.pallets.every(p => !p.m.visible)), 'Configured CV groups hide all original demo pallets');
const unmappedConveyor = f2.conveyors.find(c => String(c.id) === '2056');
assert.equal(app.getConveyorSignal(unmappedConveyor).mapped, false);
assert.equal(unmappedConveyor.plcLoad, undefined, '2056 cannot acquire an invented occupancy signal');
app.renderConveyorCard(unmappedConveyor);
assert.match(getElement('selCard').innerHTML, /2056.*未提供 PLC 点位映射|未提供 PLC 点位映射.*2056/);
app.renderConveyorCard(liveExtended);
assert.ok(getElement('selCard').innerHTML.includes('mono">0</span>'), 'String barcode "0" is preserved');
app.renderConveyorCard(cvAlarm);
const escapedBarcodeCard = getElement('selCard').innerHTML;
assert.ok(escapedBarcodeCard.includes('000123&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;'));
assert.ok(!escapedBarcodeCard.includes('<img'), 'PLC strings cannot create HTML elements in the details card');
assert.ok(escapedBarcodeCard.includes(app.getConveyorSignal(cvAlarm).sourceId));
assert.ok(escapedBarcodeCard.includes('DB600') && escapedBarcodeCard.includes('报警（2）'));
assert.equal(app.triggerConveyorAlarm(liveExtended, 'demo alarm'), null, 'Demo alarms cannot replace PLC segment feedback');
console.log('PASS: CV01/CV02 map 151 real segments, preserve 2056 as unmapped, and drive separate load, extension and alarm states.');

getElement('showInventory').checked = false;
app.applyConveyorPlcMotion(f1);
assert.equal(liveExtended.plcLoad.visible, false);
getElement('showInventory').checked = true;
app.applyConveyorPlcMotion(f1);
assert.equal(liveExtended.plcLoad.visible, true);
assert.equal(liveExtended.plcLoad.position.y, app.CFG.conveyorSurfaceH);
const stillPalletX = liveExtended.plcLoad.position.x;
app.tick(1400);
app.tick(1460);
assert.equal(liveExtended.plcLoad.position.x, stillPalletX, 'PLC cargo marks actual segment occupancy without demo travel');
assert.ok(f1.conveyorSystem.metadata.motion.activeSegments > 0);
assert.ok(f2.conveyorSystem.metadata.motion.activeSegments > 0);
cv1Detail.blocks[2].quality = 'bad';
cv1Detail.blocks[2].isStale = true;
app.s7Link.devices[0].isConnected = false;
app.tick(1520);
assert.equal(f1.conveyorSystem.metadata.motion.activeSegments, 0, 'One invalid barcode slice stops that floor\'s derived motion');
assert.equal(liveExtended.plcLoad.visible, false);
assert.equal(cvAlarm.model.metadata.alarm, false, 'An invalid sample cannot show a current PLC alarm');
assert.ok(f2.conveyorSystem.metadata.motion.activeSegments > 0, 'A CV01 failure cannot stop healthy CV02 rollers');
assert.equal(upperLive.plcLoad.visible, true);
assert.ok(f1.pallets.every(p => !p.m.visible), 'A disconnected CV floor never falls back to moving demo cargo');
app.renderConveyorCard(liveExtended);
assert.match(getElement('selCard').innerHTML, /上次成功值已失效/);
cv1Detail.blocks[2].quality = 'good';
app.s7Link.devices[0].isConnected = true;
assert.equal(app.applyConveyorPlcMotion(f1).size, 0, 'Even nominal good quality cannot override an explicit stale flag');
cv1Detail.blocks[2].isStale = false;
assert.ok(app.applyConveyorPlcMotion(f1).has(liveExtended.id), 'Fresh recovery restores the same segment');
app.s7Link.devices[0].isConnected = false;
assert.equal(app.applyConveyorPlcMotion(f1).size, 0, 'A disconnected device summary invalidates an older good detail sample');
app.s7Link.devices[0].isConnected = true;
app.s7Link.gatewayOnline = false;
assert.equal(app.applyConveyorPlcMotion(f1).size, 0, 'An unavailable gateway cannot keep old CV samples in motion');
app.s7Link.gatewayOnline = true;
const cv1Signal = app.conveyorSignals.get('CV01');
cv1Signal.deviceId = 'previous-CV01-device';
assert.equal(app.applyConveyorPlcMotion(f1).size, 0, 'A previous device\'s values cannot drive a replacement CV source');
cv1Signal.deviceId = 'CV01-device';
console.log('PASS: per-slice quality, disconnection and source identity stop only the affected CV floor without demo fallback.');

const fieldCv2 = { id: 'field-CV02', name: 'CV02', ipAddress: '192.168.0.20', isConnected: true };
app.s7Link.devices.push(fieldCv2);
assert.equal(app.findConveyorSignalDevice(f2).id, fieldCv2.id);
const fieldDetail = { ...cv2Detail, id: fieldCv2.id, name: 'CV02', ipAddress: fieldCv2.ipAddress, isSimulation: false };
app.conveyorSignals.set('CV02', app.conveyorSignalFromDetail(fieldDetail));
assert.equal(app.applyConveyorPlcMotion(f2).size, 0, 'Unconfirmed field enums do not control the local demo mechanisms');
assert.equal(upperLive.plcLoad.visible, false);
app.renderConveyorCard(upperLive);
assert.match(getElement('selCard').innerHTML, /原值 1/);
assert.match(getElement('selCard').innerHTML, /现场状态枚举待核对/);
app.conveyorSignals.set('CV02', app.conveyorSignalFromDetail(cv2Detail));
context.location.search = '?equipment=CV02&conveyor=2001&deviceId=CV02-device';
assert.equal(app.selectRequestedConveyor(), true);
assert.equal(app.state.mode, 2);
assert.equal(app.state.selectedConveyor, upperLive);
assert.equal(app.findConveyorSignalDevice(f2).id, 'CV02-device', 'A simulator link selects its explicit source even if a field CV has the same equipment name');
assert.ok(app.cam.dTarget.y >= app.FLOOR_RISE);
context.location.search = '?equipment=CV01&conveyor=2001';
assert.equal(app.selectRequestedConveyor(), false, 'A CV URL cannot map a segment from the other floor');
context.location.search = '';
app.s7Link.devices = [];
assert.equal(app.applyConveyorPlcMotion(f1), null, 'A floor with no configured CV source retains its original page demo');
assert.equal(liveExtended.plcLoad.visible, false);
app.conveyorSignals.clear();
app.s7Link.loading = false;
delete context.window.WcsApi;
app.clearSelection();
console.log('PASS: selected CV links focus the right floor/source; field PLCs remain read-only until their enum mapping is confirmed.');

// 1090/1091 keep their original roller beds, drawing IDs and CV01 source
// points. Their added assemblies contain empty timber pallets, not carton loads.
const palletMachines = Array.from(app.floors).flatMap(F => Array.from(F.conveyors).filter(c => c.specialModel));
assert.deepEqual(palletMachines.map(c => String(c.id)).sort(), ['1090', '1091']);
assert.equal(f1.palletMachines.length, 2);
assert.equal(f2.palletMachines.length, 0);
const [dispenser, stacker] = ['1090', '1091'].map(id => f1.conveyors.find(c => String(c.id) === id));
assert.equal(dispenser.specialModel.metadata.type, 'dispenser');
assert.equal(stacker.specialModel.metadata.type, 'stacker');
assert.notEqual(dispenser.specialModel.metadata.state, stacker.specialModel.metadata.state,
  'The two pallet machines need independent controller state');

// Three r149 does not include instanceMatrix in Box3.setFromObject, so inspect
// the real transformed mesh instances instead of their shared unit geometries.
function assemblyBounds(group) {
  app.scene.updateMatrixWorld(true);
  const result = new THREE.Box3();
  group.traverse(object => {
    if (!object.isMesh || !object.geometry) return;
    if (object.isInstancedMesh) {
      for (let index = 0; index < object.count; index++) result.union(instanceBounds(object, index));
    } else {
      object.geometry.computeBoundingBox();
      result.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
    }
  });
  return result;
}

for (const machine of palletMachines) {
  const special = machine.specialModel;
  assert.equal(machine.floor, f1);
  assert.equal(special.group.parent, f1.group);
  assert.equal(special.group.position.x, machine.x);
  assert.equal(special.group.position.z, machine.z);
  assert.equal(special.metadata.surfaceHeight, app.CFG.conveyorSurfaceH);
  assert.ok(special.metadata.height > app.CFG.conveyorSurfaceH + 1,
    'An upright pallet magazine must rise well above its ordinary roller bed');
  assert.equal(special.metadata.existingRollerBed, true);
  assert.equal(special.metadata.staticStackIsIllustrative, true, 'The drawn stack is not a fabricated live inventory count');
  const frame = special.group.getObjectByName('pallet-magazine-frame');
  const stock = special.group.getObjectByName('pallet-magazine-static-stack');
  const transportPallet = special.group.getObjectByName('pallet-magazine-conveyor-pallet');
  assert.ok(frame?.isGroup && stock?.isGroup && transportPallet?.isGroup);
  const stackMesh = stock.getObjectByName('EmptyTimberPalletStack');
  assert.ok(stackMesh?.isInstancedMesh && stackMesh.count > 1);
  assert.equal(stackMesh.count, special.metadata.staticStackCount);
  assert.equal(stackMesh.material.metalness, 0);
  assert.equal(stackMesh.material.vertexColors, true);
  assert.ok(stackMesh.geometry.getAttribute('position').count > 36,
    'An empty pallet contains separate timber planks and fork pockets');
  special.group.traverse(object => {
    assert.ok(!/carton|paper.?box/i.test(object.name), 'The pallet magazine cannot display shipping cartons');
  });
  const frameBounds = assemblyBounds(frame);
  const stackBounds = assemblyBounds(stock);
  assert.ok(frameBounds.max.y > 2 && stackBounds.max.y > app.CFG.conveyorSurfaceH + 0.5);
  const following = f1.conveyors.find(c => c.id === (machine.id === '1090' ? '1096' : '1097'));
  const nextBedEdge = following.z - following.depth / 2;
  assert.ok(assemblyBounds(special.group).max.z <= nextBedEdge + 1e-6,
    'The magazine frame and forks must leave the adjoining original conveyor clear');
  const sourceBinding = context.WCS_CONVEYOR_S7_MAPPING.CV01.find(binding => binding.id === machine.id);
  assert.equal(sourceBinding.sourceId, machine.id === '1090' ? '101090' : '101091');
  app.renderConveyorCard(machine);
  assert.ok(getElement('selCard').innerHTML.includes(machine.machineName));
  assert.match(getElement('selCard').innerHTML, /盘垛为结构示意/);
}

const materialState = material => JSON.stringify({
  color: material.color?.getHex(), emissive: material.emissive?.getHex(), emissiveIntensity: material.emissiveIntensity,
  roughness: material.roughness, metalness: material.metalness, opacity: material.opacity
});
const untouchedMaterials = new Map();
for (const F of app.floors) F.conveyorSystem.group.traverse(object => {
  for (const material of [object.material].flat().filter(Boolean)) untouchedMaterials.set(material, materialState(material));
});
stacker.specialModel.group.traverse(object => {
  for (const material of [object.material].flat().filter(Boolean)) untouchedMaterials.set(material, materialState(material));
});
app.state.mode = 3;
app.applyMode();
app.selectConveyor(dispenser);
assert.equal(dispenser.specialModel.metadata.selected, true);
assert.equal(stacker.specialModel.metadata.selected, false);
const machineAlarm = app.triggerConveyorAlarm(dispenser, 'Pallet machine regression check');
assert.equal(machineAlarm.active, true);
assert.equal(dispenser.specialModel.metadata.alarm, true);
assert.equal(stacker.specialModel.metadata.alarm, false);
for (const [material, previous] of untouchedMaterials)
  assert.equal(materialState(material), previous, 'Machine selection/alarms cannot alter another device\'s shared material');
app.clearTransientAlarms(100000);
assert.equal(dispenser.specialModel.metadata.alarm, false);
app.selectConveyor(stacker);
assert.equal(dispenser.specialModel.metadata.selected, false);
assert.equal(stacker.specialModel.metadata.selected, true);
app.clearSelection();
assert.equal(stacker.specialModel.metadata.selected, false);

for (const machine of palletMachines) machine.specialModel.setOccupied(true);
getElement('showInventory').checked = false;
getElement('showInventory').dispatch('change');
for (const machine of palletMachines) {
  const group = machine.specialModel.group;
  assert.equal(group.getObjectByName('pallet-magazine-static-stack').visible, false);
  assert.equal(group.getObjectByName('pallet-magazine-conveyor-pallet').visible, false);
  assert.equal(group.getObjectByName('pallet-magazine-frame').visible, true,
    'Hiding stock keeps the steel frame and mechanism visible');
}
getElement('showInventory').checked = true;
getElement('showInventory').dispatch('change');
for (const machine of palletMachines)
  assert.equal(machine.specialModel.group.getObjectByName('pallet-magazine-static-stack').visible, true);
dispenser.specialModel.setInventoryVisible(false);
assert.equal(dispenser.specialModel.group.getObjectByName('pallet-magazine-static-stack').visible, false);
assert.equal(stacker.specialModel.group.getObjectByName('pallet-magazine-static-stack').visible, true,
  'One controller\'s inventory visibility cannot change the other machine');
dispenser.specialModel.setInventoryVisible(true);
console.log('PASS: 1090/1091 add two tall empty-pallet machines on their original beds without cartons, map changes or shared-material mutations.');

context.window.WcsApi = { request: async () => [] };
app.s7Link.loading = true;
app.s7Link.gatewayOnline = true;
app.s7Link.devices = [{ id: 'CV01-device', name: 'CV01-SIM', ipAddress: '127.0.0.1', isConnected: true }];
const machineDetail = makeConveyorDetail('CV01', { 1090: [1, 1, '0001090'], 1091: [0, 1, '0001091'] });
function updateMachineSignal(id, status, goods = 1) {
  const binding = context.WCS_CONVEYOR_S7_MAPPING.CV01.find(item => item.id === id);
  machineDetail.blocks[0].tags.find(tag => tag.name === binding.stateTag).value = status;
  machineDetail.blocks[1].tags.find(tag => tag.name === binding.hasGoodsTag).value = goods;
  app.conveyorSignals.set('CV01', app.conveyorSignalFromDetail(machineDetail));
}
updateMachineSignal('1090', 1);
app.state.paused = false;
const dispenserStartPhase = dispenser.specialModel.metadata.phase;
const stackerStartPhase = stacker.specialModel.metadata.phase;
app.tick(1700);
assert.notEqual(dispenser.specialModel.metadata.phase, dispenserStartPhase, 'A running occupied dispenser advances its mechanism');
assert.equal(stacker.specialModel.metadata.phase, stackerStartPhase, 'A stopped stacker remains still beside the running dispenser');
assert.notEqual(dispenser.specialModel.group.getObjectByName('pallet-magazine-lift').position.y, 0,
  'The running controller moves the physical lift, not only a metadata counter');
for (const machine of palletMachines) {
  assert.equal(machine.plcLoad, undefined, 'Special machines must use an empty timber pallet instead of the generic carton load');
  assert.equal(machine.specialModel.metadata.occupied, true);
}
updateMachineSignal('1090', 2);
updateMachineSignal('1091', 1);
const stoppedDispenserPhase = dispenser.specialModel.metadata.phase;
const movingStackerPhase = stacker.specialModel.metadata.phase;
app.tick(1760);
assert.equal(dispenser.specialModel.metadata.phase, stoppedDispenserPhase, 'An alarm freezes the dispenser mechanism');
assert.equal(dispenser.specialModel.metadata.alarm, true);
assert.notEqual(stacker.specialModel.metadata.phase, movingStackerPhase, 'The independent healthy stacker continues to move');
updateMachineSignal('1090', 2, 0);
app.applyConveyorPlcMotion(f1);
assert.equal(dispenser.specialModel.group.getObjectByName('pallet-magazine-conveyor-pallet').visible, false);
assert.equal(stacker.specialModel.group.getObjectByName('pallet-magazine-conveyor-pallet').visible, true,
  'Each machine uses its own occupancy point');
app.state.paused = true;
const pausedPhases = palletMachines.map(c => c.specialModel.metadata.phase);
app.tick(1820);
assert.deepEqual(palletMachines.map(c => c.specialModel.metadata.phase), pausedPhases, 'Pause freezes both machine mechanisms');
app.state.paused = false;
machineDetail.blocks[0].quality = 'bad';
app.tick(1880);
assert.deepEqual(palletMachines.map(c => c.specialModel.metadata.phase), pausedPhases,
  'Bad PLC block quality freezes both mechanisms even while the TCP connection remains open');
machineDetail.blocks[0].quality = 'good';
app.s7Link.devices[0].isConnected = false;
app.tick(1940);
assert.deepEqual(palletMachines.map(c => c.specialModel.metadata.phase), pausedPhases, 'Lost S7 data cannot advance either mechanism');
for (const machine of palletMachines) {
  assert.equal(machine.specialModel.metadata.occupied, false);
  assert.equal(machine.specialModel.group.getObjectByName('pallet-magazine-conveyor-pallet').visible, false);
}
app.scene.updateMatrixWorld(true);
for (const machine of palletMachines) machine.specialModel.group.traverse(object => {
  for (const value of [...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray(), ...object.matrixWorld.elements])
    assert.ok(Number.isFinite(value), 'Pallet machine transforms remain finite after motion, alarms and disconnection');
  if (object.isInstancedMesh)
    for (const value of object.instanceMatrix.array.subarray(0, object.count * 16))
      assert.ok(Number.isFinite(value), 'Pallet machine instance transforms are finite');
});
app.s7Link.devices = [];
app.s7Link.loading = false;
app.conveyorSignals.clear();
delete context.window.WcsApi;
console.log('PASS: independent dispenser/stacker PLC states animate their mechanisms and freeze on stop, alarm, pause or lost data.');

console.log('All layout and interaction checks passed.');
