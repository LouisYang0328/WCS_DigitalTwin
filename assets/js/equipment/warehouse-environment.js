(function (global) {
  'use strict';

  const THREE = global.THREE;
  if (!THREE) throw new Error('warehouse-environment.js requires THREE to be loaded first.');
  const UP = new THREE.Vector3(0, 1, 0);
  let sharedMaterials;

  function materials() {
    if (sharedMaterials) return sharedMaterials;
    const size = 64, data = new Uint8Array(size * size * 4);
    for (let index = 0; index < size * size; index++) {
      const noise = ((Math.imul(index + 37, 2654435761) >>> 15) & 15) - 7;
      const value = 245 + noise * 0.65;
      data[index * 4] = data[index * 4 + 1] = data[index * 4 + 2] = value;
      data[index * 4 + 3] = 255;
    }
    const wallMap = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    wallMap.wrapS = wallMap.wrapT = THREE.RepeatWrapping;
    wallMap.repeat.set(4, 8);
    wallMap.encoding = THREE.sRGBEncoding;
    // DataTexture 默认不生成 mipmap，远看会变成闪动的噪点/摩尔纹；
    // 墙板颗粒是最容易暴露这一点的表面，这里显式开启并加各向异性。
    wallMap.generateMipmaps = true;
    wallMap.minFilter = THREE.LinearMipmapLinearFilter;
    wallMap.anisotropy = 8;
    wallMap.needsUpdate = true;
    sharedMaterials = {
      wall: new THREE.MeshStandardMaterial({ color: 0xc9cecd, map: wallMap, roughness: 0.96, metalness: 0.02 }),
      plinth: new THREE.MeshStandardMaterial({ color: 0x9aa1a3, map: wallMap, roughness: 0.94, metalness: 0.01 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x8d989f, roughness: 0.52, metalness: 0.55 }),
      trim: new THREE.MeshStandardMaterial({ color: 0x99a2a5, roughness: 0.54, metalness: 0.44 }),
      glazing: new THREE.MeshStandardMaterial({ color: 0xb2c7cb, roughness: 0.48, metalness: 0.07,
        emissive: 0x354a4e, emissiveIntensity: 0.12 }),
      shutter: new THREE.MeshStandardMaterial({ color: 0x939da1, roughness: 0.56, metalness: 0.36 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x4e5a60, roughness: 0.70, metalness: 0.18 }),
      light: new THREE.MeshStandardMaterial({ color: 0xf2f1e6, roughness: 0.47, metalness: 0.02,
        emissive: 0xfff4db, emissiveIntensity: 3.4 }),
      yellow: new THREE.MeshStandardMaterial({ color: 0xe4b53b, roughness: 0.81, metalness: 0.03 }),
      red: new THREE.MeshStandardMaterial({ color: 0xaa3730, roughness: 0.70, metalness: 0.16 }),
      white: new THREE.MeshStandardMaterial({ color: 0xe6e7df, roughness: 0.84, metalness: 0.02 }),
      exitSign: new THREE.MeshStandardMaterial({ color: 0x0d3b26, roughness: 0.42, metalness: 0.05,
        emissive: 0x2fd07a, emissiveIntensity: 1.5 }),
      timber: new THREE.MeshStandardMaterial({ color: 0xb08a55, roughness: 0.88, metalness: 0.02 }),
      cardboard: new THREE.MeshStandardMaterial({ color: 0xb99b6d, roughness: 0.93, metalness: 0.01 })
    };
    return sharedMaterials;
  }

  function columnGeometry() {
    // A small open I profile reads as fabricated building steel in close views.
    const pieces = [
      new THREE.BoxGeometry(0.045, 1, 0.36),
      new THREE.BoxGeometry(0.36, 1, 0.035).translate(0, 0, -0.1625),
      new THREE.BoxGeometry(0.36, 1, 0.035).translate(0, 0, 0.1625)
    ].map(geometry => geometry.toNonIndexed());
    const merged = new THREE.BufferGeometry();
    for (const name of ['position', 'normal']) {
      const arrays = pieces.map(geometry => geometry.getAttribute(name).array);
      const values = new Float32Array(arrays.reduce((sum, array) => sum + array.length, 0));
      let cursor = 0;
      for (const array of arrays) { values.set(array, cursor); cursor += array.length; }
      merged.setAttribute(name, new THREE.BufferAttribute(values, 3));
    }
    pieces.forEach(geometry => geometry.dispose());
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  }

  function create(options) {
    const {
      length = 40, rackHeight = 20, aisles = 5, pitch = 6.5,
      frontX = -12, backX = 44, minZ = -30, maxZ = 19
    } = options || {};
    if (![length, rackHeight, pitch, frontX, backX, minZ, maxZ].every(Number.isFinite) ||
        length <= 0 || rackHeight < 2 || pitch <= 0 || !Number.isInteger(aisles) || aisles < 1 || aisles > 64 ||
        backX - frontX < 8 || maxZ - minZ < 8 || backX - frontX > 500 || maxZ - minZ > 500)
      throw new Error('Invalid warehouse environment dimensions.');
    const mat = materials();
    const group = new THREE.Group();
    group.name = 'IllustrativeWarehouseEnvironment';
    group.visible = true;
    group.userData.excludeFromFit = true;
    group.userData.isWarehouseEnvironment = true;
    const roof = new THREE.Group();
    roof.name = 'OpenWarehouseRoofStructure';
    const safety = new THREE.Group();
    safety.name = 'WarehousePerimeterSafetyDetails';
    group.add(roof, safety);
    const walls = {}, batches = [], counts = {};
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const postGeometry = columnGeometry();
    const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
    const eave = rackHeight + 3.2, ridge = eave + 2.4;
    const centreX = (frontX + backX) / 2, centreZ = (minZ + maxZ) / 2;
    const dummy = new THREE.Object3D(), axis = new THREE.Vector3(), rotation = new THREE.Quaternion();
    const metadata = {
      illustrative: true,
      surveyed: false,
      openRoof: true,
      transparentWindows: false,
      noInteriorFloor: true,
      noIntermediateFloor: true,
      excludeFromFit: true,
      visible: true,
      eaveHeight: eave,
      ridgeHeight: ridge,
      footprint: { frontX, backX, minZ, maxZ },
      components: counts,
      wallGroups: ['frontX', 'backX', 'minZ', 'maxZ'],
      cutawayWalls: ['frontX', 'maxZ'],
      factoryDoorCount: 3,
      ledStripCount: 0
    };

    function batch(parent, name, material, geometry, castsShadow) {
      const transforms = [];
      const item = {
        add(x, y, z, w, h, d, quaternion) {
          dummy.position.set(x, y, z);
          dummy.scale.set(w, h, d);
          if (quaternion) dummy.quaternion.copy(quaternion); else dummy.quaternion.identity();
          dummy.updateMatrix();
          transforms.push(dummy.matrix.clone());
        },
        finish() {
          if (!transforms.length) return;
          const mesh = new THREE.InstancedMesh(geometry || unit, material, transforms.length);
          mesh.name = name;
          transforms.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
          mesh.instanceMatrix.needsUpdate = true;
          mesh.castShadow = castsShadow === true;
          mesh.receiveShadow = true;
          mesh.frustumCulled = false;
          mesh.userData.excludeFromFit = true;
          mesh.userData.isWarehouseEnvironment = true;
          parent.add(mesh);
          counts[name] = transforms.length;
        }
      };
      batches.push(item);
      return item;
    }

    function rod(target, ax, ay, az, bx, by, bz, width, depth) {
      axis.set(bx - ax, by - ay, bz - az);
      const distance = axis.length();
      if (distance < 1e-8) return;
      rotation.setFromUnitVectors(UP, axis.divideScalar(distance));
      target.add((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2,
        width, distance, depth === undefined ? width : depth, rotation);
    }

    function wall(name, alongX, coordinate, start, end, inward, doorCentres) {
      const part = new THREE.Group();
      part.name = 'WarehouseWall_' + name;
      part.userData.excludeFromFit = true;
      group.add(part);
      walls[name] = part;
      const cladding = batch(part, name + '_Cladding', mat.wall);
      const plinth = batch(part, name + '_ConcretePlinth', mat.plinth);
      const trim = batch(part, name + '_PanelJointsAndGirts', mat.trim);
      const windows = batch(part, name + '_OpaqueHighWindows', mat.glazing);
      const steel = batch(part, name + '_BuildingColumns', mat.steel, postGeometry, true);
      const framing = batch(part, name + '_WindowAndDoorFrames', mat.steel);
      const shutters = batch(part, name + '_IndustrialShutters', mat.shutter);
      const dark = batch(part, name + '_DoorRibsAndHandles', mat.dark);
      const width = end - start, bays = Math.max(1, Math.ceil(width / 8));
      const doorWidth = Math.min(4.4, width / 9), doorHeight = Math.min(4.5, eave * 0.52);
      const windowBottom = Math.max(doorHeight + 0.65, eave - 5.6);
      const windowHeight = Math.min(3.3, eave - windowBottom - 0.75), windowTop = windowBottom + windowHeight;
      const doors = (doorCentres || []).map(centre => ({ min: centre - doorWidth / 2, max: centre + doorWidth / 2, centre }));

      function put(target, u, y, inset, w, h, d) {
        if (alongX) target.add(u, y, coordinate + inward * inset, w, h, d);
        else target.add(coordinate + inward * inset, y, u, d, h, w);
      }

      const breaks = new Set([start, end]);
      for (let bay = 1; bay < bays; bay++) breaks.add(start + width * bay / bays);
      doors.forEach(door => { breaks.add(door.min); breaks.add(door.max); });
      const cuts = Array.from(breaks).sort((a, b) => a - b);
      for (let index = 0; index < cuts.length - 1; index++) {
        const lo = cuts[index], hi = cuts[index + 1], middle = (lo + hi) / 2;
        const opening = doors.some(door => middle > door.min && middle < door.max);
        if (!opening) {
          put(plinth, middle, 0.625, 0, hi - lo, 1.25, 0.22);
          put(cladding, middle, (windowBottom + 1.25) / 2, 0,
            hi - lo, windowBottom - 1.25, 0.16);
        } else {
          put(cladding, middle, (windowBottom + doorHeight) / 2, 0,
            hi - lo, windowBottom - doorHeight, 0.16);
        }
        put(cladding, middle, (eave + windowTop) / 2, 0,
          hi - lo, eave - windowTop, 0.16);
      }

      for (let bay = 0; bay < bays; bay++) {
        const lo = start + width * bay / bays, hi = start + width * (bay + 1) / bays;
        put(windows, (lo + hi) / 2, windowBottom + windowHeight / 2, 0,
          hi - lo - 0.17, windowHeight, 0.075);
        for (const y of [windowBottom, windowBottom + windowHeight / 2, windowTop])
          put(framing, (lo + hi) / 2, y, 0.018, hi - lo, 0.075, 0.12);
        for (let mullion = 1; mullion < 4; mullion++)
          put(framing, lo + (hi - lo) * mullion / 4, windowBottom + windowHeight / 2,
            0.022, 0.055, windowHeight, 0.11);
      }

      for (let column = 0; column <= bays; column++) {
        const u = start + width * column / bays;
        if (alongX) steel.add(u, eave / 2, coordinate + inward * 0.12, 1, eave, 1);
        else steel.add(coordinate + inward * 0.12, eave / 2, u, 1, eave, 1);
        put(framing, u, 0.055, 0.12, 0.60, 0.11, 0.60);
      }
      // Narrow ribs and panel joints break up the large wall surfaces without
      // transparency, normal maps or thousands of separate scene objects.
      for (let u = start + 1.3; u < end - 0.25; u += 2.6) {
        const ribStart = Math.min(4.65, windowBottom - 0.4);
        put(trim, u, (windowBottom + ribStart) / 2, 0.095, 0.018, windowBottom - ribStart, 0.026);
        put(trim, u, (eave + windowTop) / 2, 0.095, 0.018, eave - windowTop, 0.026);
      }
      for (const y of [1.28, 4.6, windowBottom - 0.08, eave - 0.10])
        put(trim, (start + end) / 2, y, 0.12, width, 0.065, 0.045);

      for (const door of doors) {
        put(shutters, door.centre, doorHeight / 2, 0.032, doorWidth - 0.06, doorHeight, 0.075);
        for (const edge of [door.min, door.max])
          put(framing, edge, (doorHeight + 0.12) / 2, 0.11, 0.17, doorHeight + 0.12, 0.23);
        put(framing, door.centre, doorHeight + 0.20, 0.17, doorWidth + 0.4, 0.32, 0.4);
        for (let y = 0.18; y < doorHeight; y += 0.18)
          put(dark, door.centre, y, 0.080, doorWidth - 0.10, 0.018, 0.015);
        put(dark, door.centre + doorWidth * 0.28, 1.0, 0.11, 0.28, 0.045, 0.055);
        for (const offset of [-1, 0, 1])
          put(windows, door.centre + offset * doorWidth * 0.24, 2.7, 0.095, doorWidth * 0.17, 0.38, 0.02);
      }
      return part;
    }

    const spanX = backX - frontX, spanZ = maxZ - minZ;
    const doorHalfWidth = Math.min(4.4, spanX / 9) / 2;
    const doorCentres = [0.18, 0.50, 0.82].map(fraction => frontX + spanX * fraction);
    wall('minZ', true, minZ, frontX, backX, 1, doorCentres);
    wall('maxZ', true, maxZ, frontX, backX, -1);
    wall('frontX', false, frontX, minZ, maxZ, 1);
    wall('backX', false, backX, minZ, maxZ, -1);

    const truss = batch(roof, 'RoofPortalTrussSteel', mat.steel, unit, false);
    const purlins = batch(roof, 'RoofPurlinsAndSkylightFrames', mat.trim, unit, false);
    const cables = batch(roof, 'LEDLightSuspensionCables', mat.dark, unit, false);
    const housings = batch(roof, 'SuspendedLEDMetalHousings', mat.trim, unit, false);
    const diffusers = batch(roof, 'SuspendedLEDLightDiffusers', mat.light, unit, false);
    const frameCount = Math.max(2, Math.ceil(spanX / 8));
    const halfSpan = spanZ / 2;
    const roofY = z => eave + (1 - Math.abs(z - centreZ) / halfSpan) * (ridge - eave);
    for (let frame = 0; frame <= frameCount; frame++) {
      const x = frontX + spanX * frame / frameCount;
      for (const edge of [minZ, maxZ]) {
        rod(truss, x, eave, edge, x, ridge, centreZ, 0.18, 0.14);
        rod(truss, x, eave - 0.65, edge, x, ridge - 0.65, centreZ, 0.12, 0.10);
        const divisions = Math.max(3, Math.ceil(halfSpan / 3.5));
        for (let index = 0; index < divisions; index++) {
          const z0 = edge + (centreZ - edge) * index / divisions;
          const z1 = edge + (centreZ - edge) * (index + 1) / divisions;
          if (index % 2 === 0) rod(truss, x, roofY(z0), z0, x, roofY(z1) - 0.65, z1, 0.060);
          else rod(truss, x, roofY(z0) - 0.65, z0, x, roofY(z1), z1, 0.060);
          rod(truss, x, roofY(z0), z0, x, roofY(z0) - 0.65, z0, 0.055);
        }
      }
    }
    for (let index = 0; index <= 8; index++) {
      const z = minZ + spanZ * index / 8;
      rod(purlins, frontX, roofY(z) + 0.03, z, backX, roofY(z) + 0.03, z, 0.070, 0.10);
    }
    // Clear skylight openings: only frames are modelled, leaving an open roof
    // for inspection instead of putting opaque roof panels over the rack tops.
    for (let frame = 0; frame < frameCount; frame++) {
      const x0 = frontX + spanX * frame / frameCount + 0.55;
      const x1 = frontX + spanX * (frame + 1) / frameCount - 0.55;
      for (const side of [-1, 1]) {
        const z0 = centreZ + side * halfSpan * 0.27, z1 = centreZ + side * halfSpan * 0.40;
        for (const x of [x0, x1]) rod(purlins, x, roofY(z0) + 0.07, z0, x, roofY(z1) + 0.07, z1, 0.065);
        for (const z of [z0, z1]) rod(purlins, x0, roofY(z) + 0.07, z, x1, roofY(z) + 0.07, z, 0.065);
      }
    }

    const lampY = rackHeight + 1.65;
    const lampCount = Math.max(1, Math.floor(length / 8));
    const lampPoints = [], aisleCentres = [];
    for (let aisle = 0; aisle < aisles; aisle++) {
      const z = (aisle - (aisles - 1) / 2) * pitch;
      if (z < minZ + 1 || z > maxZ - 1) continue;
      let lit = false;
      for (let lamp = 0; lamp < lampCount; lamp++) {
        const x = (lamp + 0.5) * length / lampCount;
        if (x < frontX + 1 || x > backX - 1) continue;
        const lampLength = Math.min(3.3, length / lampCount * 0.55);
        housings.add(x, lampY, z, lampLength, 0.085, 0.14);
        diffusers.add(x, lampY - 0.05, z, lampLength - 0.08, 0.025, 0.105);
        for (const dx of [-lampLength * 0.36, lampLength * 0.36])
          rod(cables, x + dx, lampY + 0.04, z, x + dx, roofY(z) - 0.72, z, 0.009);
        lampPoints.push({ x, z, length: lampLength });
        lit = true;
        metadata.ledStripCount++;
      }
      if (lit) aisleCentres.push(z);
    }

    /* ---------- 车间照明效果：灯管辉光、巷道光带、地面光斑、悬浮粉尘 ---------- */
    const fx = (options && options.fx) || null;
    const atmosphere = new THREE.Group();
    atmosphere.name = 'WorkshopAtmosphere';
    atmosphere.userData.excludeFromFit = true;
    atmosphere.userData.isWarehouseEnvironment = true;
    group.add(atmosphere);
    let dustPoints = null, dustBase = null, bayLamps = [];
    const flatQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

    if (fx && lampPoints.length) {
      // High-bay rows over every open floor strip: front conveyor line and the
      // back margin share the same fixtures as the aisles, so the whole hall
      // reads as one evenly lit workshop instead of a spotlit conveyor.
      for (const x of [frontX + 3.4, frontX + 9.8, backX - 2.6]) {
        for (let z = minZ + 5.5; z <= maxZ - 5.5; z += 7.4) bayLamps.push({ x, z });
      }
      bayLamps.forEach(lamp => {
        housings.add(lamp.x, lampY, lamp.z, 3.1, 0.085, 0.14);
        diffusers.add(lamp.x, lampY - 0.05, lamp.z, 3.0, 0.025, 0.105);
        for (const dx of [-1.1, 1.1])
          rod(cables, lamp.x + dx, lampY + 0.04, lamp.z, lamp.x + dx, roofY(lamp.z) - 0.72, lamp.z, 0.009);
        metadata.ledStripCount++;
      });
      metadata.bayLampCount = bayLamps.length;

      // A single additive point cloud draws every tube halo in one call.
      const allLamps = lampPoints.map(lamp => ({ x: lamp.x, y: lampY - 0.06, z: lamp.z }))
        .concat(bayLamps.map(lamp => ({ x: lamp.x, y: lampY - 0.06, z: lamp.z })));
      const halos = new Float32Array(allLamps.length * 3);
      allLamps.forEach((lamp, index) => {
        halos[index * 3] = lamp.x;
        halos[index * 3 + 1] = lamp.y;
        halos[index * 3 + 2] = lamp.z;
      });
      const haloGeometry = new THREE.BufferGeometry();
      haloGeometry.setAttribute('position', new THREE.BufferAttribute(halos, 3));
      const haloPoints = new THREE.Points(haloGeometry, new THREE.PointsMaterial({
        map: fx.halo, color: 0xffe9c2, size: 2.9, sizeAttenuation: true,
        transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending
      }));
      haloPoints.name = 'LedTubeHalos';
      haloPoints.frustumCulled = false;
      haloPoints.userData.noShadow = true;
      haloPoints.userData.noAO = true;
      atmosphere.add(haloPoints);

      // A gentle warm fill per aisle: racks and floor pick up lamp colour
      // without any localised hotspot that would pulse against the dark hall.
      aisleCentres.forEach(z => {
        const lamp = new THREE.PointLight(0xffd7a1, 0.82, 32, 2);
        lamp.position.set(length * 0.52, lampY - 2.6, z);
        lamp.userData.isWarehouseAtmosphere = true;
        atmosphere.add(lamp);
        metadata.aisleLights = (metadata.aisleLights || 0) + 1;
      });

      // Warm haze along each aisle makes the lamp rows read as working lighting
      // instead of decorative white sticks on the roof structure.
      const stripGeometry = new THREE.PlaneGeometry(1, 1);
      const stripMaterial = new THREE.MeshBasicMaterial({
        map: fx.pool, color: 0xffdca8, transparent: true, opacity: 0.26,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false
      });
      aisleCentres.forEach(z => {
        const strip = new THREE.Mesh(stripGeometry, stripMaterial);
        strip.name = 'AisleLightHaze';
        strip.position.set((frontX + backX) / 2, lampY - 0.14, z);
        strip.rotation.x = -Math.PI / 2;
        strip.scale.set(backX - frontX - 2.5, 2.6, 1);
        strip.renderOrder = 3;
        strip.userData.noShadow = true;
        strip.userData.noAO = true;
        atmosphere.add(strip);
      });

      // Evenly spaced pools on every open strip: the floor under the fixtures
      // brightens consistently instead of one hot patch per low-bay cone.
      const poolMaterial = new THREE.MeshBasicMaterial({
        map: fx.pool, color: 0xffe8c6, transparent: true, opacity: 0.3,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false
      });
      const pools = batch(atmosphere, 'AisleFloorLightPools', poolMaterial, new THREE.PlaneGeometry(1, 1), false);
      lampPoints.forEach(lamp => {
        pools.add(lamp.x, 0.028, lamp.z, lamp.length * 2.4, 2.9, 1, flatQuat);
      });
      bayLamps.forEach(lamp => {
        pools.add(lamp.x, 0.03, lamp.z, 6.8, 6.8, 1, flatQuat);
      });

      // Slow suspended dust: subtle enough to read as air, not glitter.
      const dustCount = 620;
      const dustPositions = new Float32Array(dustCount * 3);
      for (let index = 0; index < dustCount; index++) {
        dustPositions[index * 3] = frontX + Math.random() * (backX - frontX);
        dustPositions[index * 3 + 1] = 1.2 + Math.random() * (eave - 2);
        dustPositions[index * 3 + 2] = minZ + Math.random() * (maxZ - minZ);
      }
      const dustGeometry = new THREE.BufferGeometry();
      dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions.slice(), 3));
      dustPoints = new THREE.Points(dustGeometry, new THREE.PointsMaterial({
        map: fx.dust, color: 0xd8e8f2, size: 0.07, sizeAttenuation: true,
        transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending
      }));
      dustPoints.name = 'SuspendedDust';
      dustPoints.frustumCulled = false;
      dustPoints.userData.noShadow = true;
      dustPoints.userData.noAO = true;
      atmosphere.add(dustPoints);
      dustBase = dustPositions;
    }

    const markings = batch(safety, 'YellowPerimeterSafetyMarkings', mat.yellow, unit, false);
    const red = batch(safety, 'FireEquipmentCabinets', mat.red, unit, false);
    const white = batch(safety, 'FireCabinetLabels', mat.white, unit, false);
    const handles = batch(safety, 'FireCabinetHandles', mat.dark, unit, false);
    const bollards = batch(safety, 'DoorImpactProtectionBollards', mat.yellow, cylinder, false);
    const bands = batch(safety, 'BollardDarkBands', mat.dark, cylinder, false);
    const bases = batch(safety, 'BollardBasePlates', mat.dark, unit, false);
    const exits = batch(safety, 'EmergencyExitSigns', mat.exitSign, unit, false);
    const pallets = batch(safety, 'EmptyPalletStacks', mat.timber, unit, true);
    const cartons = batch(safety, 'CartonStacks', mat.cardboard, unit, true);

    function groundLine(ax, az, bx, bz, width) {
      const dx = bx - ax, dz = bz - az;
      const distance = Math.hypot(dx, dz);
      rotation.setFromAxisAngle(UP, -Math.atan2(dz, dx));
      markings.add((ax + bx) / 2, 0.018, (az + bz) / 2, distance, 0.008, width, rotation);
    }
    groundLine(frontX + 1.3, minZ + 1.2, backX - 1.3, minZ + 1.2, 0.085);
    groundLine(backX - 1.2, minZ + 1.3, backX - 1.2, maxZ - 1.3, 0.085);
    for (const centre of doorCentres) {
      const queueHalfWidth = doorHalfWidth + 0.5;
      groundLine(centre - queueHalfWidth, minZ + 0.45, centre - queueHalfWidth, minZ + 2.8, 0.075);
      groundLine(centre + queueHalfWidth, minZ + 0.45, centre + queueHalfWidth, minZ + 2.8, 0.075);
      groundLine(centre - queueHalfWidth, minZ + 2.8, centre + queueHalfWidth, minZ + 2.8, 0.075);
      for (const side of [-1, 1]) {
        const x = centre + side * (doorHalfWidth + 0.25), z = minZ + 0.55;
        bollards.add(x, 0.52, z, 0.17, 0.96, 0.17);
        bands.add(x, 0.77, z, 0.174, 0.13, 0.174);
        bases.add(x, 0.035, z, 0.27, 0.07, 0.27);
      }
    }
    for (const x of [frontX + 1.1, backX - 1.1]) {
      red.add(x, 1.15, minZ + 0.22, 0.52, 0.74, 0.27);
      white.add(x, 1.34, minZ + 0.365, 0.26, 0.14, 0.018);
      handles.add(x + 0.17, 1.08, minZ + 0.37, 0.025, 0.20, 0.025);
    }

    /* ---------- 门头疏散指示、码垛托盘与纸箱：现场常见的地面层细节 ---------- */
    const doorHeight = Math.min(4.5, eave * 0.52);
    doorCentres.forEach(centre => {
      exits.add(centre, doorHeight + 0.78, minZ + 0.16, 0.94, 0.32, 0.07);
      // Empty pallet stacks beside each dock leveller, as in a live dispatch lane.
      const stackX = centre + doorHalfWidth + 1.45;
      for (let layer = 0; layer < 9; layer++) {
        pallets.add(stackX, 0.075 + layer * 0.145, minZ + 2.1, 1.2, 0.055, 1.0);
        pallets.add(stackX, 0.115 + layer * 0.145, minZ + 2.1, 1.05, 0.045, 0.16);
      }
      cartons.add(stackX + 1.7, 0.32, minZ + 1.9, 0.62, 0.62, 0.58);
      cartons.add(stackX + 1.7, 0.94, minZ + 1.9, 0.58, 0.60, 0.54);
      cartons.add(stackX + 1.68, 1.53, minZ + 1.92, 0.5, 0.56, 0.46);
    });

    batches.forEach(item => item.finish());
    atmosphere.children.forEach(child => { child.userData.isWarehouseAtmosphere = true; });
    group.updateMatrixWorld(true);
    // Three r149's Box3.setFromObject does not include every instance transform.
    // Compute the environment extent explicitly so its metadata remains truthful.
    const actualBounds = new THREE.Box3(), instance = new THREE.Matrix4(), world = new THREE.Matrix4();
    group.traverse(object => {
      if (!object.isMesh || object.userData.isWarehouseAtmosphere) return;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      if (object.isInstancedMesh) {
        for (let index = 0; index < object.count; index++) {
          object.getMatrixAt(index, instance);
          world.multiplyMatrices(object.matrixWorld, instance);
          actualBounds.union(object.geometry.boundingBox.clone().applyMatrix4(world));
        }
      } else actualBounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
    });
    metadata.bounds = {
      min: { x: actualBounds.min.x, y: actualBounds.min.y, z: actualBounds.min.z },
      max: { x: actualBounds.max.x, y: actualBounds.max.y, z: actualBounds.max.z }
    };
    metadata.drawCalls = Object.keys(counts).length;
    metadata.atmosphere = {
      lampCount: lampPoints.length,
      bayLampCount: bayLamps.length,
      aisleHazeCount: aisleCentres.length,
      dustCount: dustPoints ? dustPoints.geometry.getAttribute('position').count : 0,
      exitSignCount: doorCentres.length
    };
    group.userData.warehouseEnvironment = metadata;

    function setVisible(visible) {
      group.visible = !!visible;
      metadata.visible = group.visible;
    }

    function setCutaway(settings) {
      settings = settings || {};
      const position = settings.cameraPosition;
      const cameraX = position && Number.isFinite(position.x) ? position.x : frontX - 20;
      const cameraZ = position && Number.isFinite(position.z) ? position.z : maxZ + 20;
      const isTop = settings.view === 'top' || settings.view === 'plan';
      // 第一视角站在厂房里：四面墙都留着，抬头也保留屋架，
      // 否则近侧墙被剖开后视线会直接漏进背景板，像是站在悬空模型里。
      const isInside = settings.view === 'fpv';
      for (const name of Object.keys(walls)) walls[name].visible = true;
      const removed = [];
      if (!isTop && !isInside) {
        const xSide = cameraX <= centreX ? 'frontX' : 'backX';
        const zSide = cameraZ <= centreZ ? 'minZ' : 'maxZ';
        walls[xSide].visible = false;
        walls[zSide].visible = false;
        removed.push(xSide, zSide);
      }
      roof.visible = !isTop;
      metadata.cutawayWalls = removed;
      metadata.roofVisible = roof.visible;
      metadata.floorMode = settings.floorMode === undefined ? null : settings.floorMode;
    }

    // Suspended dust drifts a few centimetres on independent sine paths; the
    // motion is slow and sub-metre so it never reads as equipment movement.
    function updateAtmosphere(elapsedSeconds) {
      if (!dustPoints || !dustBase) return;
      const t = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
      const array = dustPoints.geometry.getAttribute('position').array;
      for (let index = 0; index < array.length; index += 3) {
        const seed = index * 0.37;
        array[index] = dustBase[index] + Math.sin(t * 0.07 + seed) * 0.28;
        array[index + 1] = dustBase[index + 1] + Math.sin(t * 0.05 + seed * 1.7) * 0.18;
        array[index + 2] = dustBase[index + 2] + Math.cos(t * 0.06 + seed * 0.6) * 0.28;
      }
      dustPoints.geometry.getAttribute('position').needsUpdate = true;
    }

    setCutaway();
    return { group, setVisible, setCutaway, updateAtmosphere, metadata };
  }

  global.WcsWarehouseEnvironment = Object.freeze({ create });
})(typeof window !== 'undefined' ? window : globalThis);
