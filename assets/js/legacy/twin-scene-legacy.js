/* 冻结快照：/legacy.html 专用的旧版引擎，仍在脚本里直接写面板 DOM。
 * 现行引擎是 assets/js/twin-scene.js（只发布状态，面板由 Vue 渲染）。
 * 旧页仅作构建异常时的对照与回退，本文件不再跟进新功能，勿在此修 bug。 */
(function(){
  'use strict';
  // Bundled Three r149 defaults to legacy colour input; use sRGB material colours.
  if (THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;

  /* ========================= 配置 ========================= */
  const CFG = {
    aisles: 5, bays: 20, levels: 5,
    bayW: 2.0, levelH: 2.0, rackD: 1.15, aisleW: 1.9, pitch: 6.5,
    conveyorSurfaceH: 0.56
  };
  const LEN = CFG.bays * CFG.bayW;
  const RACK_H = CFG.levels * CFG.levelH;
  const ROW_OFF = CFG.aisleW / 2 + CFG.rackD / 2;
  const PLAN_SCALE = LEN / (1756 - 427);
  const SPINE_X = (282 - 427) * PLAN_SCALE;
  // 上下区货位按标准层距连续排列，上区从下区货架顶面接起。
  const FLOOR_RISE = RACK_H;
  const Z_SPAN = (CFG.aisles - 1) * CFG.pitch + 8;
  const STATUS_COLOR = { auto: 0x22c55e, task: 0xeab308, manual: 0xeab308, alarm: 0xef4444, offline: 0x94a3b8 };
  const FLOOR_DEFS = [
    { id: 1, label: '1F', base: 1000, seed: 7, fill: 0.63 },
    { id: 2, label: '2F', base: 2000, seed: 31, fill: 0.47 }
  ];
  const aisleZ = i => (i - (CFG.aisles - 1) / 2) * CFG.pitch;

  // 输送线编号（抄自 1F/2F 图纸）：每排货架左端一个工位，no=本工位编号，pair=对向工位
  // dir: IN=入库方向(绿箭头→货架)，OUT=出库方向(蓝箭头←货架)
  const ROW_STATIONS = {
    1: [
      [ {no:'1028', pair:'1029', dir:'IN' }, {no:'1024', pair:'1025', dir:'OUT'} ],
      [ {no:'1022', pair:'1023', dir:'OUT'}, {no:'1018', pair:'1019', dir:'IN' } ],
      [ {no:'1016', pair:'1017', dir:'OUT'}, {no:'1012', pair:'1013', dir:'IN' } ],
      [ {no:'1010', pair:'1011', dir:'IN' }, {no:'1006', pair:'1007', dir:'OUT'} ],
      [ {no:'1003', pair:'1004', dir:'IN' }, {no:'1001', pair:'1002', dir:'OUT'} ]
    ],
    2: [
      [ {no:'2028', pair:'2029', dir:'OUT'}, {no:'2025', pair:'2026', dir:'IN' } ],
      [ {no:'2021', pair:'2022', dir:'OUT'}, {no:'2019', pair:'2020', dir:'IN' } ],
      [ {no:'2015', pair:'2016', dir:'OUT'}, {no:'2013', pair:'2014', dir:'IN' } ],
      [ {no:'2009', pair:'2010', dir:'IN' }, {no:'2007', pair:'2008', dir:'OUT'} ],
      [ {no:'2003', pair:'2004', dir:'IN' }, {no:'2001', pair:'2002', dir:'OUT'} ]
    ]
  };
  // 图纸坐标：两层十排货架一一对齐；1F 顶部输送区保留在负 Z 方向。
  const PLAN_ROWS = [76,155,235,328,408,501,581,674,754,847];
  const rowZ = i => aisleZ(Math.floor(i / 2)) + (i % 2 ? ROW_OFF : -ROW_OFF);
  function planZ(y){
    let i = PLAN_ROWS.findIndex((v, n) => n < 9 && y <= PLAN_ROWS[n + 1]);
    if (i < 0) i = 8;
    return rowZ(i) + (y - PLAN_ROWS[i]) / (PLAN_ROWS[i + 1] - PLAN_ROWS[i]) * (rowZ(i + 1) - rowZ(i));
  }
  const planX = x => (x - 427) * PLAN_SCALE;
  const CONVEYOR_KINDS = { branch:'巷道口支线', junction:'转接输送机', trunk:'纵向输送段', header:'顶部输送段' };

  /* ========================= 基础工具 ========================= */
  function mulberry32(a){
    return function(){
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const pad2 = n => String(n).padStart(2, '0');
  const nowStr = () => {
    const d = new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  };

  /* ========================= 渲染器 / 场景 ========================= */
  const stage = document.getElementById('stage');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(stage.clientWidth, stage.clientHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.setClearColor(0x131d25, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x131d25);
  scene.fog = new THREE.Fog(0x131d25, 96, 330);

  const camera = new THREE.PerspectiveCamera(42, stage.clientWidth / stage.clientHeight, 0.15, 500);

  const lightingRig = window.WcsWarehouseLighting.setup({ renderer, scene });
  const renderSettings = { quality: 'balanced', environment: true, immersive: false };
  // 用户手动选过画质后不再自动降档，避免“画质自己跳”的困扰。
  let qualityAutoLocked = false;
  const warehouseEnvironment = window.WcsWarehouseEnvironment.create({
    length: LEN, rackHeight: FLOOR_RISE + RACK_H, aisles: CFG.aisles, pitch: CFG.pitch,
    frontX: -13, backX: LEN + 4, minZ: planZ(-255) - 2, maxZ: planZ(900) + 3,
    fx: lightingRig.fx
  });
  scene.add(warehouseEnvironment.group);
  const postFX = window.WcsPostProcessing.create({ renderer, scene, camera,
    width: stage.clientWidth, height: stage.clientHeight, quality: renderSettings.quality });

  /* ========================= 材质 ========================= */
  const M = {
    slab:     new THREE.MeshStandardMaterial({ color: 0x9aa3a6, map: window.WcsWarehouseLighting.concreteTexture(renderer), roughness: 0.62, metalness: 0.14 }),
    marking:  new THREE.MeshBasicMaterial({ color: 0xe6ecf4, transparent: true, opacity: 0.95 }),
    guide:    new THREE.MeshBasicMaterial({ color: 0xe8c98a, transparent: true, opacity: 0.9 })
  };
  const boxGeo = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const mesh = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
  };

  /* ========================= 文字标牌 ========================= */
  function makeLabel(text, opt){
    opt = opt || {};
    const fs = opt.fontSize || 46;
    const color = opt.color || '#334155';
    const bg = opt.bg || 'rgba(255,255,255,0.94)';
    const border = opt.border || 'rgba(148,163,184,0.55)';
    const pad = Math.round(fs * 0.42);
    const worldH = opt.worldH || 0.86;
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    const font = '500 ' + fs + 'px system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif';
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
    const h = fs + pad * 2;
    cv.width = w; cv.height = h;
    const c2 = cv.getContext('2d');
    c2.font = font;
    c2.textAlign = 'center';
    c2.textBaseline = 'middle';
    const r = Math.round(h * 0.28);
    c2.beginPath();
    c2.moveTo(r, 0); c2.lineTo(w - r, 0); c2.quadraticCurveTo(w, 0, w, r);
    c2.lineTo(w, h - r); c2.quadraticCurveTo(w, h, w - r, h);
    c2.lineTo(r, h); c2.quadraticCurveTo(0, h, 0, h - r);
    c2.lineTo(0, r); c2.quadraticCurveTo(0, 0, r, 0);
    c2.closePath();
    c2.fillStyle = bg; c2.fill();
    c2.lineWidth = 2; c2.strokeStyle = border; c2.stroke();
    c2.fillStyle = color;
    c2.fillText(text, w / 2, h / 2 + 1);
    const tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: false, depthWrite: false
    }));
    sp.scale.set(worldH * (w / h), worldH, 1);
    sp.renderOrder = 20;
    return sp;
  }

  /* ========================= 楼层构建 ========================= */
  const floors = [];
  const sharedCranes = [];
  const CRANE_H = FLOOR_RISE + RACK_H;
  const pickables = [];

  function buildFloor(def){
    const rand = mulberry32(def.seed);
    const group = new THREE.Group();
    const F = {
      def, group, cells: [], cellMesh: null, cellIndex: [], cranes: sharedCranes,
      pallets: [], conveyors: [], palletMachines: [], seamParts: [], aisleMarkings: [], contextLabels: [], slabY: 0
    };

    // 二层平台仅承载外侧输送区，不在连续货架中间插入整面楼板。
    const slabW = def.id === 2 ? 12.4 : LEN + 17;
    const slabStartZ = planZ(def.id === 2 ? 30 : -255);
    const slabD = planZ(900) - slabStartZ;
    const slab = mesh(boxGeo(slabW, 0.26, slabD), M.slab.clone(), def.id === 2 ? -6.3 : LEN / 2 - 5, -0.13, (planZ(900) + slabStartZ) / 2);
    F.slab = slab;
    group.add(slab);
    if (def.id === 1){
      // Extend the same concrete datum to the factory walls without overlapping the inner slab.
      const left = LEN / 2 - 5 - slabW / 2, right = left + slabW;
      const near = slabStartZ, far = planZ(900);
      const outer = { left: -14, right: LEN + 5, near: near - 3, far: far + 4 };
      const pads = [
        [outer.left, outer.near, outer.right, near], [outer.left, far, outer.right, outer.far],
        [outer.left, near, left, far], [right, near, outer.right, far]
      ];
      pads.forEach(([x1, z1, x2, z2]) => {
        if (x2 <= x1 || z2 <= z1) return;
        const surround = mesh(boxGeo(x2 - x1, 0.26, z2 - z1), M.slab, (x1 + x2) / 2, -0.13, (z1 + z2) / 2);
        group.add(surround);
      });
    }

    const grid = new THREE.GridHelper(58, 29, 0xaeb5b8, 0xc1c5c6);
    grid.position.set(15, 0.005, -6);
    grid.material.opacity = 0.20;
    grid.material.transparent = true;
    group.add(grid);
    F.grid = grid;

    const aisleStripeGeo = boxGeo(LEN + 1.2, 0.02, CFG.aisleW);
    for (let a = 0; a < CFG.aisles; a++){
      const st = mesh(aisleStripeGeo, M.marking, LEN / 2, 0.13, aisleZ(a));
      group.add(st);
      F.aisleMarkings.push(st);
    }

    /* ---------- 实物货架：双排立柱、斜撑、承重轨与连接件 ---------- */
    const rack = window.WcsRackModel.createSection({
      cfg: CFG, length: LEN, height: RACK_H, rowOffset: ROW_OFF, aisleZ, isUpper: def.id === 2
    });
    group.add(rack.group);
    F.rack = rack;
    F.posts = rack.posts;
    F.seamParts.push(...rack.seamParts);
    const dummy = new THREE.Object3D();
    /* ---------- 库位 ---------- */
    const cellCount = CFG.aisles * 2 * CFG.bays * CFG.levels;
    const cellGeo = boxGeo(CFG.bayW - 0.34, CFG.levelH - 0.44, CFG.rackD - 0.2);
    // 选取体与实物货物分开：空库位透空，仍可点击查看。
    const cellMesh = new THREE.InstancedMesh(cellGeo,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }), cellCount);
    cellMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    cellMesh.userData.noShadow = true;
    const inventory = window.WcsInventoryModel.create({ cfg: CFG, count: cellCount });
    F.inventory = inventory;
    F.cargoMesh = inventory.cargoMesh;
    F.palletMesh = inventory.palletMesh;
    group.add(inventory.group);
    const col = new THREE.Color();

    let ci = 0;
    for (let a = 0; a < CFG.aisles; a++){
      for (let s = -1; s <= 1; s += 2){
        const side = s < 0 ? 'L' : 'R';
        const rz = aisleZ(a) + s * ROW_OFF;
        for (let b = 0; b < CFG.bays; b++){
          for (let l = 0; l < CFG.levels; l++){
            const occupied = rand() < def.fill;
            const c = {
              idx: ci, aisle: a, side, bay: b, level: l, rackLevel: (def.id - 1) * CFG.levels + l + 1, occupied,
              x: b * CFG.bayW + CFG.bayW / 2,
              y: l * CFG.levelH + CFG.levelH / 2,
              z: rz,
              code: def.label + '-A' + pad2(a + 1) + '-' + side + (l + 1) + '-' + pad2(b + 1),
              batch: 'B' + (2400 + Math.floor(rand() * 90)),
              sku: 'SKU-' + (1000 + Math.floor(rand() * 3200)),
              curve: 0.86 + rand() * 0.22
            };
            F.cells.push(c);
            F.cellIndex[ci] = c;
            dummy.position.set(c.x, c.y, c.z);
            dummy.updateMatrix();
            cellMesh.setMatrixAt(ci, dummy.matrix);
            paintCell(c);
            ci++;
          }
        }
      }
    }
    cellMesh.instanceColor.needsUpdate = true;
    cellMesh.userData.floor = F;
    group.add(cellMesh);
    F.cellMesh = cellMesh;
    pickables.push(cellMesh);

    function paintCell(c){
      if (c.alarm){
        col.setHex(0xf59e0b);
      } else if (c.occupied){
        col.setHSL(0.588, 0.55, 0.40 * c.curve + 0.05);
      } else {
        col.setHex(0xd8e0ea);
      }
      cellMesh.setColorAt(c.idx, col);
      inventory.update(c);
      if (cellMesh.instanceColor) cellMesh.instanceColor.needsUpdate = true;
    }
    F.paintCell = paintCell;

    /* ---------- 巷道地面导向线 ---------- */
    for (let a = 0; a < CFG.aisles; a++){
      for (let f = -1; f <= 1; f += 2){
        const gl = mesh(boxGeo(LEN, 0.02, 0.07), M.guide, LEN / 2, 0.17, aisleZ(a) + f * (CFG.aisleW / 2 - 0.14));
        gl.castShadow = false;
        group.add(gl);
        F.aisleMarkings.push(gl);
      }
    }

    /* ---------- 按图纸逐段构建输送设备 ---------- */
    const conveyorSystem = window.WcsConveyorModel.createSystem({ surfaceHeight: CFG.conveyorSurfaceH });
    F.conveyorSystem = conveyorSystem;
    group.add(conveyorSystem.group);
    const conveyorHitMaterial = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0, depthWrite: false, colorWrite: false
    });
    const conveyorFootprints = [];
    const conveyorDefs = window.WCS_CONVEYOR_LAYOUT[def.id];
    conveyorDefs.forEach(d => {
      const x1 = planX(d.x1), x2 = planX(d.x2);
      const z1 = planZ(d.y1), z2 = planZ(d.y2);
      const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
      const w = Math.max(Math.abs(x2 - x1) - 0.025, 0.15);
      const depth = Math.max(Math.abs(z2 - z1) - 0.025, 0.15);
      const body = mesh(boxGeo(w, 0.64, depth), conveyorHitMaterial, cx, 0.32, cz);
      body.userData.noShadow = true;
      const equipment = { ...d, floor: F, body, x: cx, z: cz, w, depth };
      equipment.model = conveyorSystem.addSegment({ id: d.id, x: cx, z: cz, w, depth, kind: d.kind });
      equipment.partModels = [];
      conveyorFootprints.push({ x1, x2, z1, z2 });
      body.userData.conveyor = equipment;
      group.add(body);
      equipment.parts = (d.extensions || []).map(ext => {
        const ew = planX(ext.x2) - planX(ext.x1), ed = planZ(ext.y2) - planZ(ext.y1);
        const ex = (planX(ext.x1) + planX(ext.x2)) / 2, ez = (planZ(ext.y1) + planZ(ext.y2)) / 2;
        const part = mesh(boxGeo(ew, 0.64, ed), conveyorHitMaterial, ex, 0.32, ez);
        part.userData.noShadow = true;
        part.userData.conveyor = equipment;
        equipment.partModels.push(conveyorSystem.addSegment({ id: d.id + '-extension', x: ex, z: ez, w: ew, depth: ed, kind: 'branch', details: false }));
        conveyorFootprints.push({ x1: planX(ext.x1), x2: planX(ext.x2), z1: planZ(ext.y1), z2: planZ(ext.y2) });
        group.add(part);
        return part;
      });
      const vertical = depth > w;
      const station = ROW_STATIONS[def.id].flat().find(st => st.no === d.id || st.pair === d.id);
      const color = station ? (station.dir === 'IN' ? '#15803d' : '#1d4ed8') : '#475569';
      const machineName = def.id === 1 && (d.id === '1090' ? '拆盘机' : d.id === '1091' ? '码盘机' : '');
      const label = makeLabel(machineName ? d.id + ' · ' + machineName : d.id,
        { worldH: machineName ? 0.44 : 0.50, color, fontSize: 44 });
      label.position.set(cx + (vertical ? w / 2 + 0.65 : 0), 1.06, cz - (vertical ? 0 : depth / 2 + 0.26));
      label.userData.conveyor = equipment;
      equipment.label = label;
      equipment.station = station;
      if (def.id === 1 && (d.id === '1090' || d.id === '1091')){
        equipment.machineType = d.id === '1090' ? 'dispenser' : 'stacker';
        equipment.machineName = machineName;
        equipment.specialModel = window.WcsPalletMagazine.create({ id: d.id, type: equipment.machineType,
          x: cx, z: cz, w, depth, surfaceHeight: CFG.conveyorSurfaceH, floor: def.id });
        group.add(equipment.specialModel.group);
        F.palletMachines.push(equipment);
        const machine = equipment.specialModel.metadata;
        const frameW = machine.frameWidth || 1.18, frameD = machine.frameDepth || 1.76;
        body.scale.set((vertical ? frameW : frameD) / w, machine.height / 0.64,
          (vertical ? frameD : frameW) / depth);
        body.position.y = machine.height / 2;
        label.position.set(cx, machine.height + 0.32, cz);
      }
      group.add(label);
      F.conveyors.push(equipment);
    });
    // 两条纵向线在外侧转接工位处相连，连接桥没有独立设备编号。
    const bridgeRows = def.id === 1 ? [0,1,4,5,8] : [0,1,2,4,6,8];
    bridgeRows.forEach(r => {
      const left = planX(223), right = planX(264);
      conveyorSystem.addSegment({ id: 'bridge-' + r, x: (left + right) / 2, z: rowZ(r), w: right - left, depth: 0.75, kind: 'branch', details: false });
    });
    // 只补齐纵向间隙，避免在已编号机段下重复铺一整条实体输送机。
    function addLaneGaps(x, width, fromZ, toZ, prefix){
      let gaps = [[fromZ, toZ]];
      conveyorFootprints.filter(rect => x >= rect.x1 - 0.02 && x <= rect.x2 + 0.02).forEach(rect => {
        gaps = gaps.flatMap(([lo, hi]) => {
          if (rect.z2 <= lo || rect.z1 >= hi) return [[lo, hi]];
          const remaining = [];
          if (rect.z1 > lo) remaining.push([lo, Math.min(rect.z1, hi)]);
          if (rect.z2 < hi) remaining.push([Math.max(rect.z2, lo), hi]);
          return remaining;
        });
      });
      gaps.forEach(([lo, hi], index) => {
        if (hi - lo < 0.08) return;
        conveyorSystem.addSegment({ id: prefix + index, x, z: (lo + hi) / 2, w: width, depth: hi - lo, kind: 'trunk', details: false });
      });
    }
    const spineStart = def.id === 1 ? planZ(-21) : rowZ(0);
    addLaneGaps(SPINE_X, planX(295) - planX(269), spineStart, rowZ(9), 'inner-gap-');
    const outerStart = def.id === 1 ? planZ(-93) : rowZ(0);
    addLaneGaps(planX(205), planX(217) - planX(193), outerStart, rowZ(8), 'outer-gap-');
    conveyorSystem.finish();
    ROW_STATIONS[def.id].forEach((pair, a) => pair.forEach((st, side) => {
      const arrow = makeLabel(st.dir === 'IN' ? '→' : '←', {
        worldH: 0.65, color: st.dir === 'IN' ? '#16a34a' : '#2563eb', bg: 'rgba(255,255,255,0)', border: 'rgba(255,255,255,0)'
      });
      arrow.position.set(planX(387), 0.7, rowZ(a * 2 + side) + 0.65);
      group.add(arrow);
    }));

    const floorTag = makeLabel(def.label + ' 立体库', { worldH: 1.6, color: '#334155', bg: 'rgba(255,255,255,0.9)' });
    floorTag.position.set(LEN + 1, RACK_H + 1, rowZ(4));
    group.add(floorTag);
    F.contextLabels.push(floorTag);

    /* ---------- 巷道编号标牌 ---------- */
    for (let a = 0; a < CFG.aisles; a++){
      const lb = makeLabel('A' + pad2(a + 1), { worldH: 1.05, color: '#64748b', bg: 'rgba(255,255,255,0.78)' });
      lb.position.set(-1.4, 0.7, aisleZ(a));
      group.add(lb);
      F.contextLabels.push(lb);
    }

    /* ---------- 托盘沿实际支线及箭头方向运行 ---------- */
    // 托盘所在输送段：只有压着托盘的机段才转动，空线段保持静止。
    function laneSegmentsUnder(z, x1, x2) {
      const lo = Math.min(x1, x2) - 0.25, hi = Math.max(x1, x2) + 0.25;
      const list = [];
      F.conveyors.forEach(c => {
        if (Math.abs(c.z - z) > c.depth / 2 + 0.25) return;
        if (c.x + c.w / 2 < lo || c.x - c.w / 2 > hi) return;
        list.push({ id: c.model.metadata.id, min: c.x - c.w / 2, max: c.x + c.w / 2 });
        c.partModels.forEach(part => {
          const meta = part.metadata;
          list.push({ id: meta.id, min: meta.x - meta.w / 2, max: meta.x + meta.w / 2 });
        });
      });
      return list;
    }
    ROW_STATIONS[def.id].forEach((pair, a) => pair.forEach((st, side) => {
      const startX = planX(300), endX = planX(414);
      const z = rowZ(a * 2 + side);
      const p = window.WcsConveyorLoad.create({ width: 0.42, depth: 0.45, surfaceHeight: CFG.conveyorSurfaceH });
      p.position.set(startX + rand() * (endX - startX), CFG.conveyorSurfaceH, z);
      group.add(p);
      F.pallets.push({ m: p, startX, endX, speed: (st.dir === 'IN' ? 1 : -1) * (0.65 + rand() * 0.3), wait: 0, seed: rand(),
        segments: laneSegmentsUnder(z, startX, endX) });
    }));

    group.traverse(o => {
      if (o.isMesh && !o.userData.noShadow){
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });

    return F;
  }

  // 每个巷道仅一台跨楼层堆垛机，独立于楼层分组。
  function buildSharedCranes(){
    for (let a = 0; a < CFG.aisles; a++){
      const code = 'TC' + pad2(a + 1);
      const az = aisleZ(a);
      const model = window.WcsCraneModel.create({ height: CRANE_H, length: LEN, makeLabel, code, aisleWidth: CFG.aisleW });
      const { group: g, mast, body, cab, rail, rail2, lamp, carriage, carried, beacon, lampMat, bodyMat, hit, labelSprite } = model;
      g.position.set(0, 0, az);
      scene.add(g);
      const crane = {
        code, label: code, id: code,
        floor: floors[0], floorIds: [1, 2], aisle: a, group: g, mast, body, cab, rail, rail2, lamp,
        labelSprite, carriage, carried, beacon, lampMat, bodyMat, model,
        x: 0.7, y: 1.05, targetX: 0.7, targetY: 1.05,
        state: 'auto', task: null, dwell: 0, alarmUntil: 0, hit
      };
      mast.position.x = crane.x;
      carriage.position.y = crane.y;
      hit.userData.crane = crane;
      pickables.push(hit);
      sharedCranes.push(crane);
      g.traverse(o => { if (o.isMesh && !o.userData.noShadow) { o.castShadow = true; o.receiveShadow = true; } });
    }
  }

  function rebuildPickables(){
    pickables.length = 0;
    sharedCranes.forEach(c => pickables.push(c.hit));
    floors.forEach(F => {
      pickables.push(F.cellMesh);
      F.conveyors.forEach(c => pickables.push(c.body, c.label, ...(c.parts || [])));
    });
  }

  FLOOR_DEFS.forEach(def => {
    const F = buildFloor(def);
    floors.push(F);
    F.group.position.y = (def.id - 1) * FLOOR_RISE;
    scene.add(F.group);
  });
  buildSharedCranes();
  rebuildPickables();

  /* ========================= 相机控制 ========================= */
  const cam = {
    target: new THREE.Vector3(17, 4.4, 0),
    curTarget: new THREE.Vector3(17, 4.4, 0),
    theta: -0.34, phi: 0.85, radius: 112,
    dTheta: -0.34, dPhi: 0.85, dRadius: 112,
    dTarget: new THREE.Vector3(17, 4.4, 0)
  };
  function applyView(name){
    const two = state.mode === 3;
    const F = state.mode === 2 ? floors[1] : state.mode === 1 ? floors[0] : state.selected ? state.selected.floor : floors[0];
    if (name === 'aisle'){
      cam.dTheta = -1.555; cam.dPhi = 1.51; cam.dRadius = 24;
      cam.dTarget.set(LEN * 0.55, F.group.position.y + 3.4, state.selected ? state.selected.group.position.z : aisleZ(0));
      return;
    }
    if (name === 'walk'){
      cam.dTarget.set(-1.0, F.group.position.y + 1.6, rowZ(8));
      cam.dTheta = -0.85; cam.dPhi = 1.565; cam.dRadius = 10;
      return;
    }
    const baseY = two ? 0 : F.group.position.y;
    const maxY = (two ? FLOOR_RISE : baseY) + RACK_H + 2;
    cam.dTheta = name === 'top' ? 0 : -0.48;
    cam.dPhi = name === 'top' ? 0.025 : (two ? 1.18 : 1.07);
    cam.dTarget.set(14, (baseY + maxY) / 2, -4);
    // 按可用画布和楼层包围盒适配视角。
    const dir = new THREE.Vector3(Math.sin(cam.dPhi) * Math.sin(cam.dTheta), Math.cos(cam.dPhi), Math.sin(cam.dPhi) * Math.cos(cam.dTheta));
    const right = new THREE.Vector3(Math.cos(cam.dTheta), 0, -Math.sin(cam.dTheta));
    const up = new THREE.Vector3().crossVectors(dir, right);
    const tanV = Math.tan(camera.fov * Math.PI / 360), tanH = tanV * camera.aspect;
    let radius = 60;
    [-12, LEN + 4].forEach(x => [baseY, maxY].forEach(y => [planZ(-255), planZ(900)].forEach(z => {
      const p = new THREE.Vector3(x,y,z).sub(cam.dTarget);
      radius = Math.max(radius, p.dot(dir) + Math.abs(p.dot(right)) / tanH, p.dot(dir) + Math.abs(p.dot(up)) / tanV);
    })));
    cam.dRadius = radius * (name === 'top' ? 1.06 : 1.01);
  }
  function focusPosition(pos, radius){
    cam.dTarget.copy(pos);
    cam.dRadius = radius || 24;
    cam.dTheta = -0.95;
    cam.dPhi = 1.15;
  }

  let dragging = false, panning = false, lastX = 0, lastY = 0, downX = 0, downY = 0;
  const dom = renderer.domElement;

  dom.addEventListener('contextmenu', e => e.preventDefault());
  dom.addEventListener('pointerdown', e => {
    dragging = true;
    panning = (e.button === 2 || e.shiftKey);
    lastX = e.clientX; lastY = e.clientY;
    downX = e.clientX; downY = e.clientY;
    dom.setPointerCapture && dom.setPointerCapture(e.pointerId);
  });
  window.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (panning){
      const dir = new THREE.Vector3().subVectors(cam.dTarget, camera.position).normalize();
      const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(right, dir).normalize();
      const s = cam.radius * 0.0016;
      cam.dTarget.addScaledVector(right, -dx * s);
      cam.dTarget.addScaledVector(up, dy * s);
    } else {
      cam.dTheta -= dx * 0.005;
      cam.dPhi = clamp(cam.dPhi - dy * 0.004, 0.08, 1.5);
    }
  });
  window.addEventListener('pointerup', e => {
    if (!dragging) return;
    dragging = false; panning = false;
    const moved = Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY);
    if (moved < 6) handleClick(e);
  });
  dom.addEventListener('wheel', e => {
    e.preventDefault();
    cam.dRadius = clamp(cam.dRadius * (1 + e.deltaY * 0.0011), 2.4, 320);
  }, { passive: false });

  function updateCamera(dt){
    const k = 1 - Math.exp(-dt * 7);
    cam.theta += (cam.dTheta - cam.theta) * k;
    cam.phi += (cam.dPhi - cam.phi) * k;
    cam.radius += (cam.dRadius - cam.radius) * k;
    cam.curTarget.lerp(cam.dTarget, k);
    const sp = Math.sin(cam.phi), cp = Math.cos(cam.phi);
    camera.position.set(
      cam.curTarget.x + cam.radius * sp * Math.sin(cam.theta),
      cam.curTarget.y + cam.radius * cp,
      cam.curTarget.z + cam.radius * sp * Math.cos(cam.theta)
    );
    camera.lookAt(cam.curTarget);
  }

  /* ========================= 拾取 ========================= */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const highlightGeo = new THREE.EdgesGeometry(boxGeo(CFG.bayW - 0.22, CFG.levelH - 0.32, CFG.rackD - 0.1));
  const highlight = new THREE.LineSegments(highlightGeo, new THREE.LineBasicMaterial({ color: 0x2563eb, linewidth: 2 }));
  highlight.visible = false;
  scene.add(highlight);

  const state = { selected: null, selectedCell: null, selectedConveyor: null, paused: false, speed: 1, mode: 3, view: 'overview', alarmCount: 0 };

  /* ========================= S7 堆垛机信号绑定 ========================= */
  const FORK_CENTER_MM = 5000;
  const craneSignals = new Map();
  const conveyorSignals = new Map();
  const conveyorMappings = new Map(Object.entries(window.WCS_CONVEYOR_S7_MAPPING || {}).map(([code, bindings]) =>
    [code, new Map(bindings.filter(binding => binding.mapped).map(binding => [String(binding.id), binding]))]));
  const s7Link = { devices: [], gatewayOnline: false, loading: false };
  let focusRequestedPlc = false;
  const PLC_MODE_TEXT = { 1: '自动', 2: '手动', 3: '离线', 4: '维护' };
  const QUALITY_TEXT = { good: '新鲜', stale: '过期', bad: '异常', unknown: '未读取', disabled: '停用' };

  function isLoopbackAddress(address){
    return address === '127.0.0.1' || address === 'localhost' || address === '::1';
  }

  function findCraneSignalDevice(crane){
    return findNamedSignalDevice(crane.code);
  }

  function findNamedSignalDevice(equipmentCode){
    const code = equipmentCode.toUpperCase();
    const candidates = s7Link.devices.filter(device => {
      const name = String(device.name || '').trim().toUpperCase();
      return name === code || name.startsWith(code + '-') || name.startsWith(code + '_') || name.startsWith(code + ' ') || name.endsWith(' ' + code);
    });
    // The simulator link carries the selected device ID so a demo never masks
    // a separately configured controller with the same equipment name.
    const requestedId = typeof URLSearchParams === 'function'
      ? new URLSearchParams(location.search || '').get('deviceId') : null;
    return candidates.find(device => device.id === requestedId) ||
      candidates.find(device => String(device.name).trim().toUpperCase() === code) || candidates[0] || null;
  }

  function updateSignalLink(){
    const link = el('linkText');
    if (state.paused){ link.textContent = 'WCS 数据链路 · 已暂停'; return; }
    if (!window.WcsApi){ link.textContent = 'WCS 数据链路 · 模拟'; return; }
    if (!s7Link.gatewayOnline){ link.textContent = 'S7 网关 · 未连接'; return; }
    const simulated = s7Link.devices.filter(device => device.isSimulation || isLoopbackAddress(device.ipAddress));
    if (simulated.length){
      const online = simulated.filter(device => device.isConnected).length;
      link.textContent = simulated.length > 1 ? `S7 本地模拟 · ${online}/${simulated.length} 在线` : online ? 'S7 本地模拟 · 在线' : 'S7 本地模拟 · 重连中';
    }
    else link.textContent = s7Link.devices.some(device => device.isConnected) ? 'S7 数据链路 · 在线' : 'S7 数据链路 · 等待连接';
  }

  function signalFromDeviceDetail(detail){
    const block = detail.blocks.find(item => item.decoder === 'tc' && item.tags.length) ||
      detail.blocks.find(item => item.decoder === 'tc') || detail.blocks[0] || null;
    const tags = Object.fromEntries((block?.tags || []).map(tag => [tag.name, tag.value]));
    return {
      deviceId: detail.id,
      deviceState: detail.state,
      isSimulation: detail.isSimulation || isLoopbackAddress(detail.ipAddress),
      block,
      tags,
      updatedAt: block?.lastReadAt || detail.lastReadAt || null
    };
  }

  function hasLocalPlcSource(crane){
    const device = findCraneSignalDevice(crane);
    return Boolean(device && (device.isSimulation || isLoopbackAddress(device.ipAddress)));
  }

  function applyLocalPlcMotion(crane){
    if (!hasLocalPlcSource(crane)) return false;
    // Once a local PLC is configured, failed reads freeze its last position.
    // The random warehouse demo must not take over while it reconnects.
    const signal = craneSignals.get(crane.code);
    const device = findCraneSignalDevice(crane);
    if (crane.task) crane.task = null;
    crane.dwell = 0;
    if (!s7Link.gatewayOnline || signal?.deviceId !== device.id ||
        signal.block?.quality !== 'good' || signal.block?.isStale || !signal.block?.hasData){
      crane.state = 'offline';
      return true;
    }
    const tags = signal.tags;
    if (Number.isFinite(tags.PLC_LOCATX)) crane.x = clamp(tags.PLC_LOCATX / 1000, 0.7, LEN - 0.7);
    if (Number.isFinite(tags.PLC_LOCATY)) crane.y = clamp(tags.PLC_LOCATY / 1000, 0.7, CRANE_H - 0.7);
    crane.targetX = crane.x;
    crane.targetY = crane.y;
    crane.carried.visible = tags.PLC_VANSTATE === 1;
    crane.state = tags.PLC_ERROR ? 'alarm' : tags.PLC_PATTERN === 3 ? 'offline' :
      tags.PLC_PATTERN === 1 ? 'auto' : 'manual';
    return true;
  }

  /* CV01 serves 1F and CV02 serves 2F. The supplied source map explicitly
   * excludes missing drawing segments and never invents a source for 2056. */
  function conveyorGroupCode(F){ return F.def.id === 1 ? 'CV01' : F.def.id === 2 ? 'CV02' : null; }

  function findConveyorSignalDevice(F){
    const code = conveyorGroupCode(F);
    return code ? findNamedSignalDevice(code) : null;
  }

  function conveyorSignalFromDetail(detail){
    const points = new Map();
    (detail.blocks || []).forEach(block => {
      (block.tags || []).forEach(tag => points.set(tag.name, { value: tag.value, block, address: tag.address }));
    });
    return { deviceId: detail.id, deviceState: detail.state,
      isSimulation: detail.isSimulation || isLoopbackAddress(detail.ipAddress), points, readFailed: false };
  }

  function getConveyorSignal(c){
    const equipmentCode = conveyorGroupCode(c.floor);
    const binding = conveyorMappings.get(equipmentCode)?.get(String(c.id));
    const device = findConveyorSignalDevice(c.floor);
    const signal = conveyorSignals.get(equipmentCode);
    if (!binding) return { equipmentCode, device, mapped: false, quality: 'unknown', fresh: false };
    const matching = Boolean(device && signal?.deviceId === device.id);
    const points = matching ? [binding.stateTag, binding.hasGoodsTag, binding.trayCodeTag].map(name => signal.points.get(name)) : [];
    const complete = points.length === 3 && points.every(point => point && point.value !== null && point.value !== undefined && point.block.hasData);
    const invalidConnection = Boolean(device && (!s7Link.gatewayOnline || signal?.readFailed ||
      device.isConnected === false || device.enabled === false));
    let quality = invalidConnection ? 'bad' : !complete ? 'unknown' :
      points.some(point => point.block.quality === 'bad') ? 'bad' :
      points.some(point => point.block.quality === 'disabled') ? 'disabled' :
      points.some(point => point.block.isStale || point.block.quality === 'stale') ? 'stale' :
      points.every(point => point.block.quality === 'good') ? 'good' : 'unknown';
    if (!device || !matching) quality = 'unknown';
    const dates = points.map(point => point?.block.lastReadAt).filter(Boolean);
    const updatedAt = dates.sort((a, b) => Date.parse(a) - Date.parse(b))[0] || null;
    return { equipmentCode, device, mapped: true, binding, sourceId: binding.sourceId,
      isSimulation: Boolean(device && (device.isSimulation || isLoopbackAddress(device.ipAddress))),
      quality, hasData: complete, fresh: complete && quality === 'good',
      status: points[0]?.value ?? null, hasGoods: points[1]?.value ?? null, barcode: points[2]?.value ?? null,
      updatedAt, points };
  }

  function ensureConveyorPlcLoad(c){
    if (c.plcLoad) return c.plcLoad;
    const load = window.WcsConveyorLoad.create({ width: 0.42, depth: 0.45, surfaceHeight: CFG.conveyorSurfaceH });
    load.name = 'S7-conveyor-load-' + c.id;
    load.position.set(c.x, CFG.conveyorSurfaceH, c.z);
    load.scale.set(Math.min(1, c.w * 0.82 / 0.42), 1, Math.min(1, c.depth * 0.82 / 0.45));
    load.visible = false;
    c.floor.group.add(load);
    c.plcLoad = load;
    return load;
  }

  function applyConveyorPlcMotion(F){
    const device = findConveyorSignalDevice(F);
    const running = new Set();
    if (device) F.pallets.forEach(pallet => { pallet.m.visible = false; });
    F.conveyors.forEach(c => {
      if (!device){
        if (c.plcLoad) c.plcLoad.visible = false;
        c.specialModel?.setOccupied(false);
        if (c.plcControlled){
          c.model.setAlarm(false);
          c.partModels.forEach(part => part.setAlarm(false));
          c.specialModel?.setAlarm(false);
          c.plcControlled = false;
        }
        return;
      }
      c.plcControlled = true;
      const signal = getConveyorSignal(c);
      // Field enum meanings need site confirmation. Only the local simulator
      // uses 0=stopped, 1=running, 2=alarm, 3=offline and HASGOODS=1.
      const usable = signal.isSimulation && signal.fresh;
      if (signal.mapped && !c.specialModel){
        const load = ensureConveyorPlcLoad(c);
        load.visible = Boolean(usable && signal.hasGoods === 1 && uiFlags.inventory);
      }
      const alarm = usable && signal.status === 2;
      c.specialModel?.setOccupied(Boolean(usable && signal.hasGoods === 1));
      c.specialModel?.setAlarm(alarm);
      c.model.setAlarm(alarm);
      c.partModels.forEach(part => part.setAlarm(alarm));
      if (usable && signal.status === 1 && signal.hasGoods === 1){
        running.add(c.model.metadata.id);
        c.partModels.forEach(part => running.add(part.metadata.id));
      }
    });
    // null permits the original page demo only when no CV PLC is configured.
    // A disconnected or uncalibrated configured PLC always returns an empty set.
    return device ? running : null;
  }

  async function refreshConveyorSignals(F){
    const code = conveyorGroupCode(F);
    const device = findConveyorSignalDevice(F);
    if (!device){ conveyorSignals.delete(code); return; }
    try {
      const detail = await window.WcsApi.request(`api/s7/devices/${encodeURIComponent(device.id)}`, { timeoutMs: 3000 });
      conveyorSignals.set(code, conveyorSignalFromDetail(detail));
    } catch (_) {
      const previous = conveyorSignals.get(code);
      conveyorSignals.set(code, { ...(previous?.deviceId === device.id ? previous : { deviceId: device.id, points: new Map() }), readFailed: true });
    }
  }

  async function refreshCraneSignals(){
    if (!window.WcsApi || s7Link.loading) return;
    s7Link.loading = true;
    try {
      const devices = await window.WcsApi.request('api/s7/devices', { timeoutMs: 3000 });
      s7Link.devices = Array.isArray(devices) ? devices : [];
      s7Link.gatewayOnline = true;
      await Promise.all([...sharedCranes.map(async crane => {
        const device = findCraneSignalDevice(crane);
        if (!device){ craneSignals.delete(crane.code); return; }
        if (crane !== state.selected && !hasLocalPlcSource(crane)) return;
        try {
          const detail = await window.WcsApi.request(`api/s7/devices/${encodeURIComponent(device.id)}`, { timeoutMs: 3000 });
          craneSignals.set(crane.code, signalFromDeviceDetail(detail));
        } catch (_) { craneSignals.delete(crane.code); }
      }), ...floors.map(F => refreshConveyorSignals(F))]);
      if (focusRequestedPlc && state.selected && craneSignals.get(state.selected.code)?.block?.quality === 'good'){
        if (applyLocalPlcMotion(state.selected)){
          focusPosition(new THREE.Vector3(state.selected.x, state.selected.y, state.selected.group.position.z), 24);
        }
        focusRequestedPlc = false;
      }
      if (state.selected) renderCraneCard(state.selected);
      if (state.selectedConveyor) renderConveyorCard(state.selectedConveyor);
    } catch (_) {
      s7Link.gatewayOnline = false;
      if (state.selected) renderCraneCard(state.selected);
      if (state.selectedConveyor) renderConveyorCard(state.selectedConveyor);
    } finally {
      s7Link.loading = false;
      updateSignalLink();
    }
  }

  function formatSignalTime(value){
    if (!value) return '--:--:--';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '--:--:--' : date.toLocaleTimeString('zh-CN', { hour12: false });
  }

  function renderCraneSignal(crane){
    if (!window.WcsApi)
      return '<div class="signal-note">S7 网关未加载，当前为页面演示数据。</div>';
    if (!s7Link.gatewayOnline)
      return '<div class="signal-note">S7 网关未连接；不会用演示值替代 PLC 信号。</div>';
    const signal = craneSignals.get(crane.code);
    if (!signal)
      return '<div class="signal-note">未在 S7 网关中找到 ' + crane.code + ' 对应设备。可在“S7 设备接入”中添加同名配置。</div>';
    const block = signal.block;
    const quality = block?.quality || 'unknown';
    if (!block?.hasData)
      return '<div class="crane-source"><span class="source-badge' + (signal.isSimulation ? ' sim' : '') + '">' + (signal.isSimulation ? 'S7 本地模拟' : 'S7 现场 PLC') + '</span><time>等待首次读取</time></div><div class="signal-note">连接状态：' + signal.deviceState + '；尚未取得 ' + crane.code + ' 的 PLC 反馈值。</div>';

    const tags = signal.tags;
    const alarm = Number(tags.PLC_ERROR || 0);
    const mode = Number(tags.PLC_PATTERN || 0);
    const dispatch = Number(tags.PLC_DISPATCH || 0);
    const hasLoad = Number(tags.PLC_VANSTATE || 0);
    const x = Number.isFinite(tags.PLC_LOCATX) ? Number(tags.PLC_LOCATX) : null;
    const y = Number.isFinite(tags.PLC_LOCATY) ? Number(tags.PLC_LOCATY) : null;
    const fork = Number.isFinite(tags.PLC_LOCATZ) ? Number(tags.PLC_LOCATZ) : null;
    const forkOffset = fork === null ? null : fork - FORK_CENTER_MM;
    const forkLeft = fork === null ? 50 : Math.max(2, Math.min(98, fork / 10000 * 100));
    const qualityClass = quality === 'good' ? 'good' : quality === 'stale' ? 'warn' : 'bad';
    const alarmClass = alarm ? 'bad' : 'good';
    const modeClass = mode === 1 ? 'good' : mode === 3 ? 'bad' : 'warn';
    const dispatchClass = dispatch === 1 ? 'good' : 'bad';
    const coordinate = (label, value) => '<div class="coord-item"><span>' + label + '</span><b>' + (value === null ? '--' : value.toLocaleString('en-US') + ' mm') + '</b><small>' + (value === null ? '' : (value / 1000).toFixed(3) + ' m') + '</small></div>';
    return '<div class="crane-source">' +
      '<span class="source-badge' + (signal.isSimulation ? ' sim' : '') + '">' + (signal.isSimulation ? 'S7 本地模拟' : 'S7 现场 PLC') + '</span>' +
      '<span class="signal-tile ' + qualityClass + '" style="padding:2px 6px;border-radius:12px">' + (QUALITY_TEXT[quality] || quality) + '</span>' +
      '<time>' + formatSignalTime(signal.updatedAt) + '</time></div>' +
      '<div class="signal-grid">' +
      '<div class="signal-tile ' + alarmClass + '"><span>报警</span><b>' + (alarm ? '故障码 ' + alarm : '无报警') + '</b><small>PLC_ERROR</small></div>' +
      '<div class="signal-tile ' + modeClass + '"><span>模式</span><b>' + (PLC_MODE_TEXT[mode] || '未知(' + mode + ')') + '</b><small>PLC_PATTERN</small></div>' +
      '<div class="signal-tile ' + dispatchClass + '"><span>调度</span><b>' + (dispatch === 1 ? '可调度' : '不可调度') + '</b><small>PLC_DISPATCH</small></div>' +
      '<div class="signal-tile ' + (hasLoad === 1 ? 'warn' : 'good') + '"><span>载货台</span><b>' + (hasLoad === 1 ? '有货' : '无货') + '</b><small>PLC_VANSTATE</small></div>' +
      '</div>' +
      '<div class="coord-list">' + coordinate('行走 X', x) + coordinate('提升 Y', y) + '</div>' +
      '<div class="fork-meter"><div class="fork-meter-title"><span>叉齿位置（5000 为中位）</span><b>' + (fork === null ? '--' : fork.toLocaleString('en-US') + ' mm') + '</b></div>' +
      '<div class="fork-track"><span class="fork-center"></span><span class="fork-marker" style="left:' + forkLeft.toFixed(1) + '%"></span></div>' +
      '<div class="fork-scale"><span>0</span><span>5000 中位</span><span>10000</span></div>' +
      '<div class="signal-note">相对中位：' + (forkOffset === null ? '--' : (forkOffset >= 0 ? '+' : '') + forkOffset.toLocaleString('en-US') + ' mm') + ' · 左右方向以现场定义为准</div></div>';
  }

  function findCraneFromObject(obj){
    let o = obj;
    while (o){
      if (o.userData && o.userData.crane) return o.userData.crane;
      o = o.parent;
    }
    return null;
  }

  function handleClick(e){
    const rect = dom.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);

    const active = visibleFloors();
    const targets = sharedCranes.map(c => c.hit);
    active.forEach(F => {
      targets.push(F.cellMesh);
      F.conveyors.forEach(c => targets.push(c.body, c.label, ...(c.parts || [])));
    });
    const hits = raycaster.intersectObjects(targets, false);
    if (!hits.length){ clearSelection(); return; }

    const hit = hits[0];
    if (hit.object.userData.conveyor){ selectConveyor(hit.object.userData.conveyor); return; }
    const crane = findCraneFromObject(hit.object);
    if (crane){
      selectCrane(crane);
      return;
    }
    if (hit.object.isInstancedMesh && hit.instanceId !== undefined){
      const F = hit.object.userData.floor;
      const cell = F.cellIndex[hit.instanceId];
      if (cell) selectCell(F, cell);
    }
  }

  function selectCrane(crane){
    clearSelection(true);
    state.selected = crane;
    document.body.classList.add('equipment-selected');
    crane.bodyMat.emissive = new THREE.Color(0x714400);
    crane.bodyMat.emissiveIntensity = 0.16;
    const focusY = state.mode === 3 ? crane.y : (state.mode - 1) * FLOOR_RISE + 4.2;
    focusPosition(new THREE.Vector3(crane.x, focusY, crane.group.position.z), 24);
    renderCraneCard(crane);
    renderAisleList();
    refreshCraneSignals();
  }

  function renderCraneCard(crane){
    const st = statusText(crane.state);
    const location = crane.y >= FLOOR_RISE ? '2F' : '1F';
    document.getElementById('selCard').innerHTML =
      '<b>' + crane.code + '</b> · A0' + (crane.aisle + 1) + ' · 两层共用<br>' +
      '服务范围：1F / 2F　当前位置：' + location + '<br>' +
      '状态：<span style="color:' + st.color + '">' + st.text + '</span><br>' +
      '行走位置：<span class="mono">X ' + crane.x.toFixed(1) + ' m</span>　' +
      '载货台：<span class="mono">Y ' + crane.y.toFixed(1) + ' m</span><br>' +
      '任务楼层：' + (crane.task ? crane.task.floor.def.label : '—') + '<br>' +
      '当前任务：<span class="mono">' + (hasLocalPlcSource(crane) ? (craneSignals.get(crane.code)?.tags.PLC_TASKNO ?? '—') : crane.task ? crane.task.id + ' / ' + ({IN:'入库',OUT:'出库',MOVE:'移库'}[crane.task.type]) : '—') + '</span>' +
      (hasLocalPlcSource(crane) ? '<div class="signal-note">本地 PLC 驱动模型 · 1 mm = 0.001 m，超出行程时模型限幅。货叉位置见下方刻度。</div>' : '') +
      renderCraneSignal(crane);
  }

  function selectCell(F, cell){
    clearSelection(true);
    state.selectedCell = cell;
    const gp = F.group.position;
    highlight.position.set(cell.x + gp.x, cell.y + gp.y, cell.z + gp.z);
    highlight.visible = true;
    document.getElementById('selCard').innerHTML =
      '<b>库位 ' + cell.code + '</b><br>' +
      '状态：' + (cell.occupied ? '有货' : '空库位') + '<br>' +
      '货品：<span class="mono">' + (cell.occupied ? cell.sku : '—') + '</span>　批次：<span class="mono">' + (cell.occupied ? cell.batch : '—') + '</span><br>' +
      '楼层：' + F.def.label + '　巷道：A0' + (cell.aisle + 1) + '　侧：' + (cell.side === 'L' ? '左排' : '右排') +
      '　货架层：' + cell.rackLevel + '（' + F.def.label + ' 第 ' + (cell.level + 1) + ' 层）　列：' + pad2(cell.bay + 1);
  }

  function selectConveyor(c){
    clearSelection(true);
    state.selectedConveyor = c;
    document.body.classList.add('equipment-selected');
    c.model.setSelected(true);
    c.specialModel?.setSelected(true);
    c.partModels.forEach(model => model.setSelected(true));
    const gp = c.floor.group.position;
    const machineH = c.specialModel?.metadata.height;
    focusPosition(new THREE.Vector3(c.x + gp.x, (machineH ? machineH * 0.50 : 0.45) + gp.y, c.z + gp.z),
      machineH ? Math.max(6.0, machineH * 2.65) : Math.max(5, Math.max(c.w, c.depth) * 2.8));
    renderConveyorCard(c);
    renderDeviceIndex();
    refreshCraneSignals();
  }

  function escapeSignalHtml(value){
    return String(value ?? '').replace(/[&<>"']/g, character =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function renderConveyorCard(c){
    const signal = getConveyorSignal(c);
    let signalHtml;
    if (!signal.mapped){
      signalHtml = '<div class="signal-note">' + signal.equipmentCode + ' · 此图纸设备未提供 PLC 点位映射（' + c.id + '），不生成模拟反馈。</div>';
    } else if (!signal.device){
      signalHtml = '<div class="signal-note">' + signal.equipmentCode + ' · 源设备 ' + signal.sourceId + ' · 尚未配置 S7 连接，当前为页面演示。</div>';
    } else {
      const qualityClass = signal.quality === 'good' ? 'good' : signal.quality === 'stale' ? 'warn' : 'bad';
      const rawStatus = signal.status === null ? '—' : escapeSignalHtml(signal.status);
      const statusName = signal.isSimulation && signal.status !== null
        ? ({ 0: '停止', 1: '运行', 2: '报警', 3: '离线' }[signal.status] || '未知') + '（' + rawStatus + '）'
        : '原值 ' + rawStatus;
      const goodsName = signal.hasGoods === null ? '—' : signal.isSimulation
        ? signal.hasGoods === 1 ? '有货（1）' : signal.hasGoods === 0 ? '无货（0）' : '未知（' + escapeSignalHtml(signal.hasGoods) + '）'
        : '原值 ' + escapeSignalHtml(signal.hasGoods);
      const barcode = signal.barcode === null ? '—' : signal.barcode === '' ? '（空）' : escapeSignalHtml(signal.barcode);
      signalHtml = '<div class="crane-source"><span class="source-badge' + (signal.isSimulation ? ' sim' : '') + '">S7 ' +
        (signal.isSimulation ? '本地模拟' : '现场 PLC') + ' · ' + signal.equipmentCode + '</span>' +
        '<span class="signal-tile ' + qualityClass + '">' + (QUALITY_TEXT[signal.quality] || signal.quality) + '</span>' +
        '<time>' + formatSignalTime(signal.updatedAt) + '</time></div>' +
        '<div class="signal-note">源设备 ' + signal.sourceId + ' · DB600 · ' + escapeSignalHtml(signal.device.name) + '</div>' +
        '<div class="signal-grid"><div class="signal-tile"><span>运行状态</span><b>' + statusName + '</b></div>' +
        '<div class="signal-tile"><span>占货</span><b>' + goodsName + '</b></div></div>' +
        '<div class="signal-note">容器条码：<span class="mono">' + barcode + '</span></div>' +
        (signal.fresh ? '' : '<div class="signal-note">' + (signal.hasData ? '上次成功值已失效；滚筒停止，货物隐藏。' : '等待有效 S7 读取；滚筒停止，货物隐藏。') + '</div>') +
        (signal.isSimulation ? '<div class="signal-note">模拟约定：0 停止 / 1 运行 / 2 报警 / 3 离线；有货且运行时滚筒转动。</div>' :
          '<div class="signal-note">现场状态枚举待核对，仅展示读取原值；尚未驱动输送模型。</div>');
    }
    document.getElementById('selCard').innerHTML = '<b>' + (c.machineName || '输送设备') + ' ' + c.id + '</b><br>' +
      '楼层：' + c.floor.def.label + '<br>位置：' + CONVEYOR_KINDS[c.kind] + '<br>' +
      (c.station ? '方向：' + (c.station.dir === 'IN' ? '入库 →' : '← 出库') + '<br>相邻支线段：<span class="mono">' + (c.id === c.station.no ? c.station.pair : c.station.no) + '</span>' : '编号与平面图对应') +
      (c.specialModel ? '<br>结构：四柱机架 · 升降承托叉 · 托盘导向 · 安全围护' +
        '<div class="signal-note">盘垛为结构示意；实时占货见 PLC 反馈。</div>' : '<br>结构：圆筒滚筒 · 链传动 · 调平支腿') +
      (c.kind === 'junction' ? '<br>转接机构：正交顶升链条（静态展示）' : '') +
      signalHtml;
  }

  function selectRequestedConveyor(){
    if (typeof URLSearchParams !== 'function') return false;
    const params = new URLSearchParams(location.search || '');
    const code = String(params.get('equipment') || '').toUpperCase();
    const F = floors.find(floor => conveyorGroupCode(floor) === code);
    if (!F) return false;
    const requestedId = params.get('conveyor');
    const conveyor = requestedId ? F.conveyors.find(c => String(c.id) === requestedId) : F.conveyors[0];
    if (!conveyor) return false;
    state.mode = F.def.id;
    [...el('floorTabs').children].forEach(button => button.classList.toggle('on', Number(button.dataset.mode) === state.mode));
    applyMode();
    selectConveyor(conveyor);
    return true;
  }

  function clearSelection(keepCamera){
    document.body.classList.remove('equipment-selected');
    if (state.selected){
      state.selected.bodyMat.emissive = new THREE.Color(0x000000);
      state.selected.bodyMat.emissiveIntensity = 0;
    }
    state.selected = null;
    state.selectedCell = null;
    if (state.selectedConveyor){
      state.selectedConveyor.model.setSelected(false);
      state.selectedConveyor.specialModel?.setSelected(false);
      state.selectedConveyor.partModels.forEach(model => model.setSelected(false));
    }
    state.selectedConveyor = null;
    highlight.visible = false;
    if (!keepCamera) document.getElementById('selCard').textContent = '点击输送设备、堆垛机或货架库位查看详情，也可输入设备编号定位。';
  }
  const statusText = s => ({
    auto: { text: '自动运行', color: '#15803d' },
    task: { text: '任务中', color: '#b45309' },
    alarm: { text: '报警', color: '#b91c1c' },
    offline: { text: '离线', color: '#64748b' },
    manual: { text: '手动 / 维护', color: '#b45309' }
  })[s] || { text: s, color: '#64748b' };

  /* ========================= 仿真逻辑 ========================= */
  let taskSeq = 0;
  const stats = { tasks: 0, alarms: 0 };
  const taskRows = [], alarmRows = [];

  function visibleFloors(){
    if (state.mode === 1) return [floors[0]];
    if (state.mode === 2) return [floors[1]];
    return floors;
  }

  function startTask(F, crane){
    // 同一物理设备只能执行一个楼层的任务，禁止覆盖正在运行的任务。
    if (hasLocalPlcSource(crane)) return false;
    if (crane.task || crane.state !== 'auto') return false;
    const pool = F.cells.filter(c => c.aisle === crane.aisle);
    const cell = pool[Math.floor(Math.random() * pool.length)];
    let type = cell.occupied ? 'OUT' : 'IN';
    if (Math.random() < 0.22) type = 'MOVE';
    const stations = ROW_STATIONS[F.def.id][crane.aisle];
    const station = { x: 0.75, y: 1.05 };
    const id = 'MK' + (++taskSeq).toString().padStart(6, '0');
    const tray = 'TL-' + (10000 + Math.floor(Math.random() * 89999));
    const steps = [];
    let what = '';

    if (type === 'MOVE'){
      let cellB = pool[Math.floor(Math.random() * pool.length)];
      let guard = 0;
      while ((cellB.occupied || cellB === cell) && guard++ < 12){
        cellB = pool[Math.floor(Math.random() * pool.length)];
      }
      if (guard >= 12 || !cell.occupied){
        type = cell.occupied ? 'OUT' : 'IN';
      } else {
        steps.push({ x: cell.x, y: cell.y, dwell: 0.4, onArrive: () => {
          setCell(F, cell, false);
          crane.carried.visible = true;
        }});
        steps.push({ x: cellB.x, y: cellB.y, dwell: 0.45, onArrive: () => {
          crane.carried.visible = false;
          setCell(F, cellB, true);
        }});
        steps.push({ x: station.x, y: station.y, dwell: 0.1 });
        what = cell.code + ' → ' + cellB.code + ' · ' + tray;
      }
    }
    if (type === 'IN'){
      steps.push({ x: station.x, y: station.y, dwell: 0.35, onArrive: () => { crane.carried.visible = true; } });
      steps.push({ x: cell.x, y: cell.y, dwell: 0.45, onArrive: () => {
        crane.carried.visible = false;
        setCell(F, cell, true);
      }});
      steps.push({ x: station.x, y: station.y, dwell: 0.1 });
      what = stations.find(st => st.dir === 'IN').no + ' → ' + cell.code + ' · ' + tray;
    } else if (type === 'OUT'){
      steps.push({ x: cell.x, y: cell.y, dwell: 0.4, onArrive: () => {
        setCell(F, cell, false);
        crane.carried.visible = true;
      }});
      steps.push({ x: station.x, y: station.y, dwell: 0.35, onArrive: () => {
        crane.carried.visible = false;
      }});
      what = cell.code + ' → ' + stations.find(st => st.dir === 'OUT').no + ' · ' + tray;
    }

    steps.forEach(step => { step.y += F.group.position.y; });
    crane.floor = F;
    crane.dwell = 0;
    crane.task = { id, type, floor: F, cell, steps, started: performance.now() };
    crane.state = 'task';
    stats.tasks++;
    DASH.live[type === 'MOVE' ? 'move' : type === 'IN' ? 'in' : 'out']++;
    pushTaskRow({
      t: nowStr(), type, id, who: F.def.label + ' ' + crane.code,
      what: what
    });
    return true;
  }

  function setCell(F, cell, occupied){
    if (cell.occupied === occupied) return;
    cell.occupied = occupied;
    F.paintCell(cell);
    if (state.selectedCell === cell){
      const t = cell.occupied ? '有货' : '空库位';
      document.getElementById('selCard').innerHTML =
        '<b>库位 ' + cell.code + '</b><br>状态：' + t +
        '<br>货品：<span class="mono">' + (occupied ? cell.sku : '—') + '</span>　批次：<span class="mono">' + (occupied ? cell.batch : '—') + '</span><br>' +
        '楼层：' + F.def.label + '　巷道：A0' + (cell.aisle + 1) + '　货架层：' + cell.rackLevel + '（' + F.def.label + ' 第 ' + (cell.level + 1) + ' 层）　列：' + pad2(cell.bay + 1);
    }
  }

  function finishTask(crane){
    if (crane.task){
      DASH.live.done++;
      if (crane.task.started){
        const dur = (performance.now() - crane.task.started) / 1000;
        if (dur > 0.2){ DASH.live.durSum += dur; DASH.live.durN++; }
      }
    }
    crane.task = null;
    crane.state = 'auto';
    crane.carried.visible = false;
    crane.dwell = 0;
  }

  function stepCrane(crane, dt){
    const t = crane.task;
    if (!t) return;
    if (!t.steps.length){ finishTask(crane); return; }
    const s = t.steps[0];
    const dx = s.x - crane.x, dy = s.y - crane.y;
    const vx = 9.5 * dt, vy = 2.8 * dt;
    let moving = false;
    if (Math.abs(dx) > 0.015){
      crane.x += Math.sign(dx) * Math.min(vx, Math.abs(dx)); moving = true;
    }
    if (Math.abs(dy) > 0.015){
      crane.y += Math.sign(dy) * Math.min(vy, Math.abs(dy)); moving = true;
    }
    if (moving) return;
    if (crane.dwell > 0){ crane.dwell -= dt; return; }
    if (s.onArrive) s.onArrive();
    crane.dwell = s.dwell || 0.1;
    t.steps.shift();
    if (!t.steps.length) finishTask(crane);
  }

  function triggerAlarm(crane, reason){
    if (!crane) return;
    if (hasLocalPlcSource(crane)) return;
    if (crane.state === 'alarm') return;
    if (crane.task){ crane.task = null; crane.carried.visible = false; }
    crane.state = 'alarm';
    crane.alarmUntil = performance.now() + 6500;
    stats.alarms++;
    const what = reason || '行走定位超差';
    const meta = ALARM_META[what] || { level: 'warning', source: 'crane' };
    crane.alarmEntry = logAlarm({
      level: meta.level, source: 'crane',
      who: crane.code + ' · A0' + (crane.aisle + 1), what: what,
      target: { kind: 'crane', crane: crane }
    });
    // 报警记录更新，不打断用户正在核对图纸的视角。
  }

  /* ========================= UI 渲染 ========================= */
  // 逐帧读取 DOM（旧实现每帧约 190 次 getElementById）会拖慢主线程：
  // 这里做一次缓存，并用 uiFlags 镜像复选框状态，仅在 change 时同步。
  const elCache = new Map();
  const el = id => {
    let node = elCache.get(id);
    if (!node || node.isConnected === false){
      node = document.getElementById(id);
      if (node) elCache.set(id, node);
    }
    return node;
  };
  const uiFlags = { inventory: true, labels: false };
  const labelToggle = document.getElementById('showDeviceLabels');
  if (labelToggle){
    labelToggle.addEventListener('change', () => { uiFlags.labels = labelToggle.checked; });
  }
  // 画质档位同时约束渲染像素比：高分屏上 1.5×→1.25× 可省掉约 30% 像素填充。
  const DPR_CAP = { performance: 1, balanced: 1.25, high: 1.5 };
  function applyPixelRatio(quality){
    const cap = DPR_CAP[quality] || 1.25;
    const ratio = Math.min(window.devicePixelRatio || 1, cap);
    if (Math.abs(renderer.getPixelRatio() - ratio) < 0.01) return;
    renderer.setPixelRatio(ratio);
    renderer.setSize(stage.clientWidth, stage.clientHeight);
    postFX.resize(stage.clientWidth, stage.clientHeight);
  }
  function setRenderQuality(quality){
    if (!['performance', 'balanced', 'high'].includes(quality)) return;
    renderSettings.quality = quality;
    postFX.setQuality(quality);
    if (lightingRig && lightingRig.setQuality) lightingRig.setQuality(quality);
    applyPixelRatio(quality);
    renderer.shadowMap.needsUpdate = true;
    el('qualitySelector').value = quality;
  }
  function setEnvironmentVisible(visible){
    renderSettings.environment = visible;
    warehouseEnvironment.setVisible(visible);
    el('showEnvironment').checked = visible;
  }
  function setImmersive(visible){
    renderSettings.immersive = visible;
    document.body.classList.toggle('immersive', visible);
    el('btnImmersive').setAttribute('aria-pressed', String(visible));
    el('btnImmersive').textContent = visible ? '显示面板' : '沉浸视图';
  }
  el('qualitySelector').addEventListener('change', event => { qualityAutoLocked = true; setRenderQuality(event.target.value); });
  // 便于截图与现场调试：?q=performance|balanced|high 直接指定画质
  const qualityParam = typeof URLSearchParams === 'function'
    ? new URLSearchParams((location && location.search) || '').get('q') : null;
  if (qualityParam && ['performance', 'balanced', 'high'].includes(qualityParam)){
    qualityAutoLocked = true;
    setRenderQuality(qualityParam);
  }
  el('showEnvironment').addEventListener('change', event => setEnvironmentVisible(event.target.checked));
  el('btnImmersive').addEventListener('click', () => setImmersive(!renderSettings.immersive));
  function setInventoryVisible(visible){
    uiFlags.inventory = visible;
    floors.forEach(F => {
      F.inventory.group.visible = visible;
      F.palletMachines.forEach(c => c.specialModel.setInventoryVisible(visible));
      if (findConveyorSignalDevice(F)) applyConveyorPlcMotion(F);
      else F.pallets.forEach(p => { p.m.visible = visible; });
    });
  }
  el('showInventory').addEventListener('change', event => setInventoryVisible(event.target.checked));  el('inspectCrane').addEventListener('click', () => {
    const crane = state.selected || sharedCranes[0];
    selectCrane(crane);
    const base = state.mode === 2 ? FLOOR_RISE : 0;
    const height = state.mode === 3 ? CRANE_H : RACK_H;
    cam.dTarget.set(crane.x + 0.62, base + height * 0.50, crane.group.position.z);
    cam.dTheta = -1.40; cam.dPhi = 1.42; cam.dRadius = state.mode === 3 ? 46 : 29;
  });
  el('inspectRack').addEventListener('click', () => {
    clearSelection(true);
    uiFlags.inventory = false;
    uiFlags.inventory = false;
    setInventoryVisible(false);
    const base = state.mode === 2 ? FLOOR_RISE : 0;
    cam.dTarget.set(CFG.bayW * 2.3, base + 4.0, rowZ(0));
    cam.dTheta = -0.60; cam.dPhi = 1.36; cam.dRadius = 22;
  });
  el('inspectConveyor').addEventListener('click', () => {
    const F = state.mode === 2 ? floors[1] : floors[0];
    const conveyor = state.selectedConveyor || F.conveyors.find(c => c.kind === 'junction') || F.conveyors[0];
    selectConveyor(conveyor);
    const machineH = conveyor.specialModel?.metadata.height;
    cam.dTarget.set(conveyor.x, conveyor.floor.group.position.y + (machineH ? machineH * 0.50 : CFG.conveyorSurfaceH * 0.65), conveyor.z);
    cam.dTheta = -0.95; cam.dPhi = 1.13;
    cam.dRadius = machineH ? Math.max(5.6, machineH * 2.35) : Math.max(4.2, Math.max(conveyor.w, conveyor.depth) * 2.8);
  });

  function pushTaskRow(data){
    taskRows.unshift(data);
    if (taskRows.length > 7) taskRows.pop();
    const box = el('taskList');
    box.innerHTML = taskRows.map(r =>
      '<div class="row tk"><div class="tk-top">' +
      '<span class="t">' + r.t + '</span>' +
      '<span class="pill ' + (r.type === 'IN' ? 'in' : r.type === 'OUT' ? 'out' : 'mv') + '">' +
      (r.type === 'IN' ? '入库' : r.type === 'OUT' ? '出库' : '移库') + '</span>' +
      '<span class="who">' + r.who + '</span>' +
      '<span class="what">' + r.id + '</span></div>' +
      '<div class="tk-path">' + r.what + '</div></div>'
    ).join('');
  }

  function pushAlarmRow(data){
    alarmRows.unshift({
      t: data.t, who: data.who, what: data.what,
      level: data.level || 'warning'
    });
    if (alarmRows.length > 5) alarmRows.pop();
    const box = el('alarmList');
    box.innerHTML = alarmRows.map(r =>
      '<div class="row alarm"><span class="t">' + r.t + '</span>' +
      '<span class="who">' + r.who + '</span>' +
      '<span class="what"><i class="lv-dot ' + r.level + '"></i>' + r.what + '</span></div>'
    ).join('');
  }

  // 列表渲染做“签名比对 + 事件委托”：旧实现每 420ms 全量重建 innerHTML 并重新绑定监听，
  // 在低频刷新的数据上纯属浪费，也是页面持续卡顿的来源之一。
  let aisleSignature = '';
  let lineMapSignature = '';
  let deviceIndexSignature = '';
  let aisleClickBound = false;

  function renderAisleList(){
    const box = el('aisleList');
    const fs = visibleFloors();
    const rows = sharedCranes.map(c => {
      const cells = fs.flatMap(F => F.cells.filter(x => x.aisle === c.aisle));
      return {
        c,
        pct: cells.length ? Math.round(cells.filter(x => x.occupied).length / cells.length * 100) : 0,
        sel: state.selected === c
      };
    });
    const signature = state.mode + '|' + rows.map(r =>
      r.c.code + ':' + r.pct + ':' + r.c.state + ':' + (r.sel ? 1 : 0)).join(',');
    if (signature === aisleSignature) return;
    aisleSignature = signature;
    box.innerHTML = '<div class="floor-summary">TC01–TC05 · 5 台设备供两层共用</div>' + rows.map(r => {
      const c = r.c;
      const sc = '#' + STATUS_COLOR[c.state].toString(16).padStart(6, '0');
      const taskFloor = c.task ? c.task.floor.def.label + '任务' : '待命';
      return '<div class="aisle-row' + (r.sel ? ' sel' : '') + '" data-aisle="' + c.aisle + '" title="两层共用 · ' + taskFloor + '">' +
        '<span class="dot" style="background:' + sc + '"></span>' +
        '<span class="a-name">A0' + (c.aisle + 1) + '</span>' +
        '<span class="a-dev">' + c.code + '</span>' +
        '<div class="bar"><i style="width:' + r.pct + '%"></i></div>' +
        '<span class="pct">' + r.pct + '%</span></div>';
    }).join('');
    if (!aisleClickBound){
      aisleClickBound = true;
      box.addEventListener('click', event => {
        const row = event.target.closest ? event.target.closest('.aisle-row') : null;
        if (!row) return;
        const c = sharedCranes[Number(row.dataset.aisle)];
        if (!c) return;
        selectCrane(c);
        applyView('aisle');
      });
    }
  }

  function renderLineMap(){
    el('lineFloorTag').textContent = state.mode === 3 ? '1F + 2F' : state.mode + 'F';
    const signature = String(state.mode);
    if (signature === lineMapSignature) return;
    lineMapSignature = signature;
    el('lineMap').innerHTML = visibleFloors().map(F => (state.mode === 3 ? '<div class="floor-summary">' + F.def.label + '</div>' : '') + ROW_STATIONS[F.def.id].map((pair, i) => {
      const inSt = pair.find(x => x.dir === 'IN');
      const outSt = pair.find(x => x.dir === 'OUT');
      return '<div class="lm"><b>A0' + (i + 1) + '</b>' +
        '<span class="in">入 ' + inSt.pair + ' → ' + inSt.no + '</span>' +
        '<span class="out">出 ' + outSt.pair + ' ← ' + outSt.no + '</span></div>';
    }).join('')).join('');
  }

  function renderDeviceIndex(){
    const all = visibleFloors().flatMap(F => F.conveyors);
    const query = el('deviceSearch').value.trim();
    const matched = all.filter(c => c.id.includes(query)).sort((a,b) => Number(a.id) - Number(b.id));
    const signature = state.mode + '|' + query + '|' + (state.selectedConveyor ? state.selectedConveyor.id : '');
    if (signature === deviceIndexSignature) return;
    deviceIndexSignature = signature;
    el('deviceCount').textContent = (query ? matched.length + ' / ' : '') + all.length + ' 台';
    el('deviceIndex').innerHTML = matched.length ? matched.map(c => '<button data-device="' + c.id + '" class="' + (state.selectedConveyor === c ? 'on' : '') + '" title="' + c.floor.def.label + ' · ' + (c.machineName || CONVEYOR_KINDS[c.kind]) + '">' + c.id + '</button>').join('') : '<div class="empty" style="grid-column:1/-1">当前楼层没有此编号</div>';
  }

  function updateKpis(){
    const fs = visibleFloors();
    let total = 0, occ = 0, tasks = 0, alarms = 0;
    fs.forEach(F => {
      total += F.cells.length;
      occ += F.cells.reduce((n, c) => n + (c.occupied ? 1 : 0), 0);
    });
    tasks = sharedCranes.filter(c => c.task && fs.includes(c.task.floor)).length;
    alarms = sharedCranes.filter(c => c.state === 'alarm').length;
    const pct = total ? (occ / total * 100) : 0;
    el('kpiTotal').textContent = total;
    el('kpiOcc').innerHTML = pct.toFixed(1) + '<small>%</small>';
    el('kpiTask').textContent = tasks;
    el('kpiAlarm').textContent = alarms;
    el('kpiAlarmBox').className = 'kpi' + (alarms > 0 ? ' bad' : '');
    const tag = state.mode === 1 ? '1F' : state.mode === 2 ? '2F' : '1F + 2F';
    el('floorTag').textContent = tag;
  }

  /* ========================= 数据看板 · 任务 / 库位 / 报警 ========================= */
  const DASH = {
    open: false, ready: false, opened: false, logSeeded: false,
    lastRefresh: 0, domain: 'all', seq: 0, alarmTick: 0,
    charts: {}, log: [], transient: [], hist: [],
    base: { cycleN: 126, cycleSum: 126 * 42.6, occDelta: 1.2 },
    live: { in: 0, out: 0, move: 0, done: 0, durN: 0, durSum: 0,
            alarms: { critical: 0, warning: 0, info: 0 }, reasons: {} },
    reasons: [
      { name: '行走定位超差', level: 'critical', n: 14 },
      { name: '货叉超时未到位', level: 'warning', n: 11 },
      { name: '通讯心跳丢失', level: 'critical', n: 7 },
      { name: '库位状态不一致', level: 'warning', n: 6 },
      { name: '输送机堵塞', level: 'warning', n: 4 },
      { name: '托盘条码重复', level: 'info', n: 3 },
      { name: '光电信号异常', level: 'info', n: 2 }
    ]
  };

  const ALARM_META = {
    '行走定位超差': { level: 'critical', source: 'crane' },
    '货叉超时未到位': { level: 'warning', source: 'crane' },
    '通讯心跳丢失': { level: 'critical', source: 'crane' },
    '库位状态不一致': { level: 'warning', source: 'cell' },
    '托盘条码重复': { level: 'info', source: 'cell' },
    '输送机堵塞': { level: 'warning', source: 'conveyor' },
    '光电信号异常': { level: 'info', source: 'conveyor' }
  };
  const DC = {
    cyan: '#22d3ee', blue: '#3b82f6', teal: '#2dd4bf', green: '#34d399',
    amber: '#fbbf24', red: '#f87171', violet: '#a78bfa', sub: '#7f95b6',
    axis: 'rgba(96,130,175,.35)', split: 'rgba(96,130,175,.14)'
  };
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const fmt = n => Math.round(Number(n) || 0).toLocaleString('en-US');
  const dashEl = id => document.getElementById(id);

  // 近 7 天基线：确定性生成，页面刷新后趋势不跳变；今日数值叠加实时累计。
  (function buildDashHistory(){
    const rand = mulberry32(20261107);
    const today = new Date();
    const baseCrit = 21, baseWarn = 21, baseInfo = 5;
    for (let i = 6; i >= 0; i--){
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const total = 980 + Math.round(rand() * 470);
      const inN = Math.round(total * (0.34 + rand() * 0.08));
      const outN = Math.round(total * (0.40 + rand() * 0.08));
      const mvN = Math.max(18, total - inN - outN);
      const sum = inN + outN + mvN;
      const rate = 95.4 + rand() * 3.4;
      const f = i === 0 ? 1 : 0.62 + rand() * 0.55;
      const critical = Math.round(baseCrit * f);
      const warning = Math.round(baseWarn * f);
      const info = Math.round(baseInfo * f);
      DASH.hist.push({
        label: pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()),
        in: inN, out: outN, move: mvN, total: sum,
        done: Math.round(sum * rate / 100), rate,
        critical: critical, warning: warning, info: info,
        alarms: critical + warning + info
      });
    }
  })();

  /* ---------- 报警事件：统一入日志，驱动看板与 3D 高亮 ---------- */
  function logAlarm(data){
    const entry = {
      id: ++DASH.seq, t: data.t || nowStr(), ts: Date.now(),
      level: data.level || 'warning', source: data.source || 'crane',
      who: data.who || '—', what: data.what || '未知报警',
      active: true, target: data.target || null
    };
    DASH.log.unshift(entry);
    if (DASH.log.length > 60) DASH.log.pop();
    DASH.live.alarms[entry.level] = (DASH.live.alarms[entry.level] || 0) + 1;
    DASH.live.reasons[entry.what] = (DASH.live.reasons[entry.what] || 0) + 1;
    pushAlarmRow(entry);
    return entry;
  }

  function triggerCellAlarm(F, cell, reason){
    if (!F || !cell || cell.alarm) return null;
    cell.alarm = true;
    F.paintCell(cell);
    const entry = logAlarm({
      level: 'warning', source: 'cell',
      who: cell.code, what: reason || '库位状态不一致',
      target: { kind: 'cell', floor: F, cell: cell }
    });
    DASH.transient.push({ until: performance.now() + 15000, entry: entry, clear: function(){
      cell.alarm = false;
      F.paintCell(cell);
    }});
    return entry;
  }

  function triggerConveyorAlarm(c, reason){
    if (!c) return null;
    if (findConveyorSignalDevice(c.floor)) return null;
    const what = reason || '输送机堵塞';
    c.alarmUntil = performance.now() + 14000;
    c.model.setAlarm(true);
    c.specialModel?.setAlarm(true);
    c.partModels.forEach(model => model.setAlarm(true));
    const entry = logAlarm({
      level: (ALARM_META[what] || {}).level || 'warning', source: 'conveyor',
      who: c.floor.def.label + ' · ' + c.id, what: what,
      target: { kind: 'conveyor', conveyor: c }
    });
    DASH.transient.push({ until: c.alarmUntil, entry: entry, clear: function(){
      c.alarmUntil = 0;
      c.model.setAlarm(false);
      c.specialModel?.setAlarm(false);
      c.partModels.forEach(model => model.setAlarm(false));
    }});
    return entry;
  }

  function clearTransientAlarms(now){
    for (let i = DASH.transient.length - 1; i >= 0; i--){
      const t = DASH.transient[i];
      if (now < t.until) continue;
      t.clear();
      if (t.entry) t.entry.active = false;
      DASH.transient.splice(i, 1);
    }
  }

  function fireCellAlarm(){
    const F = floors[Math.floor(Math.random() * floors.length)];
    const pool = F.cells.filter(c => c.occupied && !c.alarm);
    if (!pool.length) return;
    triggerCellAlarm(F, pool[Math.floor(Math.random() * pool.length)],
      Math.random() < 0.7 ? '库位状态不一致' : '托盘条码重复');
  }

  function maybeSpawnAlarm(){
    if (Math.random() > 0.55) return;
    if (Math.random() < 0.55){
      fireCellAlarm();
    } else {
      const F = floors[Math.floor(Math.random() * floors.length)];
      triggerConveyorAlarm(F.conveyors[Math.floor(Math.random() * F.conveyors.length)],
        Math.random() < 0.6 ? '输送机堵塞' : '光电信号异常');
    }
  }

  function seedDashLog(){
    if (DASH.logSeeded) return;
    DASH.logSeeded = true;
    const conveyorBy = function(floorId, id){
      const F = floors.filter(f => f.def.id === floorId)[0];
      return F ? F.conveyors.filter(c => String(c.id) === id)[0] : null;
    };
    const cellBy = function(code){
      for (let i = 0; i < floors.length; i++){
        const c = floors[i].cells.filter(x => x.code === code)[0];
        if (c) return { F: floors[i], cell: c };
      }
      return null;
    };
    const cellHit = cellBy('1F-A04-L3-11');
    const rows = [
      { min: 9, level: 'critical', who: 'TC02 · A02', what: '行走定位超差',
        target: { kind: 'crane', crane: sharedCranes[1] } },
      { min: 23, level: 'warning', who: '2F · 2043', what: '输送机堵塞',
        target: { kind: 'conveyor', conveyor: conveyorBy(2, '2043') } },
      { min: 41, level: 'warning', who: '1F-A04-L3-11', what: '库位状态不一致',
        target: cellHit ? { kind: 'cell', floor: cellHit.F, cell: cellHit.cell } : null },
      { min: 63, level: 'critical', who: 'TC05 · A05', what: '通讯心跳丢失',
        target: { kind: 'crane', crane: sharedCranes[4] } },
      { min: 88, level: 'info', who: '1F · 1018', what: '光电信号异常',
        target: { kind: 'conveyor', conveyor: conveyorBy(1, '1018') } }
    ];
    rows.forEach(function(row){
      DASH.log.push({
        id: ++DASH.seq, t: dashClockAgo(row.min), ts: Date.now() - row.min * 60000,
        level: row.level, source: row.source || 'crane', who: row.who, what: row.what,
        active: false, target: row.target || null
      });
    });
    DASH.log.sort(function(a, b){ return b.ts - a.ts; });
    // 首次打开时若没有在办报警，触发一条真实的库位异常，3D 与看板同步显示。
    if (!DASH.log.some(e => e.active)) fireCellAlarm();
  }

  function dashClockAgo(min){
    const d = new Date(Date.now() - min * 60000);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /* ---------- 数据快照 ---------- */
  function dashSnapshot(){
    const now = performance.now();
    let cellTotal = 0, cellOcc = 0;
    const byKey = Object.create(null);
    floors.forEach(function(F){
      F.cells.forEach(function(c){
        const k = c.aisle * 20 + c.rackLevel;
        const v = byKey[k] || (byKey[k] = [0, 0]);
        v[1]++;
        if (c.occupied) v[0]++;
        cellTotal++;
        if (c.occupied) cellOcc++;
      });
    });
    const levels = CFG.levels * 2;
    const heat = [], aisle = [];
    for (let lv = 1; lv <= levels; lv++){
      for (let a = 0; a < CFG.aisles; a++){
        const v = byKey[a * 20 + lv] || [0, 0];
        heat.push({ aisle: a, level: lv, occ: v[0], n: v[1], pct: v[1] ? v[0] / v[1] * 100 : 0 });
      }
    }
    for (let a = 0; a < CFG.aisles; a++){
      let occ = 0, n = 0;
      for (let lv = 1; lv <= levels; lv++){
        const v = byKey[a * 20 + lv] || [0, 0];
        occ += v[0]; n += v[1];
      }
      aisle.push({ name: 'A0' + (a + 1), pct: n ? occ / n * 100 : 0, occ: occ, n: n });
    }

    let run = 0, work = 0, alarm = 0;
    sharedCranes.forEach(function(c){
      if (c.state === 'alarm') alarm++;
      else if (c.task) work++;
      else run++;
    });
    floors.forEach(function(F){
      F.conveyors.forEach(function(c){
        if (c.alarmUntil && c.alarmUntil > now) alarm++;
        else run++;
      });
    });

    const h = DASH.hist;
    const today = h[h.length - 1];
    const live = DASH.live;
    const taskIn = h.map(x => x.in), taskOut = h.map(x => x.out), taskMove = h.map(x => x.move);
    taskIn[h.length - 1] += live.in;
    taskOut[h.length - 1] += live.out;
    taskMove[h.length - 1] += live.move;
    const taskTotal = today.in + today.out + today.move + live.in + live.out + live.move;
    const taskDone = today.done + live.done;
    const taskRate = taskTotal ? Math.min(100, taskDone / taskTotal * 100) : 0;
    const taskActive = sharedCranes.filter(c => !!c.task).length;
    const cycle = (DASH.base.cycleSum + live.durSum) / Math.max(1, DASH.base.cycleN + live.durN);
    const rateArr = h.map((x, i) => i === h.length - 1 ? taskRate : x.rate);

    const liveAlarms = (live.alarms.critical || 0) + (live.alarms.warning || 0) + (live.alarms.info || 0);
    const todayAlarms = today.alarms + liveAlarms;
    const pending = DASH.log.filter(e => e.active).length;
    const handled = Math.max(0, todayAlarms - pending);
    const prevAlarms = h.length > 1 ? h[h.length - 2].alarms : todayAlarms;
    const alarmDelta = prevAlarms ? (todayAlarms - prevAlarms) / prevAlarms * 100 : 0;
    const crit = h.map(x => x.critical), warn = h.map(x => x.warning), info = h.map(x => x.info);
    crit[h.length - 1] += live.alarms.critical || 0;
    warn[h.length - 1] += live.alarms.warning || 0;
    info[h.length - 1] += live.alarms.info || 0;

    const reasons = DASH.reasons.map(function(r){
      return { name: r.name, level: r.level, n: r.n + (live.reasons[r.name] || 0) };
    }).sort(function(a, b){ return b.n - a.n; });

    return {
      days: h.map(x => x.label),
      taskIn: taskIn, taskOut: taskOut, taskMove: taskMove, taskRate: rateArr,
      task: { total: taskTotal, done: taskDone, rate: taskRate, active: taskActive, cycle: cycle },
      cell: {
        total: cellTotal, occ: cellOcc, free: cellTotal - cellOcc,
        pct: cellTotal ? cellOcc / cellTotal * 100 : 0,
        target: 65, delta: DASH.base.occDelta
      },
      aisle: aisle, heat: heat,
      dev: { run: run, work: work, alarm: alarm, total: run + work + alarm },
      alarm: {
        today: todayAlarms, pending: pending, handled: handled,
        rate: todayAlarms ? handled / todayAlarms * 100 : 100,
        prev: prevAlarms, delta: alarmDelta
      },
      alarmTrend: { critical: crit, warning: warn, info: info },
      reasons: reasons
    };
  }

  /* ---------- 文本区渲染 ---------- */
  function dashClockText(){
    const d = new Date();
    dashEl('dashTime').textContent = nowStr();
    dashEl('dashDate').textContent = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' +
      pad2(d.getDate()) + ' ' + WEEK[d.getDay()];
  }

  function ringStyle(p, c){
    return '--p:' + clamp(Number.isFinite(p) ? p : 0, 0, 100).toFixed(1) + ';--c:' + c;
  }

  function renderDashKpis(s){
    const cards = [
      { k: '今日任务', v: fmt(s.task.total), unit: '', goal: '目标 ' + fmt(1600), p: s.task.total / 16, c: DC.cyan },
      { k: '任务完成率', v: s.task.rate.toFixed(1), unit: '%', goal: '目标 98.0%', p: s.task.rate, c: DC.blue },
      { k: '库位占用率', v: s.cell.pct.toFixed(1), unit: '%', goal: '目标 ' + s.cell.target.toFixed(1) + '%', p: s.cell.pct, c: DC.teal },
      { k: '在办任务', v: String(s.task.active), unit: '条', goal: '满载 5 台堆垛机', p: s.task.active / 5 * 100, c: DC.violet }
    ];
    dashEl('dashTaskKpis').innerHTML = cards.map(function(c){
      const p = clamp(Number.isFinite(c.p) ? c.p : 0, 0, 100);
      return '<div class="dash-kpi"><div class="dk-main">' +
        '<div class="dk-k">' + c.k + '</div>' +
        '<div class="dk-v">' + c.v + (c.unit ? '<small>' + c.unit + '</small>' : '') + '</div>' +
        '<div class="dk-goal">' + c.goal + '</div></div>' +
        '<div class="dk-ring" style="' + ringStyle(p, c.c) + '"><span>' + p.toFixed(1) + '%</span></div></div>';
    }).join('');
    dashEl('dashTaskTag').textContent = '今日 · ' + fmt(s.task.total) + ' 条';
  }

  function cellCard(k, v, unit, sub){
    return '<div class="d-cell"><div class="k">' + k + '</div>' +
      '<div class="v">' + v + '<small>' + unit + '</small></div>' +
      '<div class="d">' + sub + '</div></div>';
  }

  function renderDashCellStats(s){
    dashEl('dashCellStats').innerHTML =
      cellCard('库位总数', fmt(s.cell.total), '个', '1F + 2F') +
      cellCard('已占用', fmt(s.cell.occ), '个', '<span class="up">↑ ' + s.cell.delta.toFixed(1) + '%</span> 昨日') +
      cellCard('空库位', fmt(s.cell.free), '个', '<span class="down">↓ ' + s.cell.delta.toFixed(1) + '%</span> 昨日');
  }

  function renderDashAlarmStats(s){
    const d = s.alarm.delta;
    const cls = d > 0 ? 'up' : 'down';
    dashEl('dashAlarmStats').innerHTML =
      '<div class="d-ringk"><span>今日报警</span><b>' + fmt(s.alarm.today) + '<small>次</small></b>' +
      '<i class="' + cls + '">较昨日 ' + (d > 0 ? '↑' : '↓') + ' ' + Math.abs(d).toFixed(1) + '%</i></div>' +
      '<div class="d-ringk"><span>处理中</span><b>' + fmt(s.alarm.pending) + '<small>条</small></b>' +
      '<i>已闭环 ' + fmt(s.alarm.handled) + ' 条</i></div>';
  }

  function renderDashAlarmTable(){
    const rows = DASH.log.slice(0, 8);
    dashEl('dashAlarmBody').innerHTML = rows.length ? rows.map(function(e){
      return '<tr data-alarm="' + e.id + '" title="点击在三维场景中定位">' +
        '<td class="al-t">' + e.t + '</td>' +
        '<td class="al-who">' + e.who + '</td>' +
        '<td class="al-what"><i class="lv-dot ' + e.level + '"></i>' + e.what + '</td>' +
        '<td><span class="pill-st ' + (e.active ? 'bad' : 'ok') + '">' +
        (e.active ? '处理中' : '已处理') + '</span></td></tr>';
    }).join('') : '<tr><td colspan="4" style="color:#5f7c9e;padding:10px 4px">暂无报警</td></tr>';
  }

  function renderDashReasons(s){
    const max = s.reasons.length && s.reasons[0].n ? s.reasons[0].n : 1;
    dashEl('dashReasons').innerHTML = s.reasons.slice(0, 5).map(function(r){
      return '<div class="d-reason">' +
        '<span class="r-name"><i class="lv-dot ' + r.level + '"></i>' + r.name + '</span>' +
        '<span class="r-n">' + r.n + ' 次</span>' +
        '<span class="r-bar"><i style="width:' + Math.max(8, r.n / max * 100).toFixed(0) + '%"></i></span></div>';
    }).join('');
  }

  /* ---------- ECharts 通用样式 ---------- */
  const dTipBase = {
    backgroundColor: 'rgba(5,17,33,.94)', borderColor: 'rgba(56,189,248,.4)', borderWidth: 1,
    padding: [6, 9], textStyle: { color: '#cfe3ff', fontSize: 10.5 },
    extraCssText: 'box-shadow:0 8px 22px rgba(0,0,0,.55);border-radius:5px;'
  };
  function dTip(trigger){
    return Object.assign({}, dTipBase, {
      trigger: trigger,
      axisPointer: { type: 'line', lineStyle: { color: 'rgba(56,189,248,.35)', width: 1 } }
    });
  }
  function dAxisX(data){
    return {
      type: 'category', data: data, boundaryGap: true, axisTick: { show: false },
      axisLine: { lineStyle: { color: DC.axis } },
      axisLabel: { color: DC.sub, fontSize: 9, margin: 6 }
    };
  }
  function dAxisY(name){
    return {
      type: 'value', name: name || '',
      nameTextStyle: { color: DC.sub, fontSize: 8.5, padding: [0, 12, 0, 0] },
      splitNumber: 3, axisLine: { show: false }, axisTick: { show: false },
      splitLine: { lineStyle: { color: DC.split, type: 'dashed' } },
      axisLabel: { color: DC.sub, fontSize: 8.5 }
    };
  }
  function dLegend(data){
    return {
      top: 0, right: 0, itemWidth: 6, itemHeight: 6, itemGap: 9, icon: 'circle',
      textStyle: { color: '#9fb4d4', fontSize: 9 }, data: data
    };
  }

  /* ---------- 图表 ---------- */
  // 数据每 1.8s 刷新一次：入场动画保留，更新时立即生效，避免标签反复淡入造成闪烁。
  function dApply(c, opt){
    opt.animation = true;
    opt.animationDuration = 600;
    opt.animationEasing = 'cubicOut';
    opt.animationDurationUpdate = 0;
    c.setOption(opt);
    return c;
  }

  function drawTaskTrend(s){
    const c = DASH.charts.chartTaskTrend;
    if (!c) return;
    const grad = function(a, b){
      return new echarts.graphic.LinearGradient(0, 0, 0, 1,
        [{ offset: 0, color: a }, { offset: 1, color: b }]);
    };
    dApply(c, {
      grid: { left: 2, right: 4, top: 26, bottom: 0, containLabel: true },
      legend: dLegend(['入库', '出库', '移库', '完成率']),
      tooltip: dTip('axis'),
      xAxis: dAxisX(s.days),
      yAxis: [
        dAxisY('任务'),
        { type: 'value', min: 85, max: 100, splitNumber: 3, splitLine: { show: false },
          axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { color: DC.sub, fontSize: 8.5, formatter: '{value}%' } }
      ],
      series: [
        { name: '入库', type: 'bar', stack: 't', barWidth: '44%', data: s.taskIn,
          itemStyle: { color: grad('#22d3ee', '#0b4f70') } },
        { name: '出库', type: 'bar', stack: 't', data: s.taskOut,
          itemStyle: { color: grad('#3b82f6', '#123a6b') } },
        { name: '移库', type: 'bar', stack: 't', data: s.taskMove,
          itemStyle: { color: grad('#a78bfa', '#3b2a6b'), borderRadius: [2, 2, 0, 0] } },
        { name: '完成率', type: 'line', yAxisIndex: 1, data: s.taskRate, smooth: true,
          symbol: 'circle', symbolSize: 4, z: 6,
          lineStyle: { width: 1.6, color: '#fbbf24', shadowColor: 'rgba(251,191,36,.5)', shadowBlur: 8 },
          itemStyle: { color: '#fbbf24', borderColor: '#0a1a2f', borderWidth: 1 },
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1,
            [{ offset: 0, color: 'rgba(251,191,36,.2)' }, { offset: 1, color: 'rgba(251,191,36,0)' }]) } }
      ]
    });
  }

  function drawTaskType(s){
    const c = DASH.charts.chartTaskType;
    if (!c) return;
    const items = [
      { name: '入库', value: s.taskIn[s.taskIn.length - 1], color: DC.cyan },
      { name: '出库', value: s.taskOut[s.taskOut.length - 1], color: DC.blue },
      { name: '移库', value: s.taskMove[s.taskMove.length - 1], color: DC.violet }
    ];
    const total = items.reduce(function(n, i){ return n + i.value; }, 0) || 1;
    const pct = {};
    items.forEach(function(i){ pct[i.name] = (i.value / total * 100).toFixed(1); });
    dApply(c, {
      tooltip: dTip('item'),
      legend: {
        orient: 'vertical', right: 0, top: 'center', itemWidth: 6, itemHeight: 6,
        itemGap: 13, icon: 'circle', textStyle: { color: '#9fb4d4', fontSize: 9.5 },
        formatter: function(n){ return n + '  ' + pct[n] + '%'; }
      },
      title: {
        text: fmt(total), subtext: '今日任务', left: '33%', top: '39%', textAlign: 'center', itemGap: 2,
        textStyle: { color: '#eaf6ff', fontSize: 16, fontWeight: 700 },
        subtextStyle: { color: '#7590b3', fontSize: 9 }
      },
      series: [{
        type: 'pie', radius: ['55%', '77%'], center: ['33%', '52%'], startAngle: 100,
        avoidLabelOverlap: false, label: { show: false }, labelLine: { show: false },
        itemStyle: { borderColor: 'rgba(6,20,38,.9)', borderWidth: 2 },
        emphasis: { scale: true, scaleSize: 3, itemStyle: { shadowBlur: 16, shadowColor: 'rgba(34,211,238,.5)' } },
        data: items.map(function(i){
          return { name: i.name, value: i.value, itemStyle: { color: i.color, shadowBlur: 10, shadowColor: i.color } };
        })
      }]
    });
  }

  function drawCellHeat(s){
    const c = DASH.charts.chartCellHeat;
    if (!c) return;
    const w = c.getWidth();
    const labelFs = Math.round(clamp(w / 62, 10, 14));
    const axisFs = Math.round(clamp(w / 80, 9.5, 12));
    const data = s.heat.map(function(h){
      return [h.aisle, h.level - 1, Number(h.pct.toFixed(1)), h.occ, h.n];
    });
    const labels = [];
    for (let i = 1; i <= CFG.levels * 2; i++) labels.push('L' + i);
    dApply(c, {
      tooltip: Object.assign({}, dTipBase, {
        trigger: 'item',
        formatter: function(p){
          return '巷道 A0' + (p.value[0] + 1) + ' · 货架 ' + (p.value[1] + 1) + ' 层<br>' +
            '占用 <b>' + p.value[3] + '</b> / ' + p.value[4] + ' 库位<br>占用率 ' + p.value[2] + '%';
        }
      }),
      grid: { left: 2, right: 8, top: 6, bottom: 0, containLabel: true },
      xAxis: {
        type: 'category', data: ['A01', 'A02', 'A03', 'A04', 'A05'],
        axisTick: { show: false }, axisLine: { lineStyle: { color: DC.axis } },
        axisLabel: { color: '#9fbce0', fontSize: axisFs, margin: 6 }
      },
      yAxis: {
        type: 'category', data: labels,
        axisTick: { show: false }, axisLine: { show: false },
        axisLabel: { color: '#9fbce0', fontSize: axisFs }
      },
      visualMap: { min: 30, max: 85, dimension: 2, show: false,
        inRange: { color: ['#08182b', '#0b3a56', '#0f7c9b', '#28c9e8', '#9df3ff'] } },
      series: [{
        type: 'heatmap', data: data,
        label: {
          show: true, formatter: function(p){ return p.value[2] + '%'; },
          color: '#f2fbff', fontSize: labelFs, fontWeight: 600,
          textBorderColor: 'rgba(2,10,20,.9)', textBorderWidth: 2
        },
        itemStyle: { borderColor: 'rgba(4,12,24,.95)', borderWidth: 4, borderRadius: 3 },
        emphasis: { itemStyle: { borderColor: '#e0f7ff', borderWidth: 1,
          shadowBlur: 12, shadowColor: 'rgba(34,211,238,.6)' } }
      }]
    });
  }

  function drawDevice(s){
    const c = DASH.charts.chartDeviceState;
    if (!c) return;
    const items = [
      { name: '运行', value: s.dev.run, color: DC.cyan },
      { name: '任务中', value: s.dev.work, color: DC.green },
      { name: '报警', value: s.dev.alarm, color: DC.red }
    ];
    const total = items.reduce(function(n, i){ return n + i.value; }, 0);
    const val = {};
    items.forEach(function(i){ val[i.name] = i.value; });
    dApply(c, {
      tooltip: dTip('item'),
      title: {
        text: fmt(total), subtext: '设备总数', left: '33%', top: '39%', textAlign: 'center', itemGap: 2,
        textStyle: { color: '#eaf6ff', fontSize: 16, fontWeight: 700 },
        subtextStyle: { color: '#7590b3', fontSize: 9 }
      },
      legend: {
        orient: 'vertical', right: 0, top: 'center', itemWidth: 6, itemHeight: 6,
        itemGap: 12, icon: 'circle', textStyle: { color: '#9fb4d4', fontSize: 9 },
        formatter: function(n){ return n + ' ' + val[n]; }
      },
      series: [{
        type: 'pie', radius: ['56%', '78%'], center: ['33%', '52%'],
        label: { show: false }, labelLine: { show: false },
        itemStyle: { borderColor: 'rgba(6,20,38,.9)', borderWidth: 2 },
        emphasis: { scale: true, scaleSize: 3 },
        data: items.map(function(i){
          return { name: i.name, value: i.value, itemStyle: { color: i.color } };
        })
      }]
    });
  }

  function drawAisle(s){
    const c = DASH.charts.chartCellAisle;
    if (!c) return;
    const reversed = s.aisle.slice().reverse();
    dApply(c, {
      grid: { left: 2, right: 32, top: 4, bottom: 0, containLabel: true },
      tooltip: Object.assign({}, dTipBase, {
        trigger: 'item',
        formatter: function(p){
          const a = s.aisle.filter(function(x){ return x.name === p.name; })[0];
          return '巷道 ' + p.name + '<br>占用率 <b>' + p.value.toFixed(1) + '%</b><br>' +
            a.occ + ' / ' + a.n + ' 库位';
        }
      }),
      xAxis: { type: 'value', max: 100, show: false },
      yAxis: {
        type: 'category', data: reversed.map(function(a){ return a.name; }),
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: '#8fa8c9', fontSize: 9.5 }
      },
      series: [{
        type: 'bar', barWidth: 7, showBackground: true,
        backgroundStyle: { color: 'rgba(56,120,180,.14)', borderRadius: 4 },
        itemStyle: {
          borderRadius: 4,
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0,
            [{ offset: 0, color: '#0e7490' }, { offset: 1, color: '#5eead4' }])
        },
        label: { show: true, position: 'right', distance: 4,
          formatter: function(p){ return p.value.toFixed(1) + '%'; },
          color: '#9fe8ff', fontSize: 9 },
        data: reversed.map(function(a){ return Number(a.pct.toFixed(1)); })
      }]
    });
  }

  function drawAlarmRing(s){
    const c = DASH.charts.chartAlarmRing;
    if (!c) return;
    dApply(c, {
      series: [{
        type: 'gauge', startAngle: 90, endAngle: -270, radius: '92%', center: ['50%', '50%'],
        min: 0, max: 100,
        progress: { show: true, width: 8, roundCap: false,
          itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 1, 1,
            [{ offset: 0, color: '#22d3ee' }, { offset: 1, color: '#2dd4bf' }]) } },
        axisLine: { lineStyle: { width: 8, color: [[1, 'rgba(56,120,180,.18)']] } },
        pointer: { show: false }, axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { show: false }, anchor: { show: false },
        title: { offsetCenter: [0, '32%'], color: '#7f95b6', fontSize: 9 },
        detail: { offsetCenter: [0, '-2%'], valueAnimation: true,
          formatter: function(v){ return v.toFixed(1) + '%'; },
          color: '#eaf6ff', fontSize: 18, fontWeight: 700 },
        data: [{ value: s.alarm.rate, name: '报警处理率' }]
      }]
    });
  }

  function drawAlarmTrend(s){
    const c = DASH.charts.chartAlarmTrend;
    if (!c) return;
    dApply(c, {
      grid: { left: 0, right: 2, top: 22, bottom: 0, containLabel: true },
      legend: dLegend(['严重', '警告', '提示']),
      tooltip: dTip('axis'),
      xAxis: dAxisX(s.days),
      yAxis: dAxisY(''),
      series: [
        { name: '严重', type: 'bar', stack: 'a', barWidth: '46%', data: s.alarmTrend.critical,
          itemStyle: { color: DC.red } },
        { name: '警告', type: 'bar', stack: 'a', data: s.alarmTrend.warning,
          itemStyle: { color: DC.amber } },
        { name: '提示', type: 'bar', stack: 'a', data: s.alarmTrend.info,
          itemStyle: { color: '#38bdf8', borderRadius: [2, 2, 0, 0] } }
      ]
    });
  }

  function refreshDash(){
    if (!DASH.open) return;
    const s = dashSnapshot();
    dashClockText();
    dashEl('dashScope').textContent = 'A01–A05 · ' + fmt(s.cell.total) + ' 库位 · ' + fmt(s.dev.total) + ' 设备';
    dashEl('dashDevTag').textContent = '全库 ' + fmt(s.dev.total) + ' 台';
    dashEl('dashCycle').textContent = s.task.cycle.toFixed(1) + ' s';
    renderDashKpis(s);
    renderDashCellStats(s);
    renderDashAlarmStats(s);
    renderDashAlarmTable();
    renderDashReasons(s);
    if (DASH.ready){
      drawTaskTrend(s);
      drawTaskType(s);
      drawCellHeat(s);
      drawDevice(s);
      drawAisle(s);
      drawAlarmRing(s);
      drawAlarmTrend(s);
    }
    dashEl('dashUpd').textContent = nowStr();
  }

  // echarts 约 1MB，主页面首屏用不到；改为打开看板时再加载，省掉首屏解析时间。
  let echartsLoader = null;
  function loadEcharts(){
    if (window.echarts) return Promise.resolve(window.echarts);
    if (echartsLoader) return echartsLoader;
    echartsLoader = new Promise(function(resolve){
      const script = document.createElement('script');
      script.src = '/assets/echarts.min.js';
      script.async = true;
      script.onload = function(){ resolve(window.echarts || null); };
      script.onerror = function(){ resolve(null); };
      document.head.appendChild(script);
    });
    return echartsLoader;
  }

  function mountDashCharts(){
    if (!DASH.open) return;
    if (typeof echarts === 'undefined'){
      refreshDash();
      return;
    }
    ['chartTaskTrend', 'chartTaskType', 'chartCellHeat', 'chartDeviceState',
      'chartCellAisle', 'chartAlarmRing', 'chartAlarmTrend'].forEach(function(id){
      if (!DASH.charts[id]) DASH.charts[id] = echarts.init(dashEl(id), null, { renderer: 'canvas' });
    });
    DASH.ready = true;
    Object.keys(DASH.charts).forEach(function(k){ DASH.charts[k].resize(); });
    if (typeof ResizeObserver === 'function' && !DASH.observer){
      DASH.observer = new ResizeObserver(function(){
        Object.keys(DASH.charts).forEach(function(k){
          const c = DASH.charts[k];
          if (c && c.getWidth()) c.resize();
        });
      });
      Object.keys(DASH.charts).forEach(function(k){
        const dom = dashEl(k);
        if (dom) DASH.observer.observe(dom);
      });
    }
    refreshDash();
  }

  function openDash(){
    if (DASH.open) return;
    DASH.open = true;
    dashEl('btnDash').setAttribute('aria-expanded', 'true');
    DASH.opened = true;
    const box = dashEl('dash');
    box.classList.add('on');
    if (box.setAttribute) box.setAttribute('aria-hidden', 'false');
    dashEl('dashBack').focus?.();
    dashClockText();
    if (!DASH.log.length) seedDashLog();
    setDashDomain('all');
    loadEcharts().then(function(lib){
      if (!lib || !DASH.open) return;
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(mountDashCharts);
      else mountDashCharts();
    });
  }

  function closeDash(){
    if (!DASH.open) return;
    DASH.open = false;
    dashEl('btnDash').setAttribute('aria-expanded', 'false');
    const box = dashEl('dash');
    box.classList.remove('on');
    if (box.setAttribute) box.setAttribute('aria-hidden', 'true');
    if ((location.hash || '').toLowerCase() === '#dashboard'){
      window.history?.replaceState(null, '', (location.pathname || 'index.html') + (location.search || ''));
    }
    dashEl('btnDash').focus?.();
  }

  function setDashDomain(domain){
    DASH.domain = domain;
    const nav = dashEl('dashNav');
    if (nav.children){
      Array.prototype.forEach.call(nav.children, function(b){
        b.classList.toggle('on', b.dataset.domain === domain);
      });
    }
    const panels = document.querySelectorAll ? document.querySelectorAll('.dash-panel') : [];
    Array.prototype.forEach.call(panels, function(p){
      const d = p.getAttribute ? p.getAttribute('data-domain') : '';
      p.classList.toggle('dim', domain !== 'all' && d !== domain);
      p.classList.toggle('focus', domain !== 'all' && d === domain);
    });
  }

  function setFloorMode(mode){
    state.mode = mode;
    Array.prototype.forEach.call(dashEl('floorTabs').children || [], function(b){
      b.classList.toggle('on', Number(b.dataset.mode) === mode);
    });
    applyMode();
  }

  function locateAlarm(entry){
    const t = entry.target;
    if (!t) return;
    if (t.kind === 'crane' && t.crane){
      selectCrane(t.crane);
      return;
    }
    if (t.kind === 'cell' && t.cell){
      if (state.mode !== 3 && state.mode !== t.floor.def.id) setFloorMode(3);
      selectCell(t.floor, t.cell);
      const gp = t.floor.group.position;
      focusPosition(new THREE.Vector3(t.cell.x + gp.x, t.cell.y + gp.y, t.cell.z), 15);
      return;
    }
    if (t.kind === 'conveyor' && t.conveyor){
      if (state.mode !== 3 && state.mode !== t.conveyor.floor.def.id) setFloorMode(3);
      selectConveyor(t.conveyor);
    }
  }

  dashEl('btnDash').addEventListener('click', openDash);
  dashEl('dashBack').addEventListener('click', closeDash);
  dashEl('dashNav').addEventListener('click', function(e){
    const btn = e.target && e.target.closest ? e.target.closest('button[data-domain]') : null;
    if (btn) setDashDomain(btn.dataset.domain);
  });
  dashEl('dashAlarmBody').addEventListener('click', function(e){
    const tr = e.target && e.target.closest ? e.target.closest('tr[data-alarm]') : null;
    if (!tr) return;
    const entry = DASH.log.filter(function(x){ return String(x.id) === tr.dataset.alarm; })[0];
    if (!entry || !entry.target) return;
    closeDash();
    locateAlarm(entry);
  });
  window.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && DASH.open) closeDash();
  });

  /* ========================= 楼层切换 ========================= */
  el('floorTabs').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.mode = Number(btn.dataset.mode);
    [...el('floorTabs').children].forEach(b => b.classList.toggle('on', b === btn));
    applyMode();
  });

  function applyMode(){
    const two = state.mode === 3;
    floors.forEach(F => {
      F.group.visible = two || state.mode === F.def.id;
      F.group.position.set(0, (F.def.id - 1) * FLOOR_RISE, 0);
      const translucent = two && F.def.id === 2;
      F.slab.material.transparent = translucent;
      F.slab.material.opacity = translucent ? 0.12 : 1;
      F.slab.material.depthWrite = !translucent;
      F.slab.material.needsUpdate = true;
      F.grid.visible = F.def.id === 1;
      F.aisleMarkings.forEach(part => { part.visible = !two || F.def.id === 1; });
      // 共用下区的顶部层板和横梁，避免接缝处叠两套结构。
      F.seamParts.forEach(part => { part.visible = !two; });
    });
    updateSharedCraneView();
    clearSelection();
    renderAisleList();
    renderLineMap();
    renderDeviceIndex();
    updateKpis();
    applyView(state.view);
    updateSceneCaption();
  }

  function updateSharedCraneView(){
    // 单层模式显示同一设备在该楼层的剖面；设备身份、任务和世界坐标保持不变。
    const two = state.mode === 3;
    const base = state.mode === 2 ? FLOOR_RISE : 0;
    const height = two ? CRANE_H : RACK_H;
    sharedCranes.forEach(c => {
      c.model.setSection({ base, height, two, mode: state.mode });
      c.carriage.visible = two || (c.y >= base && c.y <= base + RACK_H);
      c.labelSprite.visible = uiFlags.labels;
    });
  }

  function updateSceneCaption(){
    const two = state.mode === 3;
    el('sceneCaption').innerHTML = '<b>' + (two ? '双层空间 · 2F 在上 / 1F 在下' : (state.mode === 1 ? '1F · 一层输送区与立体库' : '2F · 二层输送区与立体库')) + '</b><br>' +
      (two && state.view === 'top' ? '上下货架连续 10 层 · 俯视投影重合' : '上下货架连续 10 层 · TC01–TC05 两层共用');
  }

  el('viewBtns').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.view = btn.dataset.view;
    [...el('viewBtns').children].forEach(b => b.classList.toggle('on', b === btn));
    applyView(state.view);
    updateSceneCaption();
  });

  el('deviceSearch').addEventListener('input', renderDeviceIndex);
  el('deviceIndex').addEventListener('click', e => {
    const btn = e.target.closest('button[data-device]');
    if (!btn) return;
    const c = visibleFloors().flatMap(F => F.conveyors).find(c => c.id === btn.dataset.device);
    if (c) selectConveyor(c);
  });

  el('btnPause').addEventListener('click', e => {
    state.paused = !state.paused;
    e.target.textContent = state.paused ? '继续仿真' : '暂停仿真';
    e.target.classList.toggle('primary', state.paused);
    updateSignalLink();
  });

  el('btnAlarm').addEventListener('click', () => {
    const c = sharedCranes[Math.floor(Math.random() * sharedCranes.length)];
    triggerAlarm(c, ['行走定位超差', '货叉超时未到位', '通讯心跳丢失'][Math.floor(Math.random() * 3)]);
  });

  el('btnSpeed').addEventListener('click', e => {
    const arr = [1, 1.5, 2, 0.5];
    state.speed = arr[(arr.indexOf(state.speed) + 1) % arr.length];
    e.target.textContent = '速度 ' + state.speed + '×';
    el('speedTag').textContent = state.speed.toFixed(1) + '×';
  });

  el('btnReset').addEventListener('click', () => {
    state.view = 'overview';
    [...el('viewBtns').children].forEach((b, i) => b.classList.toggle('on', i === 0));
    applyMode();
  });

  /* ========================= 主循环 ========================= */
  let taskTimer = 0, alarmTimer = 0, lastT = performance.now(), lastUi = 0, clockT = 0, frameMs = 16.7;
  // 自适应画质：连续低于约 38fps 时自动降一档，最多两次；用户手动选过画质则不再干预。
  let qualitySampleMs = 0, qualitySamples = 0, qualityWindowMs = 0, qualityDrops = 0, qualityWarmupMs = 0;
  let frameHandle = 0, loopPending = false, shadowFrame = 0;
  let bootHidden = false;

  function scheduleFrame(){
    if (loopPending) return;
    loopPending = true;
    frameHandle = requestAnimationFrame(t => { loopPending = false; tick(t); });
  }

  function revealBoot(){
    if (bootHidden) return;
    bootHidden = true;
    const boot = document.getElementById('boot');
    if (!boot) return;
    boot.classList.add('hide');
    // 加载层由页面框架渲染（Vue 托管），这里只隐藏不删除，避免和框架的虚拟 DOM 冲突。
    setTimeout(() => { boot.style.display = 'none'; }, 520);
  }

  // 预热：让每台设备一开始就有任务，画面不空
  sharedCranes.forEach((c, i) => {
    if (i % 2 === 0) startTask(floors[(i / 2) % 2], c);
  });

  function tick(now){
    const elapsedMs = Math.max(0.1, now - lastT);
    frameMs += (elapsedMs - frameMs) * 0.06;
    const dt = Math.min(elapsedMs / 1000, 0.06);
    lastT = now;
    const simDt = state.paused ? 0 : dt * state.speed;

    if (!qualityAutoLocked && qualityDrops < 2 && !DASH.open){
      // 先热身 2.5s，并丢掉着色器编译等超长帧，避免首帧抖动导致误降档。
      qualityWarmupMs += elapsedMs;
      if (qualityWarmupMs > 2500 && elapsedMs < 120){
        qualitySampleMs += elapsedMs; qualitySamples++; qualityWindowMs += elapsedMs;
      }
      if (qualityWindowMs > 2600 && qualitySamples > 20){
        const avgFrame = qualitySampleMs / qualitySamples;
        qualitySampleMs = 0; qualitySamples = 0; qualityWindowMs = 0;
        if (avgFrame > 26){
          const next = renderSettings.quality === 'high' ? 'balanced' : 'performance';
          if (next !== renderSettings.quality){ setRenderQuality(next); qualityDrops++; }
        }
      }
    }

    clearTransientAlarms(now);

    // 调度：持续生成任务
    taskTimer += simDt;
    if (taskTimer > 0.85){
      taskTimer = 0;
      const idle = sharedCranes.filter(c => c.state === 'auto' && !c.task);
      if (idle.length && Math.random() < 0.85){
        const c = idle[Math.floor(Math.random() * idle.length)];
        const F = floors[Math.floor(Math.random() * floors.length)];
        startTask(F, c);
      }
    }

    // 随机报警
    alarmTimer += simDt;
    if (alarmTimer > 16 && Math.random() < 0.55){
      alarmTimer = 0;
      const c = sharedCranes[Math.floor(Math.random() * sharedCranes.length)];
      triggerAlarm(c, ['行走定位超差', '货叉超时未到位', '通讯心跳丢失'][Math.floor(Math.random() * 3)]);
    }

    // 每帧每台共享设备只更新一次。
    sharedCranes.forEach(c => {
        if (applyLocalPlcMotion(c)){
          // Positions and status come from the gateway's actual S7 readback.
        } else if (c.state === 'alarm'){
          if (now > c.alarmUntil){
            c.state = 'auto';
            c.dwell = 0;
            if (c.alarmEntry){ c.alarmEntry.active = false; c.alarmEntry = null; }
          }
        } else {
          stepCrane(c, simDt);
        }
        // 应用到 3D
        c.mast.position.x = c.x;
        c.carriage.position.y = c.y;
        if (c.model.updateMotion) c.model.updateMotion({ x: c.x, y: c.y, time: now, state: c.state });
        const sc = STATUS_COLOR[c.state] || 0xeab308;
        c.lampMat.color.setHex(sc);
        c.lampMat.emissive.setHex(sc);
        const pulse = c.state === 'alarm'
          ? 0.55 + 0.6 * Math.sin(now / 120)
          : (c.state === 'task' ? 0.85 : 0.6);
        c.lampMat.emissiveIntensity = pulse;
        c.beacon.scale.setScalar(c.state === 'alarm' ? 1 + 0.4 * Math.sin(now / 120) : 1);
    });
    updateSharedCraneView();

    floors.forEach(F => {
      // 托盘遵循各支线箭头方向，到端头短暂停留后再离开，避免瞬间瞬移。
      const plcSegments = applyConveyorPlcMotion(F);
      const loadedSegments = plcSegments || new Set();
      F.pallets.forEach(p => {
        if (plcSegments) return;
        p.m.visible = uiFlags.inventory;
        if (!p.m.visible) return;
        if (p.wait > 0){
          p.wait -= simDt;
          if (p.wait <= 0) p.m.position.x = p.speed > 0 ? p.startX : p.endX;
        } else {
          p.m.position.x += p.speed * simDt;
          const arrived = p.speed > 0 ? p.m.position.x > p.endX : p.m.position.x < p.startX;
          if (arrived) p.wait = 0.45 + p.seed * 0.7;
          // 只有真正带着托盘的那一段才转动，空线段保持静止。
          if (simDt > 0 && p.segments){
            for (const seg of p.segments)
              if (p.m.position.x >= seg.min - 0.06 && p.m.position.x <= seg.max + 0.06) loadedSegments.add(seg.id);
          }
        }
      });
      // 滚筒按段转动，速度跟随输送线名义线速；暂停时 simDt 为 0 立即停住。
      if (F.conveyorSystem && F.conveyorSystem.updateMotion) F.conveyorSystem.updateMotion(simDt, 0.92, loadedSegments);
      F.palletMachines.forEach(c => {
        const signal = getConveyorSignal(c);
        c.specialModel.setInventoryVisible(uiFlags.inventory);
        c.specialModel.updateMotion({ dt: simDt, time: now, running: loadedSegments.has(c.id),
          alarm: c.model.metadata.alarm, occupied: Boolean(signal.isSimulation && signal.fresh && signal.hasGoods === 1) });
      });
      F.conveyors.forEach(c => {
        c.label.visible = uiFlags.labels && !(state.mode === 3 && F.def.id === 1 && cam.phi < 0.3);
      });
      F.contextLabels.forEach(label => { label.visible = uiFlags.labels; });
    });

    updateCamera(dt);
    floors.forEach(F => {
      if (!F.rack.updateLOD) return;
      const base = F.group.position.y;
      const zMin = rowZ(0) - CFG.rackD / 2, zMax = rowZ(9) + CFG.rackD / 2;
      const dx = Math.max(0, -camera.position.x, camera.position.x - LEN);
      const dy = Math.max(0, base - camera.position.y, camera.position.y - base - RACK_H);
      const dz = Math.max(0, zMin - camera.position.z, camera.position.z - zMax);
      F.rack.updateLOD(Math.hypot(dx, dy, dz), renderSettings.quality);
    });
    if (warehouseEnvironment.setCutaway) warehouseEnvironment.setCutaway({
      cameraPosition: camera.position, view: state.view, floorMode: state.mode
    });
    if (warehouseEnvironment.updateAtmosphere) warehouseEnvironment.updateAtmosphere(now / 1000);

    if (now - lastUi > 420){
      lastUi = now;
      updateKpis();
      renderAisleList();
      renderLineMap();
      el('renderStats').textContent = Math.round(1000 / frameMs) + ' FPS' + (postFX.stats.fallbackReason ? ' · 基础' : '');
      el('renderStats').title = postFX.stats.fallbackReason ? '当前设备使用基础渲染，场景操作可继续使用' : '当前页面实测帧率';
      if (state.selected) renderCraneCard(state.selected);
      if (state.selectedConveyor) renderConveyorCard(state.selectedConveyor);
    }

    if (DASH.open){
      DASH.alarmTick += simDt;
      if (DASH.alarmTick > 22){
        DASH.alarmTick = 0;
        maybeSpawnAlarm();
      }
      if (now - DASH.lastRefresh > 1800){
        DASH.lastRefresh = now;
        refreshDash();
      }
    }

    clockT += dt;
    if (clockT > 1){
      clockT = 0;
      el('clock').textContent = nowStr();
      if (DASH.open) dashClockText();
    }

    if (!DASH.open){
      // 阴影贴图按档位隔帧刷新：厂房结构基本静止，设备阴影滞后 1–2 帧肉眼无感，
      // 却能省掉整趟阴影通道（实测约占每帧三分之一的绘制调用）。
      const shadowInterval = renderSettings.quality === 'high' ? 1 : renderSettings.quality === 'performance' ? 3 : 2;
      shadowFrame++;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = shadowFrame % shadowInterval === 0;
      postFX.render();
      revealBoot();
    }
    scheduleFrame();
  }

  // 页面在后台时不跑渲染循环：省电，也避免切回来时积压一堆待渲染帧。
  document.addEventListener('visibilitychange', () => {
    if (document.hidden){
      cancelAnimationFrame(frameHandle);
    } else {
      lastT = performance.now();
      scheduleFrame();
    }
  });

  window.addEventListener('resize', () => {
    camera.aspect = stage.clientWidth / stage.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(stage.clientWidth, stage.clientHeight);
    postFX.resize(stage.clientWidth, stage.clientHeight);
    if (!state.selected && !state.selectedConveyor) applyView(state.view);
    if (DASH.open && DASH.ready){
      Object.keys(DASH.charts).forEach(k => DASH.charts[k].resize());
      refreshDash();
    }
  });

  const hash = (location.hash || '').replace('#', '').toLowerCase();
  if (hash === '2f' || hash === 'both' || hash === '1f'){
    state.mode = hash === '2f' ? 2 : hash === 'both' ? 3 : 1;
    [...el('floorTabs').children].forEach(b => b.classList.toggle('on', Number(b.dataset.mode) === state.mode));
  }
  applyMode();
  const equipmentParam = typeof URLSearchParams === 'function'
    ? new URLSearchParams(location.search || '').get('equipment') : null;
  const requestedCrane = sharedCranes.find(crane => crane.code === String(equipmentParam || '').toUpperCase());
  if (requestedCrane){ focusRequestedPlc = true; selectCrane(requestedCrane); }
  else selectRequestedConveyor();
  if (hash === 'aisle' || hash === 'top' || hash === 'walk'){
    state.view = hash;
    [...el('viewBtns').children].forEach(b => b.classList.toggle('on', b.dataset.view === hash));
    applyView(state.view);
    updateSceneCaption();
  }
  renderAisleList();
  renderLineMap();
  updateKpis();
  if (window.WcsApi){
    refreshCraneSignals();
    setInterval(refreshCraneSignals, 1000);
  }
  cam.theta = cam.dTheta; cam.phi = cam.dPhi; cam.radius = cam.dRadius;
  cam.curTarget.copy(cam.dTarget);
  el('clock').textContent = nowStr();
  if (hash === 'dashboard') openDash();
  // 只读调试入口：现场排查帧率、绘制调用与场景对象时可从控制台取用。
  window.__twinDebug = { renderer, scene, camera, postFX, floors, sharedCranes, renderSettings, uiFlags };
  scheduleFrame();
})();
