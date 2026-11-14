/* Floor-wide batches of industrial roller conveyors. addSegment collects
 * physical parts; finish creates one InstancedMesh per geometry/material pair.
 * Selection outlines are the only individually drawn objects and start hidden.
 */
(function () {
  'use strict';

  function createSystem(options) {
    const T = window.THREE;
    if (!T) throw new Error('WcsConveyorModel requires THREE.');
    const surfaceHeight = Number(options?.surfaceHeight ?? 0.56);
    if (!Number.isFinite(surfaceHeight) || surfaceHeight < 0.25)
      throw new Error('Conveyor surfaceHeight must be at least 0.25 metres.');
    const group = new T.Group(); group.name = 'industrial-roller-conveyor-system';
    const batches = new Map();
    const geometries = new Map([
      ['box', new T.BoxGeometry(1, 1, 1)],
      ['cylinder', new T.CylinderGeometry(1, 1, 1, 16)],
      ['pin', new T.CylinderGeometry(1, 1, 1, 8)],
      ['hex', new T.CylinderGeometry(1, 1, 1, 6)]
    ]);
    const zincPixels = new Uint8Array(32 * 32 * 4);
    for (let i = 0; i < 32 * 32; i++) {
      const speck = ((Math.imul(i + 73, 2654435761) >>> 16) & 15) - 7;
      zincPixels[i * 4] = 234 + speck;
      zincPixels[i * 4 + 1] = 236 + speck;
      zincPixels[i * 4 + 2] = 238 + speck;
      zincPixels[i * 4 + 3] = 255;
    }
    const zincMap = new T.DataTexture(zincPixels, 32, 32, T.RGBAFormat);
    zincMap.wrapS = zincMap.wrapT = T.RepeatWrapping;
    zincMap.encoding = T.sRGBEncoding;
    zincMap.generateMipmaps = true; zincMap.minFilter = T.LinearMipmapLinearFilter; zincMap.anisotropy = 8;
    zincMap.needsUpdate = true;

    /* The roller bed only reads as "running" if the cylinder surface carries a
     * visible pattern. A machined finish with two polished bands is generated
     * once and scrolled around the circumference, so the whole conveyor system
     * animates with two texture-offset writes per frame instead of touching
     * thousands of instance matrices.
     */
    function machinedTexture(size, bands, base, swing, encoding) {
      const data = new Uint8Array(size * size * 4);
      for (let y = 0; y < size; y++) {
        const v = y / (size - 1);
        for (let x = 0; x < size; x++) {
          const u = x / (size - 1);
          const band = 0.5 + 0.5 * Math.cos((u * bands) % 1 * Math.PI * 2);
          const grain = ((Math.imul(x + 31, 2654435761) ^ Math.imul(y + 17, 40503)) >>> 26) & 7;
          const value = Math.max(0, Math.min(255, Math.round(base + swing * band - grain)));
          const index = (y * size + x) * 4;
          data[index] = value;
          data[index + 1] = value + (encoding ? 1 : 0);
          data[index + 2] = value + (encoding ? 2 : 0);
          data[index + 3] = 255;
        }
      }
      const texture = new T.DataTexture(data, size, size, T.RGBAFormat);
      texture.wrapS = texture.wrapT = T.RepeatWrapping;
      texture.minFilter = T.LinearMipmapLinearFilter;
      texture.magFilter = T.LinearFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = 8;
      if (encoding) texture.encoding = T.sRGBEncoding;
      texture.needsUpdate = true;
      return texture;
    }
    const rollerMap = machinedTexture(64, 4, 188, 22, true);
    const rollerRoughness = machinedTexture(64, 4, 112, 36, false);
    const chainMap = machinedTexture(32, 6, 108, 28, true);

    const materials = {
      zinc: new T.MeshStandardMaterial({ color: 0xc4cbcf, roughness: 0.5, metalness: 0.48, map: zincMap }),
      roller: new T.MeshStandardMaterial({ color: 0xc7d0d5, roughness: 0.3, metalness: 0.78,
        map: rollerMap, roughnessMap: rollerRoughness }),
      steel: new T.MeshStandardMaterial({ color: 0x9ba8af, roughness: 0.33, metalness: 0.75 }),
      chain: new T.MeshStandardMaterial({ color: 0x727e85, roughness: 0.45, metalness: 0.78, map: chainMap }),
      dark: new T.MeshStandardMaterial({ color: 0x465159, roughness: 0.52, metalness: 0.56 }),
      orange: new T.MeshStandardMaterial({ color: 0xe57624, roughness: 0.53, metalness: 0.4 }),
      rubber: new T.MeshStandardMaterial({ color: 0x272e32, roughness: 0.87, metalness: 0.03 })
    };
    const outlineGeometry = new T.EdgesGeometry(new T.BoxGeometry(1, 1, 1));
    const outlineMaterial = new T.LineBasicMaterial({ color: 0x2582dc, transparent: true, opacity: 0.95, depthTest: false });
    const alarmOutlineMaterial = new T.LineBasicMaterial({ color: 0xe6a126, transparent: true, opacity: 0.95, depthTest: false });
    const transform = new T.Object3D(), localRotation = new T.Quaternion(), yawRotation = new T.Quaternion();
    const euler = new T.Euler(), axisY = new T.Vector3(0, 1, 0);
    const metadata = { surfaceHeight, segmentCount: 0, rollerCount: 0, instanceCount: 0,
      batchCount: 0, finished: false, batches: [], segments: [] };
    let finished = false;
    // The roller batch is the only instanced mesh rewritten at runtime.
    let rollerMesh = null;

    // Small toothed sprockets are restricted to the drive/return shafts. Other
    // shafts use their cylindrical bearing/chain pins, keeping triangle cost low.
    const star = new T.Shape();
    for (let i = 0; i < 32; i++) {
      const angle = i * Math.PI / 16;
      const r = i % 4 === 0 || i % 4 === 3 ? 1 : 0.77;
      if (i) star.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
      else star.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
    }
    star.closePath();
    const sprocket = new T.ExtrudeGeometry(star, { depth: 1, bevelEnabled: false, steps: 1 });
    sprocket.translate(0, 0, -0.5); geometries.set('sprocket', sprocket);

    function addSegment(config) {
      if (finished) throw new Error('Call addSegment before conveyor finish().');
      const d = config || {};
      const x = Number(d.x), z = Number(d.z), w = Number(d.w), depth = Number(d.depth);
      if (![x, z, w, depth].every(Number.isFinite) || w < 0.08 || depth < 0.08)
        throw new Error('Conveyor segments require finite x/z and positive w/depth.');
      const vertical = depth > w;
      const length = vertical ? depth : w, width = vertical ? w : depth;
      const yaw = vertical ? -Math.PI / 2 : 0;
      const cosine = vertical ? 0 : 1, sine = vertical ? -1 : 0;
      yawRotation.setFromAxisAngle(axisY, yaw);
      const starts = new Map([...batches].map(([key, batch]) => [key, batch.matrices.length]));
      const details = d.details !== false;
      const id = String(d.id ?? 'link-' + (metadata.segmentCount + 1));
      const segment = { id, kind: d.kind || 'branch', x, z, w, depth, width, length,
        vertical, axis: vertical ? 'z' : 'x', surfaceHeight, details,
        rollerRadius: 0, rollerLength: 0, rollerCount: 0, rollerPitch: 0,
        rollerCentres: [], legStations: [], legInstances: [], footInstances: [], adjusterInstances: [], ranges: [],
        selectionName: 'conveyor-selection-' + metadata.segmentCount + '-' + id };

      function world(u, y, v) { return { x: x + cosine * u + sine * v, y, z: z - sine * u + cosine * v }; }
      function part(geometry, material, u, y, v, sx, sy, sz, rx, ry, rz) {
        const key = geometry + '/' + material;
        if (!batches.has(key)) batches.set(key, { geometry: geometries.get(geometry), material: materials[material], matrices: [] });
        const bucket = batches.get(key);
        const p = world(u, y, v);
        transform.position.set(p.x, p.y, p.z);
        localRotation.setFromEuler(euler.set(rx || 0, ry || 0, rz || 0));
        transform.quaternion.copy(yawRotation).multiply(localRotation);
        transform.scale.set(sx, sy, sz); transform.updateMatrix();
        const index = bucket.matrices.length;
        bucket.matrices.push(transform.matrix.clone());
        return { batchKey: key, index };
      }
      function box(material, u, y, v, sx, sy, sz, rz) { return part('box', material, u, y, v, sx, sy, sz, 0, 0, rz); }
      function cylinder(material, u, y, v, radius, axialLength, axis, geometry) {
        return part(geometry || 'cylinder', material, u, y, v, radius, axialLength, radius,
          axis === 'z' ? Math.PI / 2 : 0, 0, axis === 'x' ? Math.PI / 2 : 0);
      }

      const plate = Math.max(0.012, Math.min(0.027, width * 0.04));
      const rollerRadius = Math.max(0.014, Math.min(0.049, width * 0.06, length * 0.095));
      const rollerLength = Math.max(width * 0.42, width - 2 * (plate + Math.min(0.043, width * 0.075)));
      const endMargin = Math.min(0.065, length * 0.12);
      const available = length - endMargin * 2;
      const targetPitch = Math.max(rollerRadius * 2.7, Math.min(0.12, width * 0.18));
      const rollerCount = Math.max(2, Math.floor(available / targetPitch));
      const pitch = available / rollerCount;
      const rollerY = surfaceHeight - rollerRadius;
      const sideV = width / 2 - plate / 2;
      const frameHeight = Math.min(0.13, width * 0.24);
      const frameY = surfaceHeight - frameHeight * 0.62;
      const chainV = width / 2 - plate - Math.min(0.019, width * 0.035);
      const linkThickness = Math.min(0.013, width * 0.019);
      segment.rollerRadius = rollerRadius; segment.rollerLength = rollerLength;
      segment.rollerCount = rollerCount; segment.rollerPitch = pitch;

      [-1, 1].forEach(side => {
        box('zinc', 0, frameY, side * sideV, length, frameHeight, plate);
        // Folded top and bottom flanges retain an open underside and roller bed.
        box('steel', 0, surfaceHeight - 0.034, side * (width / 2 - plate), length, 0.012, plate * 1.8);
        box('zinc', 0, frameY - frameHeight / 2 + 0.005, side * (width / 2 - plate * 1.7), length, 0.015, plate * 2.9);
        box('rubber', 0, frameY - 0.015, side * (width / 2 - plate * 1.25), Math.max(0.02, length - 0.04), 0.014, 0.012);
      });

      for (let i = 0; i < rollerCount; i++) {
        const u = -available / 2 + pitch * (i + 0.5);
        cylinder('roller', u, rollerY, 0, rollerRadius, rollerLength, 'z');
        segment.rollerCentres.push(world(u, rollerY, 0));
        [-1, 1].forEach(side => {
          const shaftLength = Math.min(0.04, width * 0.065);
          cylinder('steel', u, rollerY, side * (rollerLength / 2 + shaftLength / 2), rollerRadius * 0.33, shaftLength, 'z', 'pin');
          cylinder('dark', u, rollerY, side * (width / 2 - plate - 0.011), rollerRadius * 0.53, 0.023, 'z', 'pin');
          // Exposed dual chain side plates and a bright rivet at every roller.
          [-1, 1].forEach(row => {
            box('chain', u, rollerY + 0.001, side * chainV + row * linkThickness * 0.7,
              Math.min(rollerRadius * 1.1, pitch * 0.5), linkThickness * 1.3, linkThickness * 0.45);
            if (i < rollerCount - 1) box('chain', u + pitch / 2, rollerY + 0.001,
              side * chainV + row * linkThickness * 0.7, pitch * 0.87, linkThickness * 0.72, linkThickness * 0.42);
          });
          cylinder('steel', u, rollerY + 0.001, side * chainV, linkThickness * 0.64, linkThickness * 2.8, 'z', 'pin');
          if (i === 0 || i === rollerCount - 1)
            part('sprocket', 'steel', u, rollerY, side * chainV, rollerRadius * 0.76, rollerRadius * 0.76, 0.016);
          // Shaft retaining screws remain inside the documented segment footprint.
          cylinder('steel', u, rollerY, side * (width / 2 - 0.007), rollerRadius * 0.22, 0.01, 'z', 'hex');
        });
      }

      const supportCount = Math.max(2, Math.ceil(length / 1.8) + 1);
      const legMargin = Math.min(0.18, length * 0.19);
      const legGauge = Math.max(0.014, Math.min(0.042, width * 0.065));
      const legV = width / 2 - Math.max(legGauge * 1.5, width * 0.095);
      const legBottom = 0.085;
      const legTop = Math.max(legBottom + 0.05, frameY - frameHeight * 0.15);
      const legHeight = legTop - legBottom;
      for (let i = 0; i < supportCount; i++) {
        const u = supportCount === 1 ? 0 : -length / 2 + legMargin + (length - legMargin * 2) * i / (supportCount - 1);
        segment.legStations.push(world(u, 0, 0));
        [-1, 1].forEach(side => {
          const v = side * legV;
          // Paired angle-profile uprights, foot plates and threaded adjusters.
          segment.legInstances.push(box('zinc', u, (legTop + legBottom) / 2, v,
            legGauge, legHeight, legGauge * 0.55));
          box('zinc', u + legGauge * 0.34, (legTop + legBottom) / 2, v,
            legGauge * 0.32, legHeight, legGauge * 1.25);
          segment.adjusterInstances.push(cylinder('steel', u, 0.06, v, legGauge * 0.22, 0.075, 'y', 'pin'));
          segment.footInstances.push(box('dark', u, 0.012, v,
            Math.min(0.105, length * 0.16), 0.024, Math.min(0.105, width * 0.24)));
          cylinder('steel', u, 0.042, v, legGauge * 0.4, 0.016, 'y', 'hex');
          cylinder('steel', u, legTop - 0.025, v + side * legGauge * 0.36,
            legGauge * 0.21, legGauge * 0.85, 'z', 'hex');
        });
        // The underside stays open: just transverse steel ties between supports.
        box('zinc', u, frameY - frameHeight * 0.53, 0, Math.max(0.027, legGauge), 0.035, Math.max(0.03, width - plate * 2));
        box('zinc', u, surfaceHeight * 0.32, 0, 0.028, 0.027, Math.max(0.03, legV * 2));
      }
      [-1, 1].forEach(end => {
        const u = end * (length / 2 - plate * 0.7);
        box('zinc', u, frameY - 0.012, 0, plate * 1.4, frameHeight * 0.78, Math.max(0.03, width - plate * 2));
        [-1, 1].forEach(side => cylinder('steel', u - end * plate,
          frameY, side * (width / 2 - plate * 2.3), 0.012, 0.012, 'x', 'hex'));
      });

      if (details) {
        const motorU = -length * 0.16;
        const motorV = width * 0.23;
        const motorR = Math.min(0.075, width * 0.115, length * 0.14);
        const motorDepth = Math.min(0.22, width * 0.32);
        const motorY = Math.max(0.18, surfaceHeight - 0.255);
        box('zinc', motorU, motorY - motorR - 0.02, motorV, motorR * 2.6, 0.025, motorDepth * 1.25);
        cylinder('dark', motorU, motorY, motorV, motorR, motorDepth, 'z');
        for (let i = 0; i < 7; i++) cylinder('steel', motorU, motorY,
          motorV - motorDepth * 0.4 + i * motorDepth * 0.8 / 6, motorR * 1.06, 0.008, 'z');
        box('dark', motorU, motorY, motorV - motorDepth * 0.55,
          motorR * 2.25, motorR * 2.1, motorDepth * 0.38);
        cylinder('steel', motorU, motorY, motorV - motorDepth * 0.78, motorR * 0.6, 0.03, 'z', 'pin');
        box('dark', motorU, motorY + motorR + 0.02, motorV,
          motorR * 1.1, 0.035, motorDepth * 0.55);
        // A compact safety-orange chain-drive cover leaves the remaining drive
        // chain exposed, matching the reference rather than a solid orange bed.
        box('orange', motorU, surfaceHeight - 0.074, width / 2 - plate * 1.8,
          Math.min(0.32, length * 0.27), 0.12, plate * 3.2);
        box('steel', motorU, surfaceHeight - 0.074, width / 2 - plate * 3.5,
          Math.min(0.26, length * 0.23), 0.08, 0.009);
        [-1, 1].forEach(side => {
          const sensorU = side * (length / 2 - Math.min(0.16, length * 0.18));
          const sensorV = -(width / 2 - plate * 1.8);
          box('dark', sensorU, surfaceHeight + 0.014, sensorV, Math.min(0.045, length * 0.14), 0.065, Math.min(0.032, width * 0.09));
          box('orange', sensorU - side * 0.006, surfaceHeight + 0.021,
            sensorV + 0.017, 0.016, 0.015, 0.006);
          box('zinc', sensorU, surfaceHeight - 0.029, sensorV, Math.min(0.065, length * 0.18), 0.018, Math.min(0.054, width * 0.13));
        });
        // Parked below the roller tangent: no unverified stop/lift animation.
        box('steel', length * 0.29, surfaceHeight - 0.07, 0, Math.min(0.035, length * 0.14), 0.055, rollerLength * 0.46);
        cylinder('dark', length * 0.29, surfaceHeight - 0.13, 0, 0.026, rollerLength * 0.5, 'z', 'pin');
      }

      if (d.kind === 'junction' && rollerCount >= 4) {
        const gap = pitch - rollerRadius * 2;
        const railWidth = Math.max(0.006, Math.min(0.027, gap * 0.65));
        [Math.floor(rollerCount * 0.28), Math.floor(rollerCount * 0.68)].forEach(index => {
          const u = -available / 2 + pitch * (index + 1);
          box('dark', u, surfaceHeight - 0.071, 0, railWidth, 0.07, rollerLength * 0.96);
          const transferLinks = Math.max(3, Math.floor(rollerLength / 0.07));
          for (let i = 0; i < transferLinks; i++) box('chain', u,
            surfaceHeight - 0.028, -rollerLength * 0.43 + i * rollerLength * 0.86 / (transferLinks - 1),
            railWidth * 0.75, 0.015, rollerLength * 0.7 / transferLinks);
        });
        segment.transferState = 'static-retracted';
      }

      for (const [key, bucket] of batches) {
        const start = starts.get(key) || 0;
        if (bucket.matrices.length > start) segment.ranges.push({ batchKey: key, start, count: bucket.matrices.length - start });
      }
      const selection = new T.LineSegments(outlineGeometry, outlineMaterial);
      selection.name = segment.selectionName;
      selection.position.set(x, surfaceHeight - 0.045, z);
      selection.scale.set(w + 0.018, 0.27, depth + 0.018);
      selection.renderOrder = 5; selection.visible = false;
      selection.userData.noShadow = true; selection.userData.conveyorId = id; group.add(selection);
      let selected = false, alarm = false;
      Object.defineProperties(segment, {
        selected: { enumerable: true, get: () => selected },
        alarm: { enumerable: true, get: () => alarm }
      });
      function refreshOutline() {
        selection.material = alarm ? alarmOutlineMaterial : outlineMaterial;
        selection.visible = selected || alarm;
      }
      metadata.segmentCount++; metadata.rollerCount += rollerCount; metadata.segments.push(segment);
      return { metadata: segment, selection,
        setSelected(value) { selected = Boolean(value); refreshOutline(); },
        setAlarm(value) { alarm = Boolean(value); refreshOutline(); } };
    }

    function finish() {
      if (finished) return metadata;
      finished = true;
      // 微件批次（轴销、轴承、链节、链轮）只在近距离开得出来：
      // 总览视角它们是亚像素，却占了一大半三角形。打上 detailTier 标记，
      // 由主循环按相机到楼层的距离整体显隐。
      const isMicro = key => /^(pin|hex|sprocket)\//.test(key) || key === 'box/chain';
      for (const [key, bucket] of batches) {
        if (!bucket.matrices.length) continue;
        const mesh = new T.InstancedMesh(bucket.geometry, bucket.material, bucket.matrices.length);
        mesh.name = 'conveyor-batch-' + key; mesh.userData.batchKey = key;
        mesh.userData.detailTier = isMicro(key) ? 'micro' : 'major';
        bucket.matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        group.add(mesh);
        metadata.batches.push({ key, count: bucket.matrices.length });
        metadata.instanceCount += bucket.matrices.length;
        if (key === 'cylinder/roller') {
          rollerMesh = mesh;
          // Roller transforms are the only ones rewritten at runtime, so their
          // build-time matrices are retained per segment for spin recomposition.
          metadata.segments.forEach(segment => {
            const range = segment.ranges.find(item => item.batchKey === 'cylinder/roller');
            if (!range || !range.count) return;
            segment.rollerBase = bucket.matrices.slice(range.start, range.start + range.count)
              .map(matrix => matrix.clone());
            segment.rollerStart = range.start;
            segment.spin = 0;
            segment.running = false;
          });
        }
        // Matrix4 objects are build-time only; the GPU instance buffer owns the
        // final transforms. Metadata retains ranges, not duplicated matrices.
        bucket.matrices.length = 0;
      }
      metadata.batchCount = metadata.batches.length; metadata.finished = true;
      return metadata;
    }

    /* Surface motion is per segment: an empty conveyor must not run. Only the
     * segments that actually hold a load are advanced, so the animation follows
     * the material flow instead of implying that the whole plant is moving.
     * A 40 mm roller at 0.9 m/s turns about 3.6 rev/s. */
    const motion = { running: false, speed: 0.9, rollerRadius: 0.04, activeSegments: 0,
      revolutions: 0 };
    const spinMatrix = new T.Matrix4(), spun = new T.Matrix4();
    function writeSpin(segment) {
      if (!rollerMesh || !segment.rollerBase) return;
      spinMatrix.makeRotationY(segment.spin);
      for (let index = 0; index < segment.rollerBase.length; index++) {
        spun.copy(segment.rollerBase[index]).multiply(spinMatrix);
        rollerMesh.setMatrixAt(segment.rollerStart + index, spun);
      }
    }
    /* runningIds: Set of segment ids that carry a load. Omitted means every
     * segment runs, which is only used by tests and the idle preview. */
    function updateMotion(dt, speed, runningIds) {
      const step = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.12)) : 0;
      if (Number.isFinite(speed) && speed > 0) motion.speed = speed;
      if (step <= 0) { motion.running = false; motion.activeSegments = 0; return; }
      const omega = step * motion.speed / motion.rollerRadius;
      let active = 0;
      for (const segment of metadata.segments) {
        const loaded = runningIds ? runningIds.has(segment.id) : true;
        segment.running = Boolean(loaded);
        if (!loaded || !segment.rollerBase) continue;
        segment.spin = (segment.spin + omega) % (Math.PI * 2);
        writeSpin(segment);
        active++;
      }
      if (active && rollerMesh) rollerMesh.instanceMatrix.needsUpdate = true;
      motion.revolutions += omega;
      motion.activeSegments = active;
      motion.running = active > 0;
    }
    metadata.motion = motion;

    function dispose() {
      geometries.forEach(geometry => geometry.dispose());
      Object.values(materials).forEach(material => material.dispose());
      zincMap.dispose(); rollerMap.dispose(); rollerRoughness.dispose(); chainMap.dispose(); outlineGeometry.dispose(); outlineMaterial.dispose(); alarmOutlineMaterial.dispose();
    }

    return { group, addSegment, finish, updateMotion, metadata, dispose };
  }

  window.WcsConveyorModel = Object.freeze({ createSystem });
})();
