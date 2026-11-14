/* Empty-pallet dispenser / stacker accessory for an existing roller bed.
 * Local X is the conveyor direction; local Z is across the bed. The returned
 * group is placed at (x,0,z), and rotated about Y for a Z-running conveyor.
 * The timber stack and small mechanism cycle are visual examples, not counts
 * or positions read from a PLC. No rollers or carton loads are created here.
 */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;
  const pools = new WeakMap();
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  function acquire(T) {
    let pool = pools.get(T);
    if (!pool) {
      const material = (color, roughness, metalness) => new T.MeshStandardMaterial({ color, roughness, metalness });
      pool = {
        refs: 0,
        geometries: { box: new T.BoxGeometry(1, 1, 1), cylinder: new T.CylinderGeometry(1, 1, 1, 12), hex: new T.CylinderGeometry(1, 1, 1, 6) },
        palette: {
          frame: material(0x3f6275, 0.58, 0.58), dark: material(0x27343c, 0.64, 0.54),
          guard: material(0xe7aa24, 0.55, 0.36), orange: material(0xd57928, 0.55, 0.39),
          steel: material(0xb8c4c9, 0.32, 0.8), cabinet: material(0xc1c9c6, 0.6, 0.3),
          black: material(0x182127, 0.85, 0.08), red: material(0xc93e2f, 0.52, 0.18),
          label: material(0xe6dfc6, 0.85, 0.02),
          wood: new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.94, metalness: 0 })
        }
      };
      pools.set(T, pool);
    }
    pool.refs++;
    return pool;
  }

  function create(options) {
    const T = global.THREE;
    if (!T) throw new Error('WcsPalletMagazine requires THREE.');
    const opts = options || {};
    const id = String(opts.id || '1090');
    const type = opts.type || (id === '1091' ? 'stacker' : 'dispenser');
    const x = Number(opts.x ?? 0), z = Number(opts.z ?? 0);
    const w = Number(opts.w ?? 0.70), depth = Number(opts.depth ?? 1.635);
    const surfaceHeight = Number(opts.surfaceHeight ?? 0.56);
    if (!['dispenser', 'stacker'].includes(type) || ![x, z, w, depth, surfaceHeight].every(Number.isFinite) || w <= 0 || depth <= 0 || surfaceHeight < 0.25)
      throw new Error('Pallet magazine requires a valid type, finite x/z and positive dimensions.');

    const pool = acquire(T), palette = pool.palette;
    const vertical = depth > w, length = Math.max(w, depth), bedWidth = Math.min(w, depth);
    const frameWidth = clamp(bedWidth + 0.50, 1.12, 1.24);
    const frameDepth = clamp(length, 1.38, 1.60);
    const frameHeight = 2.40;
    const height = frameHeight + 0.185;
    const halfU = frameDepth / 2, halfV = frameWidth / 2;
    const postU = halfU - 0.105, postV = halfV - 0.065;
    const palletLength = Math.min(1.10, frameDepth - 0.30);
    const palletWidth = Math.min(0.82, frameWidth - 0.26);
    const palletHeight = 0.125, palletPitch = 0.128;
    const stackBottom = surfaceHeight + 0.305;
    const staticStackCount = type === 'dispenser' ? 7 : 4;
    const group = new T.Group();
    group.name = id + '-' + (type === 'dispenser' ? 'empty-pallet-dispenser' : 'empty-pallet-stacker');
    group.position.set(x, 0, z);
    group.rotation.y = vertical ? -Math.PI / 2 : 0;
    const ownedGeometries = new Set(), ownedMaterials = new Set(), instancedMeshes = [];
    const state = { selected: false, alarm: false, occupied: false, inventoryVisible: true, running: false };
    const animation = { phase: 0, liftOffset: 0, clampOffset: 0, running: false };
    const outerWidth = Math.max(frameWidth, postV * 2 + 0.19);
    const worldWidth = vertical ? outerWidth : frameDepth;
    const worldDepth = vertical ? frameDepth : outerWidth;
    const metadata = {
      id, type, name: type === 'dispenser' ? '空托盘拆盘机' : '空托盘码盘机', floor: Number(opts.floor ?? 1),
      x, z, w, depth, surfaceHeight, height, frameHeight, frameWidth: outerWidth, frameDepth,
      structuralFrameWidth: frameWidth, axis: vertical ? 'z' : 'x', yaw: group.rotation.y,
      origin: 'group.position(x,0,z); geometry is machine-local; local X follows conveyor',
      footprint: { w: worldWidth, width: worldWidth, depth: worldDepth, x, z },
      bounds: { minX: x - worldWidth / 2, maxX: x + worldWidth / 2, minY: 0, maxY: height, minZ: z - worldDepth / 2, maxZ: z + worldDepth / 2 },
      minX: x - worldWidth / 2, maxX: x + worldWidth / 2, minY: 0, maxY: height, minZ: z - worldDepth / 2, maxZ: z + worldDepth / 2,
      staticStackCount, staticStackIsIllustrative: true, palletWidth, palletLength, palletHeight, palletPitch,
      stackBottom, selected: false, alarm: false, occupied: false, inventoryVisible: true,
      phase: 0, liftOffset: 0, clampOffset: 0, state, animation,
      animationIsIllustrative: true, existingRollerBed: true, openPassage: true,
      instanceCount: 0, batchCount: 0, disposed: false
    };
    group.userData.palletMagazine = metadata;
    group.userData.role = 'pallet-magazine';
    const transform = new T.Object3D();

    function assembly(parent, name, role) {
      const result = new T.Group(); result.name = name; result.userData.role = role; parent.add(result); return result;
    }

    // Every static bolt, rail and mesh strand joins a geometry/material batch.
    function batch(parent, label) {
      const buckets = new Map();
      function part(geometry, material, u, y, v, sx, sy, sz, rotation) {
        const key = geometry + '/' + material;
        if (!buckets.has(key)) buckets.set(key, { geometry, material, matrices: [] });
        transform.position.set(u, y, v);
        transform.rotation.set(rotation?.[0] || 0, rotation?.[1] || 0, rotation?.[2] || 0);
        transform.scale.set(sx, sy, sz); transform.updateMatrix();
        buckets.get(key).matrices.push(transform.matrix.clone());
      }
      return {
        box(material, u, y, v, sx, sy, sz, rotation) { part('box', material, u, y, v, sx, sy, sz, rotation); },
        cylinder(material, u, y, v, radius, axialLength, axis, hex) {
          part(hex ? 'hex' : 'cylinder', material, u, y, v, radius, axialLength, radius,
            axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : null);
        },
        finish() {
          for (const bucket of buckets.values()) {
            const mesh = new T.InstancedMesh(pool.geometries[bucket.geometry], palette[bucket.material], bucket.matrices.length);
            mesh.name = label + '-' + bucket.material + '-' + bucket.geometry;
            mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false;
            bucket.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
            mesh.instanceMatrix.needsUpdate = true;
            parent.add(mesh); instancedMeshes.push(mesh);
            metadata.instanceCount += bucket.matrices.length; metadata.batchCount++;
          }
        }
      };
    }

    const frame = assembly(group, 'pallet-magazine-frame', 'machine-frame');
    const body = batch(frame, 'magazine-frame');
    for (const side of [-1, 1]) {
      // Side skids and upper members leave both conveyor ends unobstructed.
      body.box('frame', 0, 0.13, side * postV, frameDepth, 0.115, 0.115);
      body.box('frame', 0, frameHeight - 0.055, side * postV, frameDepth, 0.11, 0.10);
      body.box('steel', 0, 0.203, side * postV, frameDepth - 0.16, 0.018, 0.075);
      for (const end of [-1, 1]) {
        const u = end * postU, v = side * postV;
        body.box('frame', u, frameHeight / 2, v, 0.09, frameHeight - 0.10, 0.10);
        body.box('steel', u + end * 0.048, frameHeight / 2, v, 0.008, frameHeight - 0.24, 0.028);
        body.box('dark', u, 0.025, v, 0.185, 0.05, 0.18);
        body.box('frame', u, 0.10, v, 0.135, 0.10, 0.125);
        for (const du of [-0.064, 0.064]) for (const dv of [-0.06, 0.06]) {
          body.cylinder('steel', u + du, 0.059, v + dv, 0.013, 0.018, 'y', true);
          body.cylinder('dark', u + du, 0.047, v + dv, 0.019, 0.006, 'y');
        }
        // Alternating bands are real small strips on the post faces.
        body.box('guard', u + end * 0.049, 0.92, v, 0.012, 0.43, 0.095);
        for (let stripe = 0; stripe < 5; stripe++) body.box('black', u + end * 0.057, 0.76 + stripe * 0.075, v, 0.005, 0.027, 0.092, [0.45, 0, 0]);
      }
      // Open rod safety screens; no transparent sheets cover the pallet stack.
      const guardLow = surfaceHeight + 0.24, guardHigh = frameHeight - 0.19;
      const guardY = (guardLow + guardHigh) / 2, guardH = guardHigh - guardLow;
      const guardU = frameDepth - 0.22, guardV = side * (halfV - 0.012);
      for (const end of [-1, 1]) body.box('guard', end * guardU / 2, guardY, guardV, 0.026, guardH + 0.05, 0.026);
      for (const y of [guardLow, guardHigh]) body.box('guard', 0, y, guardV, guardU, 0.028, 0.028);
      const verticalStrands = Math.max(8, Math.round(guardU / 0.085));
      for (let i = 1; i < verticalStrands; i++) body.box('orange', -guardU / 2 + guardU * i / verticalStrands, guardY, guardV, 0.008, guardH, 0.008);
      const horizontalStrands = Math.max(8, Math.round(guardH / 0.09));
      for (let i = 1; i < horizontalStrands; i++) body.box('orange', 0, guardLow + guardH * i / horizontalStrands, guardV, guardU, 0.008, 0.008);

      // Paired guide channels, shiny rails, chain return and bearing blocks.
      const guideLow = surfaceHeight + 0.08, guideHigh = frameHeight - 0.17;
      for (const u of [-0.10, 0.10]) {
        body.box('dark', u, (guideLow + guideHigh) / 2, side * (postV - 0.025), 0.065, guideHigh - guideLow, 0.055);
        body.box('steel', u, (guideLow + guideHigh) / 2, side * (postV - 0.062), 0.025, guideHigh - guideLow, 0.018);
      }
      for (const y of [0.34, guideHigh]) {
        body.box('frame', 0.19, y, side * postV, 0.15, 0.125, 0.075);
        body.cylinder('steel', 0.19, y, side * (postV - 0.045), 0.053, 0.045, 'z');
        body.cylinder('dark', 0.19, y, side * (postV - 0.074), 0.022, 0.016, 'z');
      }
      const chainHeight = guideHigh - 0.34, chainLinks = Math.ceil(chainHeight / 0.047);
      for (let i = 0; i < chainLinks; i++) {
        const y = 0.34 + chainHeight * (i + 0.5) / chainLinks;
        body.box('dark', 0.19, y, side * (postV - 0.06), 0.030, 0.032, 0.014);
        if (i % 2 === 0) body.cylinder('steel', 0.19, y, side * (postV - 0.071), 0.006, 0.009, 'z');
      }
      // Through-beam photoelectric sensor pair sits beside, not across, the bed.
      for (const end of [-1, 1]) {
        body.box('steel', end * (postU - 0.18), surfaceHeight + 0.035, side * (postV - 0.04), 0.07, 0.10, 0.025);
        body.box('black', end * (postU - 0.18), surfaceHeight + 0.085, side * (postV - 0.075), 0.047, 0.052, 0.045);
        body.cylinder('red', end * (postU - 0.18), surfaceHeight + 0.085, side * (postV - 0.103), 0.010, 0.010, 'z');
      }
    }
    for (const end of [-1, 1]) {
      body.box('frame', end * postU, frameHeight - 0.055, 0, 0.10, 0.11, frameWidth);
      body.box('label', end * (postU + 0.051), frameHeight - 0.055, 0, 0.006, 0.048, 0.26);
      // Only a floor-level tie is present; the roller-level pass-through is open.
      body.box('dark', end * postU, 0.075, 0, 0.055, 0.035, frameWidth - 0.09);
    }
    // Compact motor / gearbox under the side of the existing conveyor surface.
    body.box('frame', 0.33, 0.28, -postV, 0.22, 0.18, 0.18);
    body.cylinder('frame', 0.51, 0.28, -postV, 0.076, 0.22, 'x');
    for (let fin = 0; fin < 6; fin++) body.cylinder('dark', 0.43 + fin * 0.033, 0.28, -postV, 0.082, 0.010, 'x');
    body.box('dark', 0.51, 0.371, -postV, 0.10, 0.05, 0.10);
    body.cylinder('steel', 0.33, 0.28, -postV + 0.13, 0.027, 0.15, 'z');
    // Side-mounted cabinet, door seams, handle and red mushroom emergency stop.
    const cabinetV = -halfV + 0.075;
    body.box('cabinet', -0.39, 1.01, cabinetV, 0.35, 0.43, 0.12);
    body.box('dark', -0.39, 1.01, cabinetV - 0.063, 0.322, 0.40, 0.004);
    body.box('cabinet', -0.39, 1.01, cabinetV - 0.067, 0.308, 0.386, 0.004);
    body.box('black', -0.29, 0.99, cabinetV - 0.077, 0.015, 0.082, 0.015);
    body.box('black', -0.43, 1.10, cabinetV - 0.073, 0.12, 0.065, 0.008);
    body.box('label', -0.43, 1.10, cabinetV - 0.079, 0.096, 0.041, 0.003);
    body.cylinder('guard', -0.46, 0.93, cabinetV - 0.079, 0.038, 0.010, 'z');
    body.cylinder('red', -0.46, 0.93, cabinetV - 0.096, 0.027, 0.024, 'z');
    body.cylinder('black', -0.38, 0.93, cabinetV - 0.08, 0.014, 0.014, 'z');
    body.box('orange', -0.11, 0.47, -postV, 0.28, 0.18, 0.055);
    body.finish();

    const lift = assembly(group, 'pallet-magazine-lift', 'lifting-mechanism');
    const clampGroups = [];
    for (const side of [-1, 1]) {
      const carrier = assembly(lift, 'pallet-magazine-clamp-' + side, 'pallet-support-fingers');
      const parts = batch(carrier, 'magazine-carriage');
      parts.box('frame', 0, stackBottom + 0.09, side * (postV - 0.045), 0.47, 0.20, 0.105);
      for (const u of [-0.10, 0.10]) parts.box('steel', u, stackBottom + 0.09, side * (postV - 0.105), 0.09, 0.16, 0.035);
      for (const u of [-palletLength * 0.31, palletLength * 0.31]) {
        parts.box('orange', u, stackBottom + 0.04, side * (palletWidth / 2 + 0.025), 0.16, 0.17, 0.06);
        parts.box('steel', u, stackBottom - 0.022, side * (palletWidth / 2 - 0.06), 0.19, 0.035, 0.23);
        parts.cylinder('dark', u, stackBottom + 0.095, side * (palletWidth / 2 + 0.065), 0.022, 0.025, 'z');
      }
      parts.finish(); clampGroups.push({ group: carrier, side });
    }

    // A merged, vertex-coloured timber pallet: five deck boards, separate
    // bearers and nine blocks leave genuine fork pockets on all four sides.
    function palletGeometry() {
      const pieces = [], colors = [0xbda075, 0xc9ad82, 0xae8e62, 0xc2a17a, 0xb89c75];
      let index = 0;
      function plank(sx, sy, sz, u, y, v) {
        const source = new T.BoxGeometry(sx, sy, sz), geometry = source.toNonIndexed(); source.dispose(); geometry.translate(u, y, v);
        const color = new T.Color(colors[index++ % colors.length]);
        const normals = geometry.getAttribute('normal'), values = new Float32Array(normals.count * 3);
        for (let n = 0; n < normals.count; n++) {
          const shade = normals.getY(n) > 0.5 ? 1.04 : normals.getX(n) < -0.5 ? 0.93 : 1;
          values[n * 3] = color.r * shade; values[n * 3 + 1] = color.g * shade; values[n * 3 + 2] = color.b * shade;
        }
        geometry.setAttribute('color', new T.BufferAttribute(values, 3)); pieces.push(geometry);
      }
      for (const side of [-1, 0, 1]) {
        const v = side * palletWidth * 0.34;
        plank(palletLength * 0.98, 0.018, palletWidth * 0.17, 0, 0.009, v);
        for (const end of [-1, 0, 1]) plank(palletLength * 0.14, 0.067, palletWidth * 0.15, end * palletLength * 0.40, 0.0515, v);
        plank(palletLength * 0.98, 0.018, palletWidth * 0.16, 0, 0.094, v);
      }
      for (let board = 0; board < 5; board++) plank(palletLength * 0.178, 0.022, palletWidth, (board - 2) * palletLength * 0.202, 0.114, 0);
      const merged = new T.BufferGeometry();
      for (const name of ['position', 'normal', 'color']) {
        const total = pieces.reduce((sum, item) => sum + item.getAttribute(name).array.length, 0);
        const data = new Float32Array(total); let cursor = 0;
        for (const item of pieces) { const array = item.getAttribute(name).array; data.set(array, cursor); cursor += array.length; }
        merged.setAttribute(name, new T.BufferAttribute(data, 3));
      }
      pieces.forEach(item => item.dispose());
      merged.computeBoundingBox(); merged.computeBoundingSphere(); ownedGeometries.add(merged);
      return merged;
    }
    const timberGeometry = palletGeometry();
    const staticStack = assembly(group, 'pallet-magazine-static-stack', 'illustrative-empty-pallet-stack');
    const stackMesh = new T.InstancedMesh(timberGeometry, palette.wood, staticStackCount);
    stackMesh.name = 'EmptyTimberPalletStack'; stackMesh.castShadow = stackMesh.receiveShadow = true; stackMesh.frustumCulled = false;
    for (let i = 0; i < staticStackCount; i++) {
      transform.position.set(0, stackBottom + i * palletPitch, 0); transform.rotation.set(0, 0, 0); transform.scale.set(1, 1, 1); transform.updateMatrix();
      stackMesh.setMatrixAt(i, transform.matrix); stackMesh.setColorAt(i, new T.Color().setScalar(0.94 + (i % 3) * 0.035));
    }
    stackMesh.instanceMatrix.needsUpdate = true; if (stackMesh.instanceColor) stackMesh.instanceColor.needsUpdate = true;
    staticStack.add(stackMesh); instancedMeshes.push(stackMesh);
    metadata.instanceCount += staticStackCount; metadata.batchCount++;
    const conveyorPallet = assembly(group, 'pallet-magazine-conveyor-pallet', 'occupied-empty-pallet');
    conveyorPallet.position.y = surfaceHeight + 0.009;
    const singlePallet = new T.Mesh(timberGeometry, palette.wood);
    singlePallet.name = 'EmptyTimberPalletOnRollers'; singlePallet.castShadow = singlePallet.receiveShadow = true;
    conveyorPallet.add(singlePallet); conveyorPallet.visible = false;

    const lights = assembly(group, 'pallet-magazine-status-light', 'plc-status-light');
    const lampMaterials = {};
    const lampColors = { green: 0x4eac76, amber: 0xe7aa36, red: 0xe35543 };
    const stem = new T.Mesh(pool.geometries.cylinder, palette.black); stem.scale.set(0.017, 0.12, 0.017); stem.position.set(postU, frameHeight + 0.03, -postV); lights.add(stem);
    for (const [index, color] of ['green', 'amber', 'red'].entries()) {
      const mat = new T.MeshStandardMaterial({ color: lampColors[color], emissive: lampColors[color], emissiveIntensity: 0.05, roughness: 0.38, metalness: 0.05 });
      ownedMaterials.add(mat); lampMaterials[color] = mat;
      const lamp = new T.Mesh(pool.geometries.cylinder, mat);
      lamp.name = 'MagazineStatus-' + color; lamp.scale.set(0.028, 0.036, 0.028); lamp.position.set(postU, frameHeight + 0.075 + index * 0.041, -postV); lights.add(lamp);
    }

    function outline(name, color) {
      const geometry = new T.EdgesGeometry(new T.BoxGeometry(frameDepth + 0.03, height + 0.02, outerWidth + 0.03)); ownedGeometries.add(geometry);
      const material = new T.LineBasicMaterial({ color, transparent: true, opacity: 0.90, depthTest: false }); ownedMaterials.add(material);
      const lines = new T.LineSegments(geometry, material); lines.name = name; lines.position.y = height / 2; lines.renderOrder = 15; lines.visible = false; group.add(lines); return lines;
    }
    const selectionOutline = outline('pallet-magazine-selection-outline', 0x77d5ed);
    const alarmOutline = outline('pallet-magazine-alarm-outline', 0xf16b51);

    function syncLights() {
      lampMaterials.red.emissiveIntensity = state.alarm ? 0.95 : 0.035;
      lampMaterials.green.emissiveIntensity = !state.alarm && state.running ? 0.65 : 0.035;
      lampMaterials.amber.emissiveIntensity = !state.alarm && !state.running ? 0.22 : 0.035;
    }
    function setSelected(value) { state.selected = metadata.selected = Boolean(value); selectionOutline.visible = state.selected; }
    function setAlarm(value) { state.alarm = metadata.alarm = Boolean(value); alarmOutline.visible = state.alarm; syncLights(); }
    function setOccupied(value) { state.occupied = metadata.occupied = Boolean(value); conveyorPallet.visible = state.inventoryVisible && state.occupied; }
    function setInventoryVisible(value) {
      state.inventoryVisible = metadata.inventoryVisible = Boolean(value);
      staticStack.visible = state.inventoryVisible; conveyorPallet.visible = state.inventoryVisible && state.occupied;
    }
    function updateMotion(motion) {
      if (metadata.disposed) return;
      const next = motion || {};
      if (next.alarm !== undefined) setAlarm(next.alarm);
      if (next.occupied !== undefined) setOccupied(next.occupied);
      if (next.running !== undefined) state.running = Boolean(next.running);
      animation.running = state.running && !state.alarm;
      syncLights();
      const dt = Number(next.dt);
      if (!state.running || state.alarm || !Number.isFinite(dt) || dt <= 0) return;
      metadata.phase = animation.phase = (animation.phase + Math.min(dt, 0.10) * 1.55) % TAU;
      metadata.liftOffset = animation.liftOffset = Math.sin(animation.phase) * 0.024;
      metadata.clampOffset = animation.clampOffset = (1 - Math.cos(animation.phase)) * 0.013;
      lift.position.y = staticStack.position.y = animation.liftOffset;
      for (const item of clampGroups) item.group.position.z = item.side * animation.clampOffset;
    }
    function dispose() {
      if (metadata.disposed) return;
      metadata.disposed = true;
      instancedMeshes.forEach(mesh => mesh.dispose?.());
      ownedGeometries.forEach(geometry => geometry.dispose()); ownedMaterials.forEach(material => material.dispose());
      if (--pool.refs === 0) {
        Object.values(pool.geometries).forEach(geometry => geometry.dispose()); Object.values(pool.palette).forEach(material => material.dispose()); pools.delete(T);
      }
      group.removeFromParent(); group.clear();
    }
    syncLights();
    return { group, metadata, setSelected, setAlarm, setOccupied, setInventoryVisible, updateMotion, dispose };
  }

  global.WcsPalletMagazine = Object.freeze({ create });
})(typeof window !== 'undefined' ? window : globalThis);
