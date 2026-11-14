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
  // 上限放到 2×：高分屏上 1.5× 会让钢架细杆和输送线细节糊成灰带；
  // 低端机会由帧率降档逻辑把像素比拉回 1×。真正生效值仍由画质档位在 applyPixelRatio 里收口。
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(stage.clientWidth, stage.clientHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.setClearColor(0x131d25, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.appendChild(renderer.domElement);

  const LIGHT = window.WcsWarehouseLighting;
  const FOG_NEAR = LIGHT && LIGHT.FOG_NEAR ? LIGHT.FOG_NEAR : 132;
  const FOG_FAR = LIGHT && LIGHT.FOG_FAR ? LIGHT.FOG_FAR : 460;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x131d25);
  scene.fog = new THREE.Fog(0x131d25, FOG_NEAR, FOG_FAR);

  const camera = new THREE.PerspectiveCamera(42, stage.clientWidth / stage.clientHeight, 0.15, 500);

  /* ========================= 取景框 ========================= */
  // 画布铺满整个窗口、左右面板浮在上面。不扣掉面板的宽度，货架两端就会压在
  // 半透明面板下面，看起来像"主体被裁了一角"。这里量出真正露出来的矩形：
  // 取景按这块矩形算距离，再用 setViewOffset 把主体平移到矩形中心。
  const frameRect = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
  // ?frame=full 保留旧的整画布取景，便于对比取景改动前后的构图。
  const frameFullCanvas = typeof URLSearchParams === 'function'
    ? new URLSearchParams(location.search || '').get('frame') === 'full' : false;
  // 量一块覆盖层占掉的画布边距。Node 下的布局回归脚本只有最小 DOM 桩，
  // 没有 querySelector/getComputedStyle，这里一律按 0 处理，取景退回整画布。
  function measureOverlay(selector, mode) {
    if (typeof document.querySelector !== 'function' || typeof window.getComputedStyle !== 'function') return 0;
    let node = null, style = null;
    try { node = document.querySelector(selector); style = node && window.getComputedStyle(node); } catch (_) { return 0; }
    if (!node || !style) return 0;
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.06) return 0;
    const rect = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
    if (!rect) return 0;
    if (mode === 'width') return Math.max(0, rect.width);
    if (mode === 'height') return Math.max(0, rect.height);
    return Math.max(0, stage.clientHeight - rect.top);
  }
  function syncFraming() {
    const W = Math.max(1, stage.clientWidth), H = Math.max(1, stage.clientHeight);
    const left = frameFullCanvas ? 0 : Math.min(measureOverlay('.panel.left', 'width'), W * 0.32);
    const right = frameFullCanvas ? 0 : Math.min(measureOverlay('.panel.right', 'width'), W * 0.32);
    const top = frameFullCanvas ? 0 : Math.min(measureOverlay('.topbar', 'height'), H * 0.2);
    const bottom = frameFullCanvas ? 0 : Math.min(measureOverlay('.scene-tools', 'above'), H * 0.25);
    frameRect.left = left; frameRect.right = right; frameRect.top = top; frameRect.bottom = bottom;
    frameRect.width = Math.max(W * 0.4, W - left - right);
    frameRect.height = Math.max(H * 0.4, H - top - bottom);
    // 露出区域的中心相对画布中心的偏移；视锥反向平移即可，不挪相机目标，拾取仍准确。
    camera.setViewOffset(W, H, (right - left) / 2, (bottom - top) / 2, W, H);
    camera.updateProjectionMatrix();
  }

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
  // 地坪贴图同时当凹凸图用：极小的 bumpScale 在掠射角下能把水泥浆的颗粒读出来，
  // 又不会在远处产生噪点。
  const concreteMap = window.WcsWarehouseLighting.concreteTexture(renderer);
  const M = {
    slab:     new THREE.MeshStandardMaterial({ color: 0x767d80, map: concreteMap, bumpMap: concreteMap, bumpScale: 0.012,
                roughness: 0.5, metalness: 0.06 }),
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
    // 库位拾取体同样是全透明体：2000 个实例每帧画一次却不出像素，隐藏掉，
    // 点选仍由 raycaster 命中（不检查 visible）。
    cellMesh.visible = false;
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
      // 纯拾取体：材质 colorWrite=false，画出来也看不见，却每帧占一次绘制调用
      // （152 段 × 2~3 个通道）。raycaster 不检查 visible，隐藏后照常命中。
      body.visible = false;
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
        part.visible = false;
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
  // 微件批次（螺栓、轴销、链节…）按楼层收集，主循环按相机到楼层的距离
  // 整批显隐：总览时它们是亚像素却占近一半三角形，近距特写/第一视角全部保留。
  floors.forEach(F => {
    F.detailMicro = [];
    F.group.traverse(o => {
      if (o.isInstancedMesh && o.userData.detailTier === 'micro') F.detailMicro.push(o);
    });
    F.detailVisible = true;
  });
  // 场景装配完成后统一压一次环境反射：PMREM 里的灯板很亮，金属件按默认 1.0 接收
  // 会让镀锌钢和地坪整体发灰；0.68 保留高光但把暗部留下来，主光才读得出方向。
  if (LIGHT && LIGHT.applyReflectance) LIGHT.applyReflectance(scene, 0.68);

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
    syncFraming();
    if (name === 'fpv') return;   // 第一视角的相机由 updateFpvCamera 每帧驱动
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
    // 按"面板之外真正露出来的那块画布"和楼层包围盒适配视角：
    // 横向用露出宽度折算半视角，纵向用露出高度折算，主体就不会钻进面板底下。
    const W = Math.max(1, stage.clientWidth), H = Math.max(1, stage.clientHeight);
    const dir = new THREE.Vector3(Math.sin(cam.dPhi) * Math.sin(cam.dTheta), Math.cos(cam.dPhi), Math.sin(cam.dPhi) * Math.cos(cam.dTheta));
    const right = new THREE.Vector3(Math.cos(cam.dTheta), 0, -Math.sin(cam.dTheta));
    const up = new THREE.Vector3().crossVectors(dir, right);
    const tan = Math.tan(camera.fov * Math.PI / 360);
    const tanV = tan * (frameRect.height / H), tanH = tan * camera.aspect * (frameRect.width / W);
    let radius = 60;
    [-12, LEN + 4].forEach(x => [baseY, maxY].forEach(y => [planZ(-255), planZ(900)].forEach(z => {
      const p = new THREE.Vector3(x,y,z).sub(cam.dTarget);
      radius = Math.max(radius, p.dot(dir) + Math.abs(p.dot(right)) / tanH, p.dot(dir) + Math.abs(p.dot(up)) / tanV);
    })));
    cam.dRadius = radius * (name === 'top' ? 1.08 : 1.04);
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
    if (state.view === 'fpv' && fpv.active){
      // 第一视角：拖拽环视，左右按钮一致；就位前的摆放阶段仍用轨道拖拽。
      fpv.yaw -= dx * 0.0042;
      fpv.pitch = clamp(fpv.pitch - dy * 0.0032, -1.35, 1.35);
      return;
    }
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
    if (state.view === 'fpv' && fpv.active){
      // 滚轮沿视线方向在地面行走，向上滚是前进。
      const step = -e.deltaY * 0.0035;
      const bounds = fpvBounds();
      fpv.x = clamp(fpv.x + Math.sin(fpv.yaw) * step, bounds.x1, bounds.x2);
      fpv.z = clamp(fpv.z + Math.cos(fpv.yaw) * step, bounds.z1, bounds.z2);
      return;
    }
    cam.dRadius = clamp(cam.dRadius * (1 + e.deltaY * 0.0011), 2.4, 320);
  }, { passive: false });

  function updateCamera(dt){
    if (state.view === 'fpv' && fpv.active){ updateFpvCamera(dt); return; }
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

  /* ========================= 第一视角 ========================= */
  // 工人在画布上点一块地面，相机挪到该点 1.62m 眼高；拖拽环视、
  // W/A/S/D 与滚轮沿地面行走，附近设备清单实时发布给 Vue 面板。
  const FPV_EYE = 1.62;
  const FPV_NEARBY_RANGE = 22;
  const fpv = {
    active: false, placing: false,
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
    cur: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 },
    keys: new Set(), nearby: [], nearbyTimer: 0
  };
  // 站立点标记：一圈蓝环加一个朝向楔形，总览时也能看到“人”在哪。
  const workerMarker = (() => {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.5, 40),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    const wedge = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.42, 3),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.92, depthWrite: false })
    );
    wedge.rotation.x = Math.PI / 2;   // 锥尖指向 +Z，随 yaw 绕 Y 旋转
    wedge.position.set(0, 0.02, 0.42);
    g.add(ring, wedge);
    g.visible = false;
    g.traverse(o => { o.userData.noShadow = true; o.userData.noAO = true; o.renderOrder = 5; });
    scene.add(g);
    return g;
  })();

  function fpvBounds(){ return { x1: -12, x2: LEN + 3, z1: planZ(-255) + 0.5, z2: planZ(900) - 0.5 }; }

  function fpvAim(x, y, z){
    // 就位时朝哪看，决定第一眼有没有信息量：
    //  - 站在巷道里 → 顺着巷道（厂房长轴）看，纵深最清楚；
    //  - 设备就在脚边（<2.4m）→ 平视只会看到它后面的墙，改看纵深；
    //  - 其余情况 → 面向最近的设备，俯仰角对准它台面。
    const eye = y + FPV_EYE;
    const alongHall = () => ({ yaw: x > LEN / 2 ? -Math.PI / 2 : Math.PI / 2, pitch: -0.1 });
    const aimAt = (tx, ty, tz) => ({
      yaw: Math.atan2(tx - x, tz - z),
      pitch: clamp(Math.atan2(ty - eye, Math.hypot(tx - x, tz - z)), -0.44, 0.1)
    });
    for (let a = 0; a < CFG.aisles; a++){
      if (Math.abs(z - aisleZ(a)) < CFG.aisleW / 2 + 0.4) return alongHall();
    }
    // 与 updateFpvNearby 同层过滤：站在 2F 平台时，正下方 1F 的输送机
    // 平面距离可能最近，但隔着楼板看不见，面向它等于面墙。
    let best = null, bestD = 1e9;
    floors.filter(F => Math.abs(F.group.position.y - y) < 1).forEach(F => F.conveyors.forEach(c => {
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < bestD){ bestD = d; best = { x: c.x, y: F.group.position.y + 0.64, z: c.z }; }
    }));
    sharedCranes.forEach(c => {
      const d = Math.hypot(c.x - x, c.group.position.z - z);
      if (d < bestD){ bestD = d; best = { x: c.x, y: c.group.position.y + 2.1, z: c.group.position.z }; }
    });
    if (!best || bestD < 2.4) return alongHall();
    return aimAt(best.x, best.y, best.z);
  }

  function enterFpv(){
    fpv.placing = true;
    fpv.active = false;
    fpv.keys.clear();
    fpv.nearby = [];
    dom.style.cursor = 'crosshair';
    publishFpv();
    updateSceneCaption();
    syncFraming();
  }

  function placeWorker(point){
    const bounds = fpvBounds();
    fpv.x = clamp(point.x, bounds.x1, bounds.x2);
    fpv.z = clamp(point.z, bounds.z1, bounds.z2);
    fpv.y = point.y > FLOOR_RISE / 2 ? FLOOR_RISE : 0;
    const aim = fpvAim(fpv.x, fpv.y, fpv.z);
    fpv.yaw = aim.yaw;
    fpv.pitch = aim.pitch;
    // 从当前轨道相机的位置与视线反推 yaw/pitch，平滑过渡过去，不硬跳。
    fpv.cur.x = camera.position.x;
    fpv.cur.y = camera.position.y;
    fpv.cur.z = camera.position.z;
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    fpv.cur.yaw = Math.atan2(dir.x, dir.z);
    fpv.cur.pitch = Math.asin(clamp(dir.y, -1, 1));
    fpv.placing = false;
    fpv.active = true;
    camera.fov = 50;
    camera.updateProjectionMatrix();
    workerMarker.position.set(fpv.x, fpv.y + 0.035, fpv.z);
    workerMarker.visible = true;
    dom.style.cursor = '';
    publishFpv();
    updateSceneCaption();
  }

  function exitFpv(nextView, deferView){
    fpv.placing = false;
    fpv.active = false;
    fpv.keys.clear();
    fpv.nearby = [];
    workerMarker.visible = false;
    dom.style.cursor = '';
    camera.fov = 42;
    camera.updateProjectionMatrix();
    state.view = nextView || 'overview';
    [...el('viewBtns').children].forEach(b => b.classList.toggle('on', b.dataset.view === state.view));
    publishFpv();
    // 调用方若紧接着会跑 applyMode（切楼层），这里就不要多算一遍取景。
    if (!deferView){ applyView(state.view); updateSceneCaption(); }
  }

  function publishFpv(){
    const model = {
      active: fpv.active, placing: fpv.placing,
      floor: fpv.y > FLOOR_RISE / 2 ? '2F' : '1F',
      x: +fpv.x.toFixed(1), z: +fpv.z.toFixed(1),
      nearby: fpv.nearby
    };
    if (!changed('fpv', JSON.stringify(model))) return;
    publish('fpv', model);
  }

  function fpvDirectionLabel(relRad){
    const deg = relRad * 180 / Math.PI;
    if (Math.abs(deg) <= 20) return '正前方';
    if (deg > 20 && deg <= 70) return '左前方';
    if (deg < -20 && deg >= -70) return '右前方';
    if (deg > 70 && deg <= 160) return '左侧';
    if (deg < -70 && deg >= -160) return '右侧';
    return '正后方';
  }

  function updateFpvNearby(){
    const items = [];
    // 同层输送设备才算"附近"：站在 2F 平台时，脚底下的 1F 输送机并不是眼前的东西。
    // 堆垛机跨两层共用，始终参与。
    floors.filter(F => Math.abs(F.group.position.y - fpv.y) < 1).forEach(F => F.conveyors.forEach(c => {
      const dx = c.x - fpv.x, dz = c.z - fpv.z;
      const d = Math.hypot(dx, dz);
      if (d < FPV_NEARBY_RANGE) items.push({ id: String(c.id), kind: c.machineName || (CONVEYOR_KINDS[c.kind] || c.kind), d, a: Math.atan2(dx, dz) });
    }));
    sharedCranes.forEach(c => {
      const dx = c.x - fpv.x, dz = c.group.position.z - fpv.z;
      const d = Math.hypot(dx, dz);
      if (d < FPV_NEARBY_RANGE) items.push({ id: c.code, kind: '堆垛机', d, a: Math.atan2(dx, dz) });
    });
    items.sort((a, b) => a.d - b.d);
    fpv.nearby = items.slice(0, 8).map(item => {
      let rel = item.a - fpv.yaw;
      while (rel > Math.PI) rel -= 2 * Math.PI;
      while (rel < -Math.PI) rel += 2 * Math.PI;
      return { id: item.id, kind: item.kind, distance: +item.d.toFixed(1), direction: fpvDirectionLabel(rel) };
    });
    publishFpv();
  }

  function updateFpvCamera(dt){
    // W/S 前后、A/D 左右；滚轮行走放在 wheel 事件里。
    const fwd = (fpv.keys.has('KeyW') || fpv.keys.has('ArrowUp') ? 1 : 0) - (fpv.keys.has('KeyS') || fpv.keys.has('ArrowDown') ? 1 : 0);
    const strafe = (fpv.keys.has('KeyD') || fpv.keys.has('ArrowRight') ? 1 : 0) - (fpv.keys.has('KeyA') || fpv.keys.has('ArrowLeft') ? 1 : 0);
    if (fwd || strafe){
      const speed = 3.2 * dt;
      const sin = Math.sin(fpv.yaw), cos = Math.cos(fpv.yaw);
      const bounds = fpvBounds();
      fpv.x = clamp(fpv.x + (sin * fwd - cos * strafe) * speed, bounds.x1, bounds.x2);
      fpv.z = clamp(fpv.z + (cos * fwd + sin * strafe) * speed, bounds.z1, bounds.z2);
    }
    const k = 1 - Math.exp(-dt * 10);
    fpv.cur.x += (fpv.x - fpv.cur.x) * k;
    fpv.cur.y += (fpv.y - fpv.cur.y) * k;
    fpv.cur.z += (fpv.z - fpv.cur.z) * k;
    let dyaw = fpv.yaw - fpv.cur.yaw;
    while (dyaw > Math.PI) dyaw -= 2 * Math.PI;
    while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
    fpv.cur.yaw += dyaw * k;
    fpv.cur.pitch += (fpv.pitch - fpv.cur.pitch) * k;
    const ex = fpv.cur.x, ey = fpv.cur.y + FPV_EYE, ez = fpv.cur.z;
    const cp = Math.cos(fpv.cur.pitch);
    camera.position.set(ex, ey, ez);
    camera.lookAt(ex + Math.sin(fpv.cur.yaw) * cp, ey + Math.sin(fpv.cur.pitch), ez + Math.cos(fpv.cur.yaw) * cp);
    workerMarker.position.set(fpv.cur.x, fpv.cur.y + 0.035, fpv.cur.z);
    workerMarker.rotation.y = fpv.cur.yaw;
    fpv.nearbyTimer -= dt;
    if (fpv.nearbyTimer <= 0){
      fpv.nearbyTimer = 0.35;
      updateFpvNearby();
    }
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
    const simulated = s7Link.devices.filter(device => device.isSimulation || device.isLocal || isLoopbackAddress(device.ipAddress));
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
      isSimulation: detail.isSimulation || detail.isLocal || isLoopbackAddress(detail.ipAddress),
      block,
      tags,
      updatedAt: block?.lastReadAt || detail.lastReadAt || null
    };
  }

  function hasLocalPlcSource(crane){
    const device = findCraneSignalDevice(crane);
    return Boolean(device && (device.isSimulation || device.isLocal || isLoopbackAddress(device.ipAddress)));
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
      isSimulation: detail.isSimulation || detail.isLocal || isLoopbackAddress(detail.ipAddress), points, readFailed: false };
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
      isSimulation: Boolean(device && (device.isSimulation || device.isLocal || isLoopbackAddress(device.ipAddress))),
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
      const detail = await window.WcsApi.request(`api/telemetry/devices/${encodeURIComponent(device.id)}`, { timeoutMs: 3000 });
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
      const devices = await window.WcsApi.request('api/telemetry/devices', { timeoutMs: 3000 });
      s7Link.devices = Array.isArray(devices) ? devices : [];
      s7Link.gatewayOnline = true;
      await Promise.all([...sharedCranes.map(async crane => {
        const device = findCraneSignalDevice(crane);
        if (!device){ craneSignals.delete(crane.code); return; }
        if (crane !== state.selected && !hasLocalPlcSource(crane)) return;
        try {
          const detail = await window.WcsApi.request(`api/telemetry/devices/${encodeURIComponent(device.id)}`, { timeoutMs: 3000 });
          craneSignals.set(crane.code, signalFromDeviceDetail(detail));
        } catch (_) { craneSignals.delete(crane.code); }
      }), ...floors.map(F => refreshConveyorSignals(F))]);
      if (focusRequestedPlc && state.selected && craneSignals.get(state.selected.code)?.block?.quality === 'good'){
        if (applyLocalPlcMotion(state.selected)){
          focusPosition(new THREE.Vector3(state.selected.x, state.selected.y, state.selected.group.position.z), 24);
        }
        focusRequestedPlc = false;
      }
      publishSelection();
    } catch (_) {
      s7Link.gatewayOnline = false;
      publishSelection();
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

  /* 信号块只产出数据，HTML 由 Vue 的 SignalBlock 组件渲染；
   * state: note（没有可用信号源）/ waiting（有设备但还没读到值）/ ok（正常反馈）。 */
  const mm = value => Number(value).toLocaleString('en-US');

  function craneSignalModel(crane){
    if (!window.WcsApi)
      return { state: 'note', note: 'S7 网关未加载，当前为页面演示数据。' };
    if (!s7Link.gatewayOnline)
      return { state: 'note', note: 'S7 网关未连接；不会用演示值替代 PLC 信号。' };
    const signal = craneSignals.get(crane.code);
    if (!signal)
      return { state: 'note', note: '未在 S7 网关中找到 ' + crane.code + ' 对应设备。可在“S7 设备接入”中添加同名配置。' };
    const block = signal.block;
    if (!block || !block.hasData){
      return {
        state: 'waiting',
        isSimulation: signal.isSimulation,
        updatedAt: '等待首次读取',
        note: '连接状态：' + signal.deviceState + '；尚未取得 ' + crane.code + ' 的 PLC 反馈值。'
      };
    }

    const quality = block.quality || 'unknown';
    const tags = signal.tags;
    const alarm = Number(tags.PLC_ERROR || 0);
    const mode = Number(tags.PLC_PATTERN || 0);
    const dispatch = Number(tags.PLC_DISPATCH || 0);
    const hasLoad = Number(tags.PLC_VANSTATE || 0);
    const x = Number.isFinite(tags.PLC_LOCATX) ? Number(tags.PLC_LOCATX) : null;
    const y = Number.isFinite(tags.PLC_LOCATY) ? Number(tags.PLC_LOCATY) : null;
    const fork = Number.isFinite(tags.PLC_LOCATZ) ? Number(tags.PLC_LOCATZ) : null;
    const forkOffset = fork === null ? null : fork - FORK_CENTER_MM;
    const coordinate = (label, value) => ({
      label: label,
      text: value === null ? '--' : mm(value) + ' mm',
      sub: value === null ? '' : (value / 1000).toFixed(3) + ' m'
    });

    return {
      state: 'ok',
      isSimulation: signal.isSimulation,
      qualityText: QUALITY_TEXT[quality] || quality,
      tone: quality === 'good' ? 'good' : quality === 'stale' ? 'warn' : 'bad',
      updatedAt: formatSignalTime(signal.updatedAt),
      tiles: [
        { label: '报警', value: alarm ? '故障码 ' + alarm : '无报警', hint: 'PLC_ERROR', tone: alarm ? 'bad' : 'good' },
        { label: '模式', value: PLC_MODE_TEXT[mode] || '未知(' + mode + ')', hint: 'PLC_PATTERN',
          tone: mode === 1 ? 'good' : mode === 3 ? 'bad' : 'warn' },
        { label: '调度', value: dispatch === 1 ? '可调度' : '不可调度', hint: 'PLC_DISPATCH', tone: dispatch === 1 ? 'good' : 'bad' },
        { label: '载货台', value: hasLoad === 1 ? '有货' : '无货', hint: 'PLC_VANSTATE', tone: hasLoad === 1 ? 'warn' : 'good' }
      ],
      coords: [coordinate('行走 X', x), coordinate('提升 Y', y)],
      fork: fork === null ? null : {
        value: mm(fork) + ' mm',
        left: clamp(fork / 10000 * 100, 2, 98),
        offset: (forkOffset >= 0 ? '+' : '') + mm(forkOffset) + ' mm'
      }
    };
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

    if (state.view === 'fpv' && fpv.placing){
      // 摆放阶段只认地面：打在楼板上就就位；点到设备/货架不动，避免隔着设备把人放进场里。
      const slabs = floors.map(F => F.slab).filter(Boolean);
      const slabHit = raycaster.intersectObjects(slabs, false)[0];
      if (slabHit){ placeWorker(slabHit.point); return; }
      // 楼板边缘外再退回 1F 地平面，但仅在射线确实先碰到地面附近时才接受。
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const point = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, point)){
        const bounds = fpvBounds();
        const inBounds = point.x >= bounds.x1 - 1 && point.x <= bounds.x2 + 1 && point.z >= bounds.z1 - 1 && point.z <= bounds.z2 + 1;
        if (inBounds){
          const equipment = [];
          floors.forEach(F => { equipment.push(F.cellMesh); F.conveyors.forEach(c => equipment.push(c.body)); });
          const blocker = raycaster.intersectObjects(equipment, false)[0];
          if (!blocker || blocker.distance > raycaster.ray.origin.distanceTo(point) + 1) placeWorker(point);
        }
      }
      return;
    }

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
    if (state.view !== 'fpv')
      focusPosition(new THREE.Vector3(crane.x, focusY, crane.group.position.z), 24);
    publishSelection();
    publishAisles();
    refreshCraneSignals();
  }

  function publishSelection(){
    const model = selectionModel();
    if (!changed('selection', JSON.stringify(model))) return;
    publish('right.selection', model);
  }

  /* 选中对象的结构化快照：Vue 只管按字段排版，不再拼 HTML。 */
  function selectionModel(){
    if (state.selected) return craneSelection(state.selected);
    if (state.selectedCell && state.selectedCellFloor) return cellSelection(state.selectedCellFloor, state.selectedCell);
    if (state.selectedConveyor) return conveyorSelection(state.selectedConveyor);
    return { kind: 'empty' };
  }

  function craneSelection(crane){
    const st = statusText(crane.state);
    const location = crane.y >= FLOOR_RISE ? '2F' : '1F';
    const hasPlc = hasLocalPlcSource(crane);
    const liveTask = craneSignals.get(crane.code)?.tags.PLC_TASKNO ?? '—';
    const taskText = hasPlc ? liveTask
      : crane.task ? crane.task.id + ' / ' + (TASK_TYPE_TEXT[crane.task.type] || '') : '—';
    return {
      kind: 'crane',
      title: crane.code,
      meta: 'A0' + (crane.aisle + 1) + ' · 两层共用',
      rows: [
        { label: '服务范围', value: '1F / 2F' },
        { label: '当前位置', value: location },
        { label: '运行状态', value: st.text, color: st.color },
        { label: '行走位置', value: 'X ' + crane.x.toFixed(1) + ' m', mono: true },
        { label: '载货台', value: 'Y ' + crane.y.toFixed(1) + ' m', mono: true },
        { label: '任务楼层', value: crane.task ? crane.task.floor.def.label : '—' },
        { label: '当前任务', value: String(taskText), mono: true }
      ],
      notes: hasPlc ? ['本地 PLC 驱动模型 · 1 mm = 0.001 m，超出行程时模型限幅。货叉位置见下方刻度。'] : [],
      signal: craneSignalModel(crane)
    };
  }

  function cellSelection(F, cell){
    return {
      kind: 'cell',
      title: '库位 ' + cell.code,
      meta: F.def.label + ' · A0' + (cell.aisle + 1) + ' · ' + (cell.side === 'L' ? '左排' : '右排'),
      rows: [
        { label: '状态', value: cell.occupied ? '有货' : '空库位' },
        { label: '货品', value: cell.occupied ? cell.sku : '—', mono: true },
        { label: '批次', value: cell.occupied ? cell.batch : '—', mono: true },
        { label: '货架层', value: cell.rackLevel + '（' + F.def.label + ' 第 ' + (cell.level + 1) + ' 层）' },
        { label: '列', value: pad2(cell.bay + 1), mono: true }
      ]
    };
  }

  function conveyorSignalModel(c){
    const signal = getConveyorSignal(c);
    if (!signal.mapped){
      return { state: 'note', note: signal.equipmentCode + ' · 此图纸设备未提供 PLC 点位映射（' + c.id + '），不生成模拟反馈。' };
    }
    if (!signal.device){
      return { state: 'note', note: signal.equipmentCode + ' · 源设备 ' + signal.sourceId + ' · 尚未配置 S7 连接，当前为页面演示。' };
    }
    const rawStatus = signal.status === null ? '—' : String(signal.status);
    const statusName = signal.isSimulation && signal.status !== null
      ? ({ 0: '停止', 1: '运行', 2: '报警', 3: '离线' }[signal.status] || '未知') + '（' + rawStatus + '）'
      : '原值 ' + rawStatus;
    const goodsName = signal.hasGoods === null ? '—' : signal.isSimulation
      ? signal.hasGoods === 1 ? '有货（1）' : signal.hasGoods === 0 ? '无货（0）' : '未知（' + signal.hasGoods + '）'
      : '原值 ' + signal.hasGoods;
    const notes = [];
    if (!signal.fresh) notes.push(signal.hasData ? '上次成功值已失效；滚筒停止，货物隐藏。' : '等待有效 S7 读取；滚筒停止，货物隐藏。');
    notes.push(signal.isSimulation
      ? '模拟约定：0 停止 / 1 运行 / 2 报警 / 3 离线；有货且运行时滚筒转动。'
      : '现场状态枚举待核对，仅展示读取原值；尚未驱动输送模型。');
    return {
      state: 'ok',
      isSimulation: signal.isSimulation,
      qualityText: QUALITY_TEXT[signal.quality] || signal.quality,
      tone: signal.quality === 'good' ? 'good' : signal.quality === 'stale' ? 'warn' : 'bad',
      updatedAt: formatSignalTime(signal.updatedAt),
      meta: '源设备 ' + signal.sourceId + ' · DB600 · ' + signal.device.name,
      tiles: [
        { label: '运行状态', value: statusName },
        { label: '占货', value: goodsName }
      ],
      barcode: signal.barcode === null ? '—' : signal.barcode === '' ? '（空）' : String(signal.barcode),
      notes: notes
    };
  }

  function conveyorSelection(c){
    const rows = [];
    if (c.station){
      rows.push({ label: '方向', value: c.station.dir === 'IN' ? '入库 →' : '← 出库' });
      rows.push({ label: '相邻支线段', value: String(c.id === c.station.no ? c.station.pair : c.station.no), mono: true });
    }
    if (c.kind === 'junction') rows.push({ label: '转接机构', value: '正交顶升链条（静态展示）' });
    const notes = [];
    if (!c.station) notes.push('编号与平面图对应。');
    notes.push(c.specialModel
      ? '结构：四柱机架 · 升降承托叉 · 托盘导向 · 安全围护；盘垛为结构示意，实时占货见 PLC 反馈。'
      : '结构：圆筒滚筒 · 链传动 · 调平支腿。');
    return {
      kind: 'conveyor',
      title: (c.machineName || '输送设备') + ' ' + c.id,
      meta: c.floor.def.label + ' · ' + (CONVEYOR_KINDS[c.kind] || '输送设备'),
      rows: rows,
      notes: notes,
      signal: conveyorSignalModel(c)
    };
  }

  function selectCell(F, cell){
    clearSelection(true);
    state.selectedCell = cell;
    state.selectedCellFloor = F;
    const gp = F.group.position;
    highlight.position.set(cell.x + gp.x, cell.y + gp.y, cell.z + gp.z);
    highlight.visible = true;
    publishSelection();
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
    if (state.view !== 'fpv')
      focusPosition(new THREE.Vector3(c.x + gp.x, (machineH ? machineH * 0.50 : 0.45) + gp.y, c.z + gp.z),
        machineH ? Math.max(6.0, machineH * 2.65) : Math.max(5, Math.max(c.w, c.depth) * 2.8));
    publishSelection();
    publishDevices();
    refreshCraneSignals();
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
    state.selectedCellFloor = null;
    if (state.selectedConveyor){
      state.selectedConveyor.model.setSelected(false);
      state.selectedConveyor.specialModel?.setSelected(false);
      state.selectedConveyor.partModels.forEach(model => model.setSelected(false));
    }
    state.selectedConveyor = null;
    highlight.visible = false;
    // keepCamera=true 是“换选中对象”的中转清理，占位文案与高亮交给调用方接着发布，
    // 否则卡片会先闪一下默认提示再换成新对象。
    if (!keepCamera){
      publishSelection();
      publishDevices();
    }
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
    // 进出库改变的是选中库位的“有货/货品/批次”，跟着发布一次即可。
    if (state.selectedCell === cell) publishSelection();
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

  /* ========================= 面板状态发布（引擎 → Vue） ========================= */
  /* 引擎不再写左右面板与看板的 DOM，只把状态快照 publish 给 Vue，组件负责渲染；
   * 面板里的点击通过 window.WcsTwin.bind() 注册的命令回到引擎。
   * 每段自带签名比对：内容没变就不发布，避免把 420ms 的节拍变成无谓的组件更新。 */
  const UI = window.WcsTwin;
  if (!UI) console.error('[twin] 未找到 WcsTwin 状态桥，左右面板将停在初始状态。');
  const publish = (path, value) => { if (UI) UI.publish(path, value); };
  const signatures = Object.create(null);
  const changed = (key, signature) => {
    if (signatures[key] === signature) return false;
    signatures[key] = signature;
    return true;
  };
  // 画质档位同时约束渲染像素比：高分屏上按档位收口，避免 2× 全开拖垮填充率。
  // 均衡档提到 1.5×、精细档 2×：细钢杆和输送线在这种比例下才不糊成灰带，
  // 低端机由主循环的帧率降档逻辑兜底回退。
  const DPR_CAP = { performance: 1, balanced: 1.5, high: 2 };
  function applyPixelRatio(quality){
    const cap = DPR_CAP[quality] || 1.5;
    const ratio = Math.min(window.devicePixelRatio || 1, cap);
    if (Math.abs(renderer.getPixelRatio() - ratio) < 0.01) return;
    renderer.setPixelRatio(ratio);
    renderer.setSize(stage.clientWidth, stage.clientHeight);
    postFX.resize(stage.clientWidth, stage.clientHeight);
  }
  // 微件（螺栓/轴销/链节/链轮）按楼层显隐的距离阈值（米），带滞回：
  // 总览半径约 90m 时全部隐藏，巷道/特写/第一视角（<20m）全部保留。
  const DETAIL_LOD = {
    performance: { show: 42, hide: 54 },
    balanced: { show: 58, hide: 72 },
    high: { show: 76, hide: 90 }
  };
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
  function reframeAfterPanelTransition(){
    // 面板是 CSS 过渡（transform/opacity），不能用固定延时赌它已经结束：
    // 首帧编译着色器时一次重绘可能就要几秒，固定 340ms 会量到过渡前的宽度。
    const panel = typeof document.querySelector === 'function'
      ? (document.querySelector('.panel.left') || document.querySelector('.panel.right')) : null;
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      if (panel) panel.removeEventListener('transitionend', onEnd);
      if (!state.selected && !state.selectedConveyor) applyView(state.view);
      else syncFraming();
    };
    const onEnd = event => { if (!event || event.propertyName === 'opacity' || event.propertyName === 'transform') run(); };
    if (panel) panel.addEventListener('transitionend', onEnd);
    if (typeof setTimeout === 'function') setTimeout(run, 600); else run();
  }
  function setImmersive(visible){
    renderSettings.immersive = visible;
    document.body.classList.toggle('immersive', visible);
    el('btnImmersive').setAttribute('aria-pressed', String(visible));
    el('btnImmersive').textContent = visible ? '显示面板' : '沉浸视图';
    // 面板滑走/滑回来后可用画面宽度变了，等过渡结束再重新取景一次。
    reframeAfterPanelTransition();
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

  const TASK_TYPE_TEXT = { IN: '入库', OUT: '出库', MOVE: '移库' };

  function publishTasks(){
    publish('right.tasks', taskRows.map(row => ({
      t: row.t, id: row.id, who: row.who, path: row.what,
      typeText: TASK_TYPE_TEXT[row.type] || row.type,
      tone: row.type === 'IN' ? 'in' : row.type === 'OUT' ? 'out' : 'mv'
    })));
  }

  function publishAlarms(){
    publish('right.alarms', alarmRows.map(row => ({
      t: row.t, who: row.who, what: row.what, level: row.level
    })));
  }

  function pushTaskRow(data){
    taskRows.unshift(data);
    if (taskRows.length > 7) taskRows.pop();
    publishTasks();
  }

  function pushAlarmRow(data){
    alarmRows.unshift({
      t: data.t, who: data.who, what: data.what,
      level: data.level || 'warning'
    });
    if (alarmRows.length > 5) alarmRows.pop();
    publishAlarms();
  }

  /* ---------- 左栏：KPI / 设备索引 / 巷道 / 输送段 / 控制 ---------- */
  function publishKpis(){
    const fs = visibleFloors();
    let total = 0, occ = 0;
    fs.forEach(F => {
      total += F.cells.length;
      occ += F.cells.reduce((n, c) => n + (c.occupied ? 1 : 0), 0);
    });
    const tasks = sharedCranes.filter(c => c.task && fs.includes(c.task.floor)).length;
    const alarms = sharedCranes.filter(c => c.state === 'alarm').length;
    const pct = total ? (occ / total * 100) : 0;
    const floorTag = state.mode === 1 ? '1F' : state.mode === 2 ? '2F' : '1F + 2F';
    if (changed('kpis', total + '|' + pct.toFixed(1) + '|' + tasks + '|' + alarms)){
      publish('left.kpis', {
        total: total,
        occupancy: total ? Number(pct.toFixed(1)) : null,
        tasks: tasks,
        alarms: alarms
      });
    }
    if (changed('floorTag', floorTag)) publish('left.floorTag', floorTag);
  }

  // 设备索引只发当前楼层的全量清单，搜索关键词与计数留在组件里算。
  function publishDevices(){
    const all = visibleFloors().flatMap(F => F.conveyors);
    const items = all.map(c => ({
      id: c.id,
      floor: c.floor.def.label,
      kind: c.machineName || CONVEYOR_KINDS[c.kind] || '输送设备',
      selected: state.selectedConveyor === c
    })).sort((a, b) => Number(a.id) - Number(b.id));
    if (!changed('devices', state.mode + '|' + items.map(d => d.id + (d.selected ? '*' : '')).join(','))) return;
    publish('left.devices', { total: all.length, items: items });
  }

  function publishAisles(){
    const fs = visibleFloors();
    const rows = sharedCranes.map(c => {
      const cells = fs.flatMap(F => F.cells.filter(x => x.aisle === c.aisle));
      return {
        index: c.aisle,
        name: 'A0' + (c.aisle + 1),
        code: c.code,
        pct: cells.length ? Math.round(cells.filter(x => x.occupied).length / cells.length * 100) : 0,
        state: c.state,
        color: '#' + STATUS_COLOR[c.state].toString(16).padStart(6, '0'),
        selected: state.selected === c,
        hint: '两层共用 · ' + (c.task ? c.task.floor.def.label + '任务' : '待命')
      };
    });
    const signature = state.mode + '|' + rows.map(r =>
      r.code + ':' + r.pct + ':' + r.state + ':' + (r.selected ? 1 : 0)).join(',');
    if (!changed('aisles', signature)) return;
    publish('left.aisles', rows);
  }

  function publishLineMap(){
    const floorTag = state.mode === 3 ? '1F + 2F' : state.mode + 'F';
    const groups = visibleFloors().map(F => ({
      label: state.mode === 3 ? F.def.label : '',
      rows: ROW_STATIONS[F.def.id].map((pair, i) => {
        const inSt = pair.find(x => x.dir === 'IN');
        const outSt = pair.find(x => x.dir === 'OUT');
        return {
          name: 'A0' + (i + 1),
          inText: '入 ' + inSt.pair + ' → ' + inSt.no,
          outText: '出 ' + outSt.pair + ' ← ' + outSt.no
        };
      })
    }));
    if (!changed('lineMap', floorTag)) return;
    publish('left.lineMap', { floorTag: floorTag, groups: groups });
  }

  function publishControls(){
    if (!changed('controls', state.speed + '|' + (state.paused ? 1 : 0))) return;
    publish('left.controls', { speed: state.speed, paused: state.paused });
  }

  /* 420ms 节拍与楼层切换都只刷新这一组，签名比对决定是否真的惊动组件。 */
  function publishLeft(){
    publishKpis();
    publishAisles();
    publishLineMap();
    publishControls();
    publishDevices();
  }

  /* ========================= 数据看板 · 任务 / 库位 / 报警 ========================= */
  const DASH = {
    open: false, opened: false, logSeeded: false,
    lastRefresh: 0, domain: 'all', seq: 0, alarmTick: 0,
    log: [], transient: [], hist: [],
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
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

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

  /* ---------- 发布给看板组件 ---------- */
  // KPI 卡片、表格、成因条与 7 张图全部由 Vue 按快照渲染；图表组件自己懒加载 echarts，
  // 引擎这边只负责产出数字，不再拼 HTML、也不再持有图表实例。
  function publishClock(){
    const d = new Date();
    publish('dash.clock', {
      time: nowStr(),
      date: d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + WEEK[d.getDay()]
    });
  }

  // 表格只展示最近 8 条，点击定位仍走引擎命令。
  function publishAlarmLog(){
    publish('dash.log', DASH.log.slice(0, 8).map(entry => ({
      id: entry.id, t: entry.t, who: entry.who, what: entry.what,
      level: entry.level, active: entry.active
    })));
  }

  function refreshDash(){
    if (!DASH.open) return;
    publish('dash.snapshot', dashSnapshot());
    publishAlarmLog();
    publishClock();
    publish('dash.updatedAt', nowStr());
  }

  /* ---------- URL 深链：楼层 / 视角 / 看板写入 hash，前进后退可回退 ----------
   * 新格式 #f=both&v=top&dash=1；兼容旧链接 #1f / #2f / #both / #top / #aisle / #walk / #dashboard。
   * 打开看板 push 一条历史，关闭只 replace 当前条目：Back 回到打开前的状态，不会把看板重新打开。 */
  const FLOOR_HASH = { 1: '1', 2: '2', 3: 'both' };
  let hashFromPop = false;   // popstate / 启动期间应用状态，不再回写历史

  function parseHashState(){
    const raw = (location.hash || '').replace(/^#/, '').toLowerCase();
    const result = { mode: null, view: null, dash: false };
    if (!raw) return result;
    if (raw.indexOf('=') > -1){
      raw.split('&').forEach(part => {
        const kv = part.split('=');
        if (kv[0] === 'f') result.mode = kv[1] === '1' ? 1 : kv[1] === '2' ? 2 : kv[1] === 'both' ? 3 : null;
        else if (kv[0] === 'v' && /^(top|aisle|walk)$/.test(kv[1])) result.view = kv[1];
        else if (kv[0] === 'dash') result.dash = kv[1] === '1';
      });
      return result;
    }
    if (raw === '1f') result.mode = 1;
    else if (raw === '2f') result.mode = 2;
    else if (raw === 'both') result.mode = 3;
    else if (/^(top|aisle|walk)$/.test(raw)) result.view = raw;
    else if (raw === 'dashboard') result.dash = true;
    return result;
  }

  function buildHash(){
    const parts = ['f=' + FLOOR_HASH[state.mode]];
    if (/^(top|aisle|walk)$/.test(state.view)) parts.push('v=' + state.view);
    if (DASH.open) parts.push('dash=1');
    return '#' + parts.join('&');
  }

  function pageUrl(hash){
    return (location.pathname || 'index.html') + (location.search || '') + hash;
  }

  function pushHash(){
    if (hashFromPop || typeof window.history?.pushState !== 'function') return;
    const target = buildHash();
    if ((location.hash || '') === target) return;
    window.history.pushState(null, '', pageUrl(target));
  }

  function replaceHash(){
    if (hashFromPop || typeof window.history?.replaceState !== 'function') return;
    const target = buildHash();
    if ((location.hash || '') === target) return;
    window.history.replaceState(null, '', pageUrl(target));
  }

  // 前进 / 后退：按当前 hash 还原楼层、视角与看板状态，应用期间不再回写历史。
  function applyHashState(){
    const parsed = parseHashState();
    hashFromPop = true;
    try {
      if (parsed.mode && parsed.mode !== state.mode){
        state.mode = parsed.mode;
        [...el('floorTabs').children].forEach(b => b.classList.toggle('on', Number(b.dataset.mode) === state.mode));
        if (state.view === 'fpv'){ exitFpv('overview', true); }
        applyMode();
      }
      if (parsed.view && parsed.view !== state.view){
        if (state.view === 'fpv'){ exitFpv(parsed.view); }
        else {
          state.view = parsed.view;
          [...el('viewBtns').children].forEach(b => b.classList.toggle('on', b.dataset.view === parsed.view));
          applyView(state.view);
          updateSceneCaption();
        }
      }
      if (parsed.dash && !DASH.open) openDash();
      else if (!parsed.dash && DASH.open) closeDash();
    } finally {
      hashFromPop = false;
    }
  }

  function openDash(){
    if (DASH.open) return;
    DASH.open = true;
    DASH.opened = true;
    publish('dash.open', true);
    publish('dash.opened', true);
    if (!DASH.log.length) seedDashLog();
    setDashDomain('all');
    publishClock();
    refreshDash();
    pushHash();
  }

  function closeDash(){
    if (!DASH.open) return;
    DASH.open = false;
    publish('dash.open', false);
    // 打开时 push 过历史，关闭只更新当前条目；Back 回到打开前的状态。
    replaceHash();
  }

  function setDashDomain(domain){
    DASH.domain = domain;
    publish('dash.domain', domain);
  }

  function setFloorMode(mode){
    state.mode = mode;
    Array.prototype.forEach.call(el('floorTabs').children || [], function(b){
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

  /* ---------- 面板命令：Vue 组件 → 引擎 ---------- */
  function locateAlarmById(id){
    const entry = DASH.log.filter(x => String(x.id) === String(id))[0];
    if (!entry || !entry.target) return;
    closeDash();
    locateAlarm(entry);
  }

  function selectDeviceById(id){
    const conveyor = visibleFloors().flatMap(F => F.conveyors).find(item => String(item.id) === String(id));
    if (conveyor){ selectConveyor(conveyor); return; }
    const crane = sharedCranes.find(item => item.code === String(id).toUpperCase());
    if (crane) selectCrane(crane);
  }

  function selectAisleByIndex(index){
    const crane = sharedCranes[Number(index)];
    if (!crane) return;
    selectCrane(crane);
    applyView('aisle');
  }

  function togglePause(){
    state.paused = !state.paused;
    publishControls();
    updateSignalLink();
  }

  function cycleSpeed(){
    const arr = [1, 1.5, 2, 0.5];
    state.speed = arr[(arr.indexOf(state.speed) + 1) % arr.length];
    publishControls();
  }

  function demoAlarm(){
    const crane = sharedCranes[Math.floor(Math.random() * sharedCranes.length)];
    triggerAlarm(crane, ['行走定位超差', '货叉超时未到位', '通讯心跳丢失'][Math.floor(Math.random() * 3)]);
  }

  function resetView(){
    if (state.view === 'fpv'){ exitFpv('overview'); pushHash(); return; }
    state.view = 'overview';
    [...el('viewBtns').children].forEach((b, i) => b.classList.toggle('on', i === 0));
    applyMode();
    pushHash();
  }

  if (UI){
    UI.bind({
      openDash: openDash,
      closeDash: closeDash,
      setDashDomain: setDashDomain,
      locateAlarm: locateAlarmById,
      selectDevice: selectDeviceById,
      selectAisle: selectAisleByIndex,
      togglePause: togglePause,
      cycleSpeed: cycleSpeed,
      demoAlarm: demoAlarm,
      resetView: resetView
    });
  }

  window.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && DASH.open) closeDash();
    if (state.view !== 'fpv') return;
    // 第一视角：ESC 退出；W/A/S/D 与方向键行走（输入框里打字不算）。
    if (e.key === 'Escape'){ exitFpv('overview'); return; }
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '')) return;
    if (/^(KeyW|KeyA|KeyS|KeyD|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/.test(e.code)){
      fpv.keys.add(e.code);
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', e => fpv.keys.delete(e.code));

  /* ========================= 楼层切换 ========================= */
  el('floorTabs').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.mode = Number(btn.dataset.mode);
    [...el('floorTabs').children].forEach(b => b.classList.toggle('on', b === btn));
    // 切楼层是"看哪一层"的显示模式，和站在哪一层不是一回事：
    // 第一视角下切楼层先退回总览，免得人站在被隐藏的那层悬空。
    if (state.view === 'fpv'){ exitFpv('overview', true); }
    applyMode();
    pushHash();
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
    publishLeft();
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
    if (state.view === 'fpv'){
      el('sceneCaption').innerHTML = fpv.placing
        ? '<b>第一视角 · 待就位</b><br>可站 1F 地坪或 2F 平台'
        : '<b>第一视角 · ' + (fpv.y > FLOOR_RISE / 2 ? '2F' : '1F') + ' · 眼高 1.62 m</b><br>拖拽环视 · W/A/S/D 或滚轮行走 · ESC 返回总览';
      return;
    }
    const two = state.mode === 3;
    el('sceneCaption').innerHTML = '<b>' + (two ? '双层空间 · 2F 在上 / 1F 在下' : (state.mode === 1 ? '1F · 一层输送区与立体库' : '2F · 二层输送区与立体库')) + '</b><br>' +
      (two && state.view === 'top' ? '上下货架连续 10 层 · 俯视投影重合' : '上下货架连续 10 层 · TC01–TC05 两层共用');
  }

  el('viewBtns').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const next = btn.dataset.view;
    if (next === 'fpv'){
      if (state.view === 'fpv') return;
      [...el('viewBtns').children].forEach(b => b.classList.toggle('on', b === btn));
      state.view = 'fpv';
      enterFpv();
      return;
    }
    [...el('viewBtns').children].forEach(b => b.classList.toggle('on', b === btn));
    if (state.view === 'fpv'){ exitFpv(next); pushHash(); return; }
    state.view = next;
    applyView(state.view);
    updateSceneCaption();
    pushHash();
  });

  // 设备搜索框、设备索引、运行控制按钮都改由 LeftPanel 渲染，交互走上面的命令表，
  // 引擎这边不再监听这些元素（它们随时会被 Vue 重新 patch 掉）。

  /* ========================= 主循环 ========================= */
  let taskTimer = 0, alarmTimer = 0, lastT = performance.now(), lastUi = 0, clockT = 0, frameMs = 16.7;
  // 自适应画质：连续低于约 38fps 时自动降一档，最多两次；用户手动选过画质则不再干预。
  let qualitySampleMs = 0, qualitySamples = 0, qualityWindowMs = 0, qualityDrops = 0, qualityWarmupMs = 0;
  let frameHandle = 0, loopPending = false, shadowFrame = 0;
  let bootHidden = false;

  // SPA 路由切到工程页时三维 DOM 保留但不可见：挂起渲染循环省电，切回时恢复。
  let routeHidden = false;

  function scheduleFrame(){
    if (loopPending || routeHidden) return;
    loopPending = true;
    frameHandle = requestAnimationFrame(t => { loopPending = false; tick(t); });
  }

  window.addEventListener('wcs:twin-route-hidden', event => {
    routeHidden = !(event && event.detail && event.detail.visible);
    if (routeHidden){
      if (loopPending){ cancelAnimationFrame(frameHandle); loopPending = false; }
    } else {
      lastT = performance.now();
      scheduleFrame();
    }
  });

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
      // 微件批次按"楼层整体（含输送区）"的最近点距离显隐：整层一个实例批
      // 吃不到视锥剔除，总览视角螺栓/链节全是亚像素，却占近一半三角形。
      // 滞回区间防止卡在阈值上来回闪。
      if (F.detailMicro && F.detailMicro.length){
        const t = DETAIL_LOD[renderSettings.quality] || DETAIL_LOD.balanced;
        const fdx = Math.max(0, -1 - camera.position.x, camera.position.x - LEN - 1);
        const fdz = Math.max(0, planZ(-255) - camera.position.z, camera.position.z - planZ(900));
        const d = Math.hypot(fdx, dy, fdz);
        const show = F.detailVisible ? d < t.hide : d < t.show;
        if (show !== F.detailVisible){
          F.detailVisible = show;
          F.detailMicro.forEach(m => { m.visible = show; });
        }
      }
    });
    if (warehouseEnvironment.setCutaway) warehouseEnvironment.setCutaway({
      // 摆放阶段相机还在外面，仍旧剖切；人真正站进去以后才补齐四面墙。
      cameraPosition: camera.position,
      view: state.view === 'fpv' ? (fpv.active ? 'fpv' : 'overview') : state.view,
      floorMode: state.mode
    });
    if (warehouseEnvironment.updateAtmosphere) warehouseEnvironment.updateAtmosphere(now / 1000);

    if (now - lastUi > 420){
      lastUi = now;
      publishLeft();
      el('renderStats').textContent = Math.round(1000 / frameMs) + ' FPS' + (postFX.stats.fallbackReason ? ' · 基础' : '');
      el('renderStats').title = postFX.stats.fallbackReason ? '当前设备使用基础渲染，场景操作可继续使用' : '当前页面实测帧率';
      if (state.selected || state.selectedCell || state.selectedConveyor) publishSelection();
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
      if (DASH.open) publishClock();
    }

    if (!DASH.open){
      // 阴影贴图按档位隔帧刷新：厂房结构基本静止，设备阴影滞后 1–2 帧肉眼无感，
      // 却能省掉整趟阴影通道（实测约占每帧三分之一的绘制调用）。
      // 再降频（每 3 帧）实测收益落在噪声里，却让移动中的堆垛机阴影滞后约 100ms，
      // 近景看得出“影子拖在后面”，因此保持 2 帧。
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
    syncFraming();
    renderer.setSize(stage.clientWidth, stage.clientHeight);
    postFX.resize(stage.clientWidth, stage.clientHeight);
    if (!state.selected && !state.selectedConveyor) applyView(state.view);
    if (DASH.open) refreshDash();
  });

  const bootHash = parseHashState();
  if (bootHash.mode){
    state.mode = bootHash.mode;
    [...el('floorTabs').children].forEach(b => b.classList.toggle('on', Number(b.dataset.mode) === state.mode));
  }
  applyMode();
  const equipmentParam = typeof URLSearchParams === 'function'
    ? new URLSearchParams(location.search || '').get('equipment') : null;
  const requestedCrane = sharedCranes.find(crane => crane.code === String(equipmentParam || '').toUpperCase());
  if (requestedCrane){ focusRequestedPlc = true; selectCrane(requestedCrane); }
  else selectRequestedConveyor();
  if (bootHash.view){
    state.view = bootHash.view;
    [...el('viewBtns').children].forEach(b => b.classList.toggle('on', b.dataset.view === bootHash.view));
    applyView(state.view);
    updateSceneCaption();
  }
  publishLeft();
  publishSelection();
  publishTasks();
  publishAlarms();
  if (window.WcsApi){
    refreshCraneSignals();
    setInterval(refreshCraneSignals, 1000);
  }
  cam.theta = cam.dTheta; cam.phi = cam.dPhi; cam.radius = cam.dRadius;
  cam.curTarget.copy(cam.dTarget);
  el('clock').textContent = nowStr();
  // 启动时按 hash 打开看板：当前条目本身就是这个状态，不再 push 历史。
  hashFromPop = true;
  if (bootHash.dash) openDash();
  hashFromPop = false;
  // 前进 / 后退 / 手改 hash 时还原楼层、视角与看板状态。
  window.addEventListener('popstate', applyHashState);
  window.addEventListener('hashchange', applyHashState);
  // 只读调试入口：现场排查帧率、绘制调用与场景对象时可从控制台取用。
  window.__twinDebug = { renderer, scene, camera, postFX, floors, sharedCranes, renderSettings, uiFlags, frameRect, fpv, fpvAim };
  scheduleFrame();
})();
