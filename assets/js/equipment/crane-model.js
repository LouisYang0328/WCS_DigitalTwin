/* Industrial double-mast stacker crane. Dimensions use the scene's metre unit.
 * No renderer or application state is owned here: mast.x is travel, carriage.y
 * is lift, and the caller places group.z on the aisle centreline.
 */
(function () {
  'use strict';

  const TAU = Math.PI * 2;

  function create(options) {
    const T = window.THREE;
    if (!T) throw new Error('WcsCraneModel requires THREE.');
    const opts = options || {};
    const height = Number(opts.height || 20);
    const length = Number(opts.length || 40);
    const aisleWidth = Number(opts.aisleWidth || 1.9);
    if (!Number.isFinite(height) || height < 4 || !Number.isFinite(length) || length < 4 || aisleWidth < 1.7)
      throw new Error('Invalid stacker crane dimensions.');

    // Keep every retracted mechanism inside ±0.82 m, leaving a gap to racks.
    const halfWidth = Math.min(0.82, aisleWidth / 2 - 0.1);
    const palette = {
      yellow: new T.MeshStandardMaterial({ color: 0xe7ad20, roughness: 0.48, metalness: 0.48 }),
      orange: new T.MeshStandardMaterial({ color: 0xe66d1e, roughness: 0.5, metalness: 0.4 }),
      steel: new T.MeshStandardMaterial({ color: 0xa2abb1, roughness: 0.34, metalness: 0.74 }),
      brushed: new T.MeshStandardMaterial({ color: 0x65747a, roughness: 0.42, metalness: 0.76 }),
      graphite: new T.MeshStandardMaterial({ color: 0x303b40, roughness: 0.55, metalness: 0.58 }),
      rubber: new T.MeshStandardMaterial({ color: 0x202629, roughness: 0.88, metalness: 0.06 }),
      cabinet: new T.MeshStandardMaterial({ color: 0xc6ccc9, roughness: 0.62, metalness: 0.28 }),
      cream: new T.MeshStandardMaterial({ color: 0xeee8ce, roughness: 0.8, metalness: 0.04 }),
      wood: new T.MeshStandardMaterial({ color: 0xb8894d, roughness: 0.91, metalness: 0 }),
      carton: new T.MeshStandardMaterial({ color: 0xc9aa76, roughness: 0.92, metalness: 0 }),
      blue: new T.MeshStandardMaterial({ color: 0x3a6780, roughness: 0.7, metalness: 0.1 })
    };
    const group = new T.Group(); group.name = (opts.code || 'TC') + '-stacker-crane';
    const mast = new T.Group(); mast.name = 'travelling-double-mast'; group.add(mast);
    const bodyMat = palette.yellow;
    const ownedGeometries = new Set();
    const sectionParts = [];
    const repeatedParts = [];
    const uprightParts = [];
    const unitBox = new T.BoxGeometry(1, 1, 1); ownedGeometries.add(unitBox);
    const dummy = new T.Object3D();
    const axisY = new T.Vector3(0, 1, 0);

    // Each static assembly is merged by material: fasteners and guards do not
    // each add a draw call. Assemblies remain separate for floor section views.
    function batch(parent, name) {
      const batches = new Map();
      function add(geometry, material, x, y, z, rotation) {
        const transform = new T.Object3D();
        transform.position.set(x || 0, y || 0, z || 0);
        if (rotation) transform.rotation.set(rotation[0], rotation[1], rotation[2]);
        transform.updateMatrix();
        const plain = geometry.index ? geometry.toNonIndexed() : geometry.clone();
        plain.applyMatrix4(transform.matrix);
        geometry.dispose();
        if (!batches.has(material)) batches.set(material, []);
        batches.get(material).push(plain);
      }
      return {
        box(mat, w, h, d, x, y, z, rotation) { add(new T.BoxGeometry(w, h, d), mat, x, y, z, rotation); },
        cylinder(mat, radius, depth, x, y, z, axis, segments) {
          const rotation = axis === 'z' ? [Math.PI / 2, 0, 0] : axis === 'x' ? [0, 0, Math.PI / 2] : null;
          add(new T.CylinderGeometry(radius, radius, depth, segments || 12), mat, x, y, z, rotation);
        },
        diagonal(mat, start, end, thickness, depth) {
          const a = new T.Vector3(...start), b = new T.Vector3(...end);
          const middle = a.clone().add(b).multiplyScalar(0.5);
          const geometry = new T.BoxGeometry(thickness, a.distanceTo(b), depth);
          geometry.applyQuaternion(new T.Quaternion().setFromUnitVectors(axisY, b.sub(a).normalize()));
          add(geometry, mat, middle.x, middle.y, middle.z);
        },
        wedge(mat, points, depth, z) {
          const shape = new T.Shape();
          points.forEach((point, i) => i ? shape.lineTo(point[0], point[1]) : shape.moveTo(point[0], point[1]));
          shape.closePath();
          add(new T.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 }), mat, 0, 0, z);
        },
        finish() {
          const assembly = new T.Group(); assembly.name = name;
          for (const [material, geometries] of batches) {
            let count = 0;
            geometries.forEach(geometry => { count += geometry.attributes.position.count; });
            const positions = new Float32Array(count * 3);
            const normals = new Float32Array(count * 3);
            let offset = 0;
            geometries.forEach(geometry => {
              positions.set(geometry.attributes.position.array, offset);
              normals.set(geometry.attributes.normal.array, offset);
              offset += geometry.attributes.position.array.length;
              geometry.dispose();
            });
            const merged = new T.BufferGeometry();
            merged.setAttribute('position', new T.BufferAttribute(positions, 3));
            merged.setAttribute('normal', new T.BufferAttribute(normals, 3));
            merged.computeBoundingBox(); merged.computeBoundingSphere();
            ownedGeometries.add(merged);
            const mesh = new T.Mesh(merged, material);
            mesh.name = name + '-' + material.color.getHexString();
            mesh.castShadow = true; mesh.receiveShadow = true;
            assembly.add(mesh);
          }
          parent.add(assembly);
          return assembly;
        }
      };
    }

    function instances(parent, geometry, material, transforms, name) {
      ownedGeometries.add(geometry);
      const object = new T.InstancedMesh(geometry, material, transforms.length);
      object.name = name; object.castShadow = true; object.receiveShadow = true;
      transforms.forEach((transform, index) => {
        dummy.position.set(transform.x || 0, transform.y || 0, transform.z || 0);
        dummy.rotation.set(transform.rx || 0, transform.ry || 0, transform.rz || 0);
        dummy.scale.set(transform.sx || 1, transform.sy || 1, transform.sz || 1);
        dummy.updateMatrix(); object.setMatrixAt(index, dummy.matrix);
      });
      object.instanceMatrix.needsUpdate = true;
      // InstancedMesh bounds are cached by some Three.js releases. Geometry
      // is cheap here, so prevent stale bounds when the section range changes.
      object.frustumCulled = false;
      parent.add(object);
      return object;
    }

    function verticals(material, bars, name) {
      const mesh = instances(mast, unitBox, material, bars, name);
      uprightParts.push({ mesh, bars });
      return mesh;
    }

    const columnBottom = 0.59, columnTop = height + 0.19;
    const columns = [-0.12, 1.36];
    const body = verticals(bodyMat, columns.map(x => ({ x, z: 0, y0: columnBottom, y1: columnTop, width: 0.22, depth: 0.35 })), 'yellow-structural-uprights');
    body.userData.role = 'double-column-frame';

    // Polished carriage guides on the inward faces, plus dark lift chains.
    verticals(palette.steel, [
      { x: 0.009, z: -0.125, y0: 0.62, y1: height + 0.12, width: 0.035, depth: 0.07 },
      { x: 0.009, z: 0.125, y0: 0.62, y1: height + 0.12, width: 0.035, depth: 0.07 },
      { x: 1.231, z: -0.125, y0: 0.62, y1: height + 0.12, width: 0.035, depth: 0.07 },
      { x: 1.231, z: 0.125, y0: 0.62, y1: height + 0.12, width: 0.035, depth: 0.07 },
      { x: -0.32, z: -0.275, y0: 0.73, y1: height - 0.15, width: 0.026, depth: 0.026 },
      { x: -0.32, z: 0.275, y0: 0.73, y1: height - 0.15, width: 0.026, depth: 0.026 }
    ], 'machined-guide-faces-and-service-ladder-rails');
    verticals(palette.graphite, columns.map((x, i) => ({
      x: x + (i ? -0.075 : 0.075), z: -0.24, y0: 0.7, y1: height + 0.04, width: 0.068, depth: 0.034
    })), 'guided-lift-chain-backs');

    const ladderRungs = [], chainLinks = [], bolts = [];
    for (let y = 0.9; y < height - 0.2; y += 0.3) ladderRungs.push({ x: -0.32, y, z: 0 });
    for (let y = 0.8; y < height; y += 0.18) {
      columns.forEach((x, i) => chainLinks.push({ x: x + (i ? -0.075 : 0.075), y, z: -0.263 }));
    }
    for (let y = 0.78; y < height; y += 1.42) {
      columns.forEach(x => [-0.19, 0.19].forEach(z => bolts.push({ x, y, z, rx: Math.PI / 2 })));
    }
    repeatedParts.push({ mesh: instances(mast, new T.BoxGeometry(0.026, 0.026, 0.57), palette.brushed, ladderRungs, 'service-ladder-rungs'), transforms: ladderRungs });
    repeatedParts.push({ mesh: instances(mast, new T.BoxGeometry(0.045, 0.024, 0.016), palette.steel, chainLinks, 'individual-chain-links'), transforms: chainLinks });
    repeatedParts.push({ mesh: instances(mast, new T.CylinderGeometry(0.021, 0.021, 0.019, 6), palette.steel, bolts, 'mast-flange-fasteners'), transforms: bolts });

    // A single ground rail with a machined head and web; repeated fastenings
    // are all merged. The upper guide is not a second ground-level track.
    function makeRail(y, top) {
      const b = batch(group, top ? 'upper-guide-track' : 'ground-running-rail');
      // The mast origin precedes the platform centre by 0.62 m. Extend the
      // track past the final bay so both wheelsets keep contact at full travel.
      const railLength = length + 2.1, railCentre = length / 2 + 0.62;
      b.box(palette.brushed, railLength, top ? 0.09 : 0.075, 0.18, railCentre, y, 0);
      b.box(palette.steel, railLength, 0.045, top ? 0.12 : 0.095, railCentre, y + 0.06, 0);
      if (!top) {
        b.box(palette.brushed, railLength, 0.045, 0.27, railCentre, y - 0.055, 0);
        for (let x = 0; x <= length; x += 2) {
          b.box(palette.graphite, 0.28, 0.035, 0.5, x, 0.025, 0);
          [-0.19, 0.19].forEach(z => b.cylinder(palette.steel, 0.022, 0.025, x, 0.055, z, 'y', 6));
        }
      }
      return b.finish();
    }
    const rail = makeRail(0.095, false);
    const rail2 = makeRail(height + 0.38, true);
    sectionParts.push({ object: rail, minY: 0, maxY: 0.2, kind: 'ground' });
    sectionParts.push({ object: rail2, minY: height + 0.3, maxY: height + 0.5, kind: 'crown' });

    const baseBatch = batch(mast, 'travel-chassis-and-control-cabinet');
    baseBatch.box(bodyMat, 2.6, 0.24, 0.74, 0.62, 0.53, 0);
    baseBatch.box(palette.graphite, 2.38, 0.13, 0.63, 0.62, 0.365, 0);
    columns.forEach(x => {
      baseBatch.box(palette.brushed, 0.46, 0.075, 0.56, x, 0.69, 0);
      [-0.23, 0.23].forEach(z => baseBatch.wedge(bodyMat, [[x - 0.2, 0.69], [x + 0.2, 0.69], [x, 1.03]], 0.055, z));
      [-0.15, 0.15].forEach(dx => [-0.21, 0.21].forEach(z => baseBatch.cylinder(palette.steel, 0.026, 0.035, x + dx, 0.75, z, 'y', 6)));
    });
    [-0.68, 1.92].forEach((x, index) => {
      baseBatch.box(palette.rubber, 0.14, 0.23, 0.58, x, 0.49, 0);
      const direction = index ? -1 : 1;
      baseBatch.wedge(bodyMat, [[x, 0.63], [x + direction * 0.3, 0.63], [x + direction * 0.18, 0.84]], 0.56, -0.28);
    });

    // Gear motor, cooling fins, gearbox, brake and cable conduit.
    baseBatch.cylinder(palette.graphite, 0.155, 0.4, 1.3, 0.55, 0.51, 'z', 16);
    baseBatch.cylinder(palette.brushed, 0.2, 0.16, 1.3, 0.55, 0.27, 'z', 14);
    baseBatch.cylinder(palette.steel, 0.06, 0.17, 1.3, 0.55, 0.12, 'z', 12);
    for (let i = 0; i < 8; i++) {
      const angle = i * TAU / 8;
      baseBatch.box(palette.brushed, 0.025, 0.06, 0.3,
        1.3 + Math.cos(angle) * 0.155, 0.55 + Math.sin(angle) * 0.155, 0.51, [0, 0, angle - Math.PI / 2]);
    }
    baseBatch.box(palette.graphite, 0.23, 0.13, 0.19, 1.3, 0.76, 0.48);
    baseBatch.box(palette.brushed, 0.18, 0.06, 0.54, 1.3, 0.34, 0.4);
    baseBatch.diagonal(palette.rubber, [1.25, 0.8, 0.42], [0.96, 1.12, 0.29], 0.035, 0.035);

    // The cabinet is fixed to the chassis, so it disappears in the 2F section.
    baseBatch.box(palette.cabinet, 0.5, 1.04, 0.53, -0.39, 1.2, -0.45);
    baseBatch.box(palette.brushed, 0.52, 0.055, 0.56, -0.39, 1.745, -0.45);
    baseBatch.box(palette.graphite, 0.41, 0.86, 0.013, -0.39, 1.2, -0.724);
    baseBatch.box(palette.cabinet, 0.385, 0.835, 0.017, -0.39, 1.2, -0.735);
    baseBatch.box(palette.rubber, 0.025, 0.14, 0.027, -0.25, 1.2, -0.76);
    for (let i = 0; i < 7; i++) baseBatch.box(palette.graphite, 0.24, 0.012, 0.013, -0.42, 0.9 + i * 0.045, -0.751);
    baseBatch.box(palette.cream, 0.26, 0.12, 0.012, -0.42, 1.5, -0.752);
    [0, 1, 2].forEach(i => baseBatch.box(palette.graphite, 0.19 - i * 0.02, 0.008, 0.004, -0.42, 1.53 - i * 0.025, -0.76));
    baseBatch.box(palette.graphite, 0.24, 0.2, 0.045, -0.39, 1.43, -0.155);
    baseBatch.box(palette.blue, 0.16, 0.095, 0.012, -0.39, 1.455, -0.128);
    baseBatch.cylinder(palette.rubber, 0.028, 0.02, -0.43, 1.36, -0.124, 'z', 12);
    baseBatch.cylinder(palette.orange, 0.03, 0.025, -0.34, 1.36, -0.124, 'z', 12);

    // Diagonal hazard stripes are actual thin face geometry, without textures.
    [-0.39, 1.47].forEach(x => {
      baseBatch.box(bodyMat, 0.55, 0.16, 0.025, x, 0.54, 0.388);
      for (let i = 0; i < 4; i++) {
        const sx = x - 0.26 + i * 0.135;
        baseBatch.wedge(palette.rubber, [[sx, 0.46], [sx + 0.07, 0.46], [sx + 0.155, 0.62], [sx + 0.085, 0.62]], 0.009, 0.402);
      }
    });
    const cab = baseBatch.finish();
    sectionParts.push({ object: cab, minY: 0.24, maxY: 1.78, kind: 'ground' });

    // Rail wheels have fixed circular geometry. Only their spoke rotation moves.
    const wheelTransforms = [-0.29, 1.53].map(x => ({ x, y: 0.395, z: 0, rx: Math.PI / 2 }));
    const wheels = new T.Group(); wheels.name = 'running-wheelsets'; mast.add(wheels);
    instances(wheels, new T.CylinderGeometry(0.225, 0.225, 0.14, 24), palette.graphite, wheelTransforms, 'rail-wheel-treads');
    instances(wheels, new T.CylinderGeometry(0.169, 0.169, 0.152, 20), palette.steel, wheelTransforms, 'machined-wheel-discs');
    instances(wheels, new T.CylinderGeometry(0.067, 0.067, 0.19, 12), bodyMat, wheelTransforms, 'wheel-hubs');
    const spokeTransforms = [];
    [-0.29, 1.53].forEach(x => {
      for (let i = 0; i < 6; i++) spokeTransforms.push({ x, y: 0.395, z: 0.082, rz: i * TAU / 6 });
    });
    const spokeMesh = instances(wheels, new T.BoxGeometry(0.23, 0.018, 0.008), palette.graphite, spokeTransforms, 'wheel-disc-slots');
    sectionParts.push({ object: wheels, minY: 0.17, maxY: 0.63, kind: 'ground' });

    const crownBatch = batch(mast, 'upper-crosshead-guide-bogie');
    crownBatch.box(bodyMat, 1.93, 0.26, 0.48, 0.62, height + 0.19, 0);
    crownBatch.box(palette.brushed, 2.02, 0.06, 0.56, 0.62, height + 0.03, 0);
    crownBatch.box(bodyMat, 0.52, 0.12, 0.62, 0.62, height + 0.39, 0);
    columns.forEach(x => {
      [-0.23, 0.23].forEach(z => crownBatch.wedge(bodyMat, [[x - 0.13, height - 0.2], [x + 0.13, height + 0.07], [x - 0.13, height + 0.07]], 0.04, z));
      [-0.18, 0.18].forEach(z => crownBatch.cylinder(palette.steel, 0.027, 0.025, x, height + 0.343, z, 'y', 6));
    });
    [-0.12, 1.36].forEach(x => [-0.18, 0.18].forEach(z => {
      crownBatch.cylinder(palette.graphite, 0.082, 0.1, x, height + 0.4, z, 'y', 16);
      crownBatch.cylinder(palette.steel, 0.038, 0.112, x, height + 0.4, z, 'y', 12);
    }));
    [-0.15, 1.39].forEach(x => crownBatch.cylinder(palette.brushed, 0.12, 0.14, x, height + 0.02, -0.23, 'z', 18));
    const crown = crownBatch.finish();
    sectionParts.push({ object: crown, minY: height - 0.2, maxY: height + 0.51, kind: 'crown' });

    // Open orange load-platform guards leave the paired telescopic fork visible.
    const carriage = new T.Group(); carriage.name = 'lift-carriage';
    carriage.position.set(0.62, 1.05, 0); mast.add(carriage);
    const platform = batch(carriage, 'load-platform-guards-and-forks');
    platform.box(palette.graphite, 1.07, 0.15, 1.11, 0, 0, 0);
    platform.box(palette.brushed, 1.12, 0.06, 1.17, 0, 0.105, 0);
    [-0.5, 0.5].forEach(x => {
      platform.box(palette.orange, 0.045, 0.64, 0.045, x, 0.46, -0.58);
      platform.box(palette.orange, 0.045, 0.64, 0.045, x, 0.46, 0.58);
      platform.box(palette.orange, 0.045, 0.045, 1.2, x, 0.78, 0);
      platform.box(palette.orange, 0.04, 0.04, 1.2, x, 0.43, 0);
      platform.box(palette.orange, 0.04, 0.15, 1.18, x, 0.19, 0);
    });
    [-0.29, 0.29].forEach(x => {
      platform.box(palette.graphite, 0.16, 0.14, 1.14, x, -0.095, 0);
      platform.box(palette.brushed, 0.13, 0.065, 1.36, x, -0.065, 0);
      platform.box(palette.steel, 0.105, 0.045, halfWidth * 2 - 0.1, x, -0.025, 0);
      [-1, 1].forEach(side => platform.wedge(palette.steel,
        [[x - 0.052, 0], [x + 0.052, 0], [x + 0.038, 0.03], [x - 0.038, 0.03]], 0.08, side * (halfWidth - 0.09) - 0.04));
      [-0.35, 0.35].forEach(z => platform.cylinder(palette.steel, 0.023, 0.02, x, 0.143, z, 'y', 6));
    });
    // Rolling shoes bear against the two polished mast guides.
    [-0.58, 0.58].forEach(x => {
      platform.box(palette.orange, 0.09, 0.58, 0.25, x, 0.2, 0);
      [-0.13, 0.48].forEach(y => [-0.12, 0.12].forEach(z => {
        platform.cylinder(palette.graphite, 0.068, 0.06, x, y, z, 'z', 12);
        platform.cylinder(palette.steel, 0.027, 0.067, x, y, z, 'z', 10);
      }));
    });
    platform.box(palette.graphite, 0.27, 0.22, 0.28, 0, -0.22, 0);
    platform.cylinder(palette.brushed, 0.075, 0.3, 0, -0.22, 0, 'x', 14);
    platform.box(palette.cream, 0.22, 0.095, 0.015, 0.5, 0.62, 0.03, [0, Math.PI / 2, 0]);
    const loadPlatform = platform.finish();
    loadPlatform.userData.role = 'dual-telescopic-fork';

    const cargo = batch(carriage, 'carried-pallet-and-carton');
    [-0.31, 0, 0.31].forEach(x => cargo.box(palette.wood, 0.1, 0.12, 0.86, x, 0.2, 0));
    for (let i = 0; i < 5; i++) cargo.box(palette.wood, 0.85, 0.055, 0.145, 0, 0.29, -0.34 + i * 0.17);
    cargo.box(palette.carton, 0.75, 0.49, 0.74, 0, 0.563, 0);
    cargo.box(palette.blue, 0.035, 0.5, 0.75, -0.22, 0.57, 0);
    cargo.box(palette.blue, 0.035, 0.5, 0.75, 0.22, 0.57, 0);
    cargo.box(palette.cream, 0.22, 0.14, 0.006, 0, 0.56, 0.374);
    const carried = cargo.finish(); carried.visible = false;

    // The return ropes change length, not the mast's geometry or wheel sizes.
    const ropeBars = [
      { x: 0.055, z: 0.24, width: 0.018, depth: 0.018 },
      { x: 1.185, z: 0.24, width: 0.018, depth: 0.018 }
    ];
    const ropes = instances(mast, unitBox, palette.brushed, ropeBars, 'tensioned-lift-return-ropes');

    const lampMat = new T.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e,
      emissiveIntensity: 0.6, roughness: 0.32, metalness: 0.15, toneMapped: false });
    const beacon = new T.Mesh(new T.CylinderGeometry(0.075, 0.075, 0.18, 16), lampMat);
    ownedGeometries.add(beacon.geometry); beacon.name = 'compact-status-beacon';
    beacon.position.set(1.36, height + 0.59, 0); mast.add(beacon);
    const lamp = new T.Mesh(new T.CylinderGeometry(0.085, 0.085, 0.055, 16), palette.graphite);
    ownedGeometries.add(lamp.geometry); lamp.name = 'beacon-mount';
    lamp.position.set(1.36, height + 0.47, 0); mast.add(lamp);

    const labelSprite = typeof opts.makeLabel === 'function'
      ? opts.makeLabel((opts.code || 'TC') + ' · 共用', { worldH: 0.72, color: '#263842', bg: 'rgba(255,255,255,0.95)' })
      : new T.Group();
    labelSprite.name = 'machine-identification'; labelSprite.position.set(0.62, height + 1, 0); mast.add(labelSprite);
    const hit = new T.Mesh(new T.BoxGeometry(2.72, height + 0.82, halfWidth * 2),
      new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));
    ownedGeometries.add(hit.geometry); hit.name = 'crane-pick-volume';
    hit.position.set(0.62, (height + 0.82) / 2, 0); hit.userData.noShadow = true; mast.add(hit);
    // 纯拾取体不参与渲染：材质 colorWrite=false，画出来也是空的。
    hit.visible = false;

    let section = { base: 0, height, two: true, mode: 3 };
    let sectionKey = '';
    let lastWheelX = NaN, lastRopeY = NaN;

    function transformVisibleInstance(mesh, index, transform, visible) {
      dummy.position.set(transform.x || 0, transform.y || 0, transform.z || 0);
      dummy.rotation.set(transform.rx || 0, transform.ry || 0, transform.rz || 0);
      dummy.scale.setScalar(visible ? 1 : 0);
      dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
    }

    function syncMotion(force) {
      const base = section.base, end = base + section.height;
      carriage.visible = section.two || (carriage.position.y >= base && carriage.position.y <= end);
      if (force || mast.position.x !== lastWheelX) {
        const angle = -mast.position.x / 0.225;
        spokeTransforms.forEach((transform, index) => transformVisibleInstance(spokeMesh, index,
          { ...transform, rz: transform.rz + angle }, true));
        spokeMesh.instanceMatrix.needsUpdate = true; lastWheelX = mast.position.x;
      }
      if (force || carriage.position.y !== lastRopeY) {
        const lower = Math.max(base, carriage.position.y + 0.58);
        const upper = Math.min(height + 0.015, end);
        ropes.visible = upper > lower;
        if (ropes.visible) {
          ropeBars.forEach((bar, index) => {
            dummy.position.set(bar.x, (upper + lower) / 2, bar.z);
            dummy.rotation.set(0, 0, 0); dummy.scale.set(bar.width, upper - lower, bar.depth);
            dummy.updateMatrix(); ropes.setMatrixAt(index, dummy.matrix);
          });
          ropes.instanceMatrix.needsUpdate = true;
        }
        lastRopeY = carriage.position.y;
      }
    }

    function setSection(next) {
      const config = next || {};
      const base = Number.isFinite(config.base) ? Math.max(0, config.base) : 0;
      const visibleHeight = Number.isFinite(config.height) ? Math.max(0.1, config.height) : height;
      const two = config.two !== undefined ? Boolean(config.two) : config.mode === 3;
      const end = Math.min(height, base + visibleHeight);
      const key = [base, end, two, config.mode].join('/');
      const changed = key !== sectionKey;
      section = { base, height: end - base, two, mode: config.mode };
      if (changed) {
        sectionKey = key;
        const includesCrown = end >= height - 0.001;
        const structuralEnd = end + (includesCrown ? 0.22 : 0);
        uprightParts.forEach(part => {
          part.bars.forEach((bar, index) => {
            const low = Math.max(base, bar.y0), high = Math.min(structuralEnd, bar.y1);
            dummy.position.set(bar.x, (low + high) / 2, bar.z);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.set(bar.width, Math.max(0, high - low), bar.depth);
            dummy.updateMatrix(); part.mesh.setMatrixAt(index, dummy.matrix);
          });
          part.mesh.instanceMatrix.needsUpdate = true;
        });
        repeatedParts.forEach(part => {
          part.transforms.forEach((transform, index) => transformVisibleInstance(part.mesh, index, transform,
            transform.y >= base + 0.025 && transform.y <= end - 0.025));
          part.mesh.instanceMatrix.needsUpdate = true;
        });
        sectionParts.forEach(part => {
          part.object.visible = part.kind === 'ground' ? base < 0.15 : includesCrown;
        });
        // The tiny status indicator and text follow the cut edge as annotations;
        // the real crown assembly and running gear retain their world geometry.
        const indicatorTop = end + (includesCrown ? 0.59 : 0.3);
        beacon.position.y = indicatorTop; lamp.position.y = indicatorTop - 0.12;
        labelSprite.position.y = end + (includesCrown ? 1 : 0.72);
        hit.scale.y = (section.height + 0.82) / (height + 0.82);
        hit.position.y = base + (section.height + 0.82) / 2;
      }
      syncMotion(changed);
    }

    function updateMotion(motion) {
      const next = motion || {};
      if (Number.isFinite(next.x)) mast.position.x = next.x;
      if (Number.isFinite(next.y)) carriage.position.y = next.y;
      syncMotion(false);
    }

    function dispose() {
      ownedGeometries.forEach(geometry => geometry.dispose());
      Object.values(palette).forEach(material => material.dispose());
      lampMat.dispose(); hit.material.dispose();
      labelSprite.traverse(object => {
        if (object.material) { object.material.map?.dispose(); object.material.dispose(); }
      });
    }

    setSection({ base: 0, height, two: true, mode: 3 });
    group.userData.model = 'industrial-double-mast-stacker';
    group.userData.clearance = { retractedHalfWidth: halfWidth, columnXs: columns, carriageCentreX: 0.62,
      nominalHeight: height, crownTop: height + 0.51, minimumAisleWidth: halfWidth * 2 + 0.2 };
    return { group, mast, body, cab, rail, rail2, lamp, carriage, carried, beacon, lampMat, bodyMat,
      hit, labelSprite, sectionParts, setSection, updateMotion, dispose };
  }

  window.WcsCraneModel = Object.freeze({ create });
})();
