(function (global) {
  'use strict';

  // Geometry is in metres. A section is one logical floor; the upright ends are
  // exactly 0 / height, so stacking sections never changes the physical rack grid.
  const THREE = global.THREE;
  if (!THREE) throw new Error('rack-model.js requires THREE to be loaded first.');
  const UP = new THREE.Vector3(0, 1, 0);
  const profileCache = new Map();
  const LOD_THRESHOLDS = {
    balanced: { far: 24, near: 18 },
    high: { far: 45, near: 35 },
    performance: { far: 14, near: 10 }
  };
  let materials;

  function zincMaterials() {
    if (materials) return materials;
    // Small, locally generated zinc flakes give the steel a restrained mottled
    // finish. No photographs, downloaded textures, canvas or network are needed.
    const size = 64, pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const hash = Math.imul(x * 19 + y * 43 + 37, 73244475) >>> 0;
        const flake = ((hash ^ (hash >>> 11)) & 31) - 15;
        const grain = Math.sin(x * 0.72 + y * 0.31) * 3;
        const offset = (y * size + x) * 4;
        pixels[offset] = 231 + flake * 0.55 + grain;
        pixels[offset + 1] = 234 + flake * 0.52 + grain;
        pixels[offset + 2] = 236 + flake * 0.48 + grain;
        pixels[offset + 3] = 255;
      }
    }
    const map = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(2, 12);
    map.encoding = THREE.sRGBEncoding;
    map.generateMipmaps = true;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.anisotropy = 8;
    map.needsUpdate = true;
    materials = {
      // 镀锌钢是哑光冷灰，不是亮白：粗糙度整体上调、基色压深一档，
      // 梁柱交界才会出现真实的高光层次，而不是一片均匀的浅色。
      post: new THREE.MeshStandardMaterial({ color: 0xa4aeb6, metalness: 0.38, roughness: 0.56, map }),
      beam: new THREE.MeshStandardMaterial({ color: 0x9aa6ae, metalness: 0.42, roughness: 0.52, map }),
      brace: new THREE.MeshStandardMaterial({ color: 0xb2bbc2, metalness: 0.46, roughness: 0.5 }),
      plate: new THREE.MeshStandardMaterial({ color: 0x98a3ab, metalness: 0.44, roughness: 0.54 }),
      bolt: new THREE.MeshStandardMaterial({ color: 0x7e8b96, metalness: 0.6, roughness: 0.4 })
    };
    return materials;
  }

  function mergeGeometry(parts) {
    const geometries = parts.map(geometry => geometry.index ? geometry.toNonIndexed() : geometry);
    const merged = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const size = geometries.reduce((sum, geometry) => sum + geometry.getAttribute(name).array.length, 0);
      const values = new Float32Array(size);
      let cursor = 0;
      for (const geometry of geometries) {
        const source = geometry.getAttribute(name).array;
        values.set(source, cursor);
        cursor += source.length;
      }
      merged.setAttribute(name, new THREE.BufferAttribute(values, name === 'uv' ? 2 : 3));
    }
    for (let i = 0; i < geometries.length; i++) {
      geometries[i].dispose();
      if (parts[i] !== geometries[i]) parts[i].dispose();
    }
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  }

  function box(width, height, depth, x, y, z) {
    return new THREE.BoxGeometry(width, height, depth).translate(x || 0, y || 0, z || 0);
  }

  function uprightGeometry(height, detail) {
    detail = detail || 'high';
    const key = 'upright-' + height + '-' + detail;
    if (profileCache.has(key)) return profileCache.get(key);
    const width = 0.145, depth = 0.115, thickness = 0.013, lip = 0.029;
    // Both LODs retain the same open, lipped C section and exact outer bounds.
    // Nearby uprights use actual through slots; distant ones use an unpierced
    // web, avoiding subpixel hole edges and most of the triangulation cost.
    const web = new THREE.Shape();
    web.moveTo(-depth / 2, -height / 2);
    web.lineTo(depth / 2, -height / 2);
    web.lineTo(depth / 2, height / 2);
    web.lineTo(-depth / 2, height / 2);
    web.closePath();
    for (let y = -height / 2 + 0.25; detail === 'high' && y < height / 2 - 0.18; y += 0.20) {
      const hole = new THREE.Path(), w = 0.029, h = 0.066, corner = 0.006;
      hole.moveTo(-w / 2, y - h / 2 + corner);
      hole.lineTo(-w / 2, y + h / 2 - corner);
      hole.lineTo(-w / 2 + corner, y + h / 2);
      hole.lineTo(w / 2 - corner, y + h / 2);
      hole.lineTo(w / 2, y + h / 2 - corner);
      hole.lineTo(w / 2, y - h / 2 + corner);
      hole.lineTo(w / 2 - corner, y - h / 2);
      hole.lineTo(-w / 2 + corner, y - h / 2);
      hole.closePath();
      web.holes.push(hole);
    }
    const piercedWeb = new THREE.ExtrudeGeometry(web, { depth: thickness, bevelEnabled: false, steps: 1, curveSegments: 1 });
    piercedWeb.rotateY(Math.PI / 2).translate(-width / 2, 0, 0);
    const geometry = mergeGeometry([
      piercedWeb,
      box(width, height, thickness, 0, 0, -depth / 2 + thickness / 2),
      box(width, height, thickness, 0, 0, depth / 2 - thickness / 2),
      box(thickness, height, lip, width / 2 - thickness / 2, 0, -depth / 2 + lip / 2),
      box(thickness, height, lip, width / 2 - thickness / 2, 0, depth / 2 - lip / 2)
    ]);
    geometry.userData = {
      profile: detail === 'high' ? 'perforated-lipped-C' : 'lipped-C',
      width, depth, thickness, slotPitch: detail === 'high' ? 0.20 : null, detail
    };
    profileCache.set(key, geometry);
    return geometry;
  }

  function beamGeometry(length) {
    return mergeGeometry([
      box(length, 0.14, 0.018, 0, 0, -0.037),
      box(length, 0.014, 0.09, 0, 0.063, 0),
      box(length, 0.014, 0.075, 0, -0.063, -0.0075)
    ]);
  }

  function railGeometry(depth) {
    // Two of these L channels support a pallet; the centre of the bay stays open.
    return mergeGeometry([
      box(0.018, 0.12, depth, -0.071, -0.02, 0),
      box(0.16, 0.026, depth, 0, -0.067, 0)
    ]);
  }

  function createSection(options) {
    const { cfg, length, height, rowOffset, aisleZ, isUpper } = options || {};
    if (!cfg || typeof aisleZ !== 'function' || !Number.isFinite(length) || length <= 0 ||
        !Number.isFinite(height) || height <= 0 || !Number.isFinite(rowOffset) || rowOffset <= 0 ||
        !Number.isInteger(cfg.aisles) || cfg.aisles < 1 || !Number.isInteger(cfg.bays) || cfg.bays < 1 ||
        !Number.isInteger(cfg.levels) || cfg.levels < 1 || !(cfg.bayW > 0.45) || !(cfg.rackD > 0.35) || !(cfg.levelH > 0.45))
      throw new Error('Invalid rack section dimensions.');
    if (Math.abs(length - cfg.bays * cfg.bayW) > 1e-6 || Math.abs(height - cfg.levels * cfg.levelH) > 1e-6)
      throw new Error('Rack length / height must agree with the bay and level grid.');

    const mat = zincMaterials();
    const group = new THREE.Group();
    group.name = isUpper ? 'GalvanizedRackUpperSection' : 'GalvanizedRackLowerSection';
    const seamParts = [];
    const baseRails = new THREE.Group(), baseBeams = new THREE.Group();
    baseRails.name = 'UpperSectionDuplicateBasePalletRails';
    baseBeams.name = 'UpperSectionDuplicateBaseBeams';
    if (isUpper) {
      group.add(baseRails, baseBeams);
      seamParts.push(baseRails, baseBeams);
    }
    const dummy = new THREE.Object3D();
    const batches = [], counts = {};

    function batch(name, geometry, material, parent) {
      const transforms = [];
      const item = {
        name, geometry, material, parent: parent || group,
        add(x, y, z, sx, sy, sz, quaternion) {
          dummy.position.set(x, y, z);
          dummy.scale.set(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz);
          if (quaternion) dummy.quaternion.copy(quaternion); else dummy.quaternion.identity();
          dummy.updateMatrix();
          transforms.push(dummy.matrix.clone());
        },
        finish() {
          if (!transforms.length) return null;
          const instances = new THREE.InstancedMesh(geometry, material, transforms.length);
          instances.name = name;
          instances.userData.rackComponent = name;
          // 螺栓、连接板、柱脚锚栓、拼接件属于"凑近才看得见"的微件：
          // 总览时整层一个实例批也躲不开视锥剔除，标记后由主循环按距离显隐。
          instances.userData.detailTier = /Bolts|ConnectorPlates|SplicePlates/.test(name) ? 'micro' : 'major';
          transforms.forEach((transform, index) => instances.setMatrixAt(index, transform));
          instances.instanceMatrix.needsUpdate = true;
          instances.castShadow = instances.receiveShadow = true;
          instances.frustumCulled = false;
          item.parent.add(instances);
          counts[name] = transforms.length;
          return instances;
        }
      };
      batches.push(item);
      return item;
    }

    const postsBatch = batch('PerforatedCUprights', uprightGeometry(height), mat.post);
    const beamGeo = beamGeometry(cfg.bayW - 0.10);
    const railGeo = railGeometry(cfg.rackD - 0.14);
    const plateGeo = box(0.12, 0.24, 0.024);
    const boltGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.025, 6);
    const beams = batch('HorizontalPurlinBeams', beamGeo, mat.beam);
    const rails = batch('PairedPalletSupportRails', railGeo, mat.beam);
    const plates = batch('BeamConnectorPlates', plateGeo, mat.plate);
    const bolts = batch('BeamConnectorHexBolts', boltGeo, mat.bolt);
    const duplicateBeams = isUpper ? batch('DuplicateBaseBeams', beamGeo, mat.beam, baseBeams) : beams;
    const duplicateRails = isUpper ? batch('DuplicateBaseRails', railGeo, mat.beam, baseRails) : rails;
    const duplicatePlates = isUpper ? batch('DuplicateBaseConnectorPlates', plateGeo, mat.plate, baseBeams) : plates;
    const duplicateBolts = isUpper ? batch('DuplicateBaseConnectorBolts', boltGeo, mat.bolt, baseBeams) : bolts;
    const transverse = batch('UprightFrameHorizontalTies', box(0.055, 0.065, cfg.rackD - 0.08), mat.brace);
    const sideBraces = batch('UprightFrameDiagonalBraces', box(1, 1, 1), mat.brace);
    const backBraces = batch('SelectiveRearLongitudinalXBraces', new THREE.CylinderGeometry(0.5, 0.5, 1, 6), mat.brace);
    const topTies = batch('TopFrameLongitudinalTieRods', new THREE.CylinderGeometry(0.5, 0.5, 1, 6), mat.brace);
    const feet = !isUpper ? batch('AnchoredFootPlates', box(0.27, 0.026, 0.25), mat.plate) : null;
    const anchors = !isUpper ? batch('FootAnchorHexBolts', new THREE.CylinderGeometry(0.025, 0.025, 0.055, 6), mat.bolt) : null;
    const splices = isUpper ? batch('ColumnSectionSplicePlates', box(0.12, 0.30, 0.025), mat.plate) : null;
    const spliceBolts = isUpper ? batch('ColumnSpliceHexBolts', boltGeo, mat.bolt) : null;
    const forwardBolt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    const reverseRail = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);
    const rodStart = new THREE.Vector3(), rodEnd = new THREE.Vector3(), rodDirection = new THREE.Vector3();
    const rodRotation = new THREE.Quaternion();

    function rod(target, ax, ay, az, bx, by, bz, thickness) {
      rodStart.set(ax, ay, az);
      rodEnd.set(bx, by, bz);
      rodDirection.subVectors(rodEnd, rodStart);
      const distance = rodDirection.length();
      if (distance < 1e-8) return;
      rodRotation.setFromUnitVectors(UP, rodDirection.divideScalar(distance));
      target.add((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, thickness, distance, thickness, rodRotation);
    }

    for (let aisle = 0; aisle < cfg.aisles; aisle++) {
      const centreZ = aisleZ(aisle);
      if (!Number.isFinite(centreZ)) throw new Error('Rack aisle position must be finite.');
      for (let side = -1; side <= 1; side += 2) {
        const rowZ = centreZ + side * rowOffset;
        const frontZ = rowZ - cfg.rackD / 2, rearZ = rowZ + cfg.rackD / 2;
        for (let frame = 0; frame <= cfg.bays; frame++) {
          const x = frame * cfg.bayW;
          for (const z of [frontZ, rearZ]) {
            postsBatch.add(x, height / 2, z);
            if (feet) {
              feet.add(x, 0.020, z);
              for (const dx of [-0.091, 0.091]) for (const dz of [-0.078, 0.078])
                anchors.add(x + dx, 0.057, z + dz);
            }
            if (splices) {
              for (const face of [-1, 1]) {
                splices.add(x, 0.16, z + face * 0.073);
                for (const y of [0.075, 0.245])
                  spliceBolts.add(x, y, z + face * 0.096, 1, 1, 1, forwardBolt);
              }
            }
          }
          for (let level = 0; level <= cfg.levels; level++) {
            const y = Math.min(height - 0.075, Math.max(0.18, level * cfg.levelH));
            transverse.add(x, y, rowZ);
          }
          for (let level = 0; level < cfg.levels; level++) {
            const low = level * cfg.levelH + 0.20, high = (level + 1) * cfg.levelH - 0.17;
            if ((frame + level) % 2 === 0)
              rod(sideBraces, x, low, frontZ + 0.045, x, high, rearZ - 0.045, 0.038);
            else
              rod(sideBraces, x, high, frontZ + 0.045, x, low, rearZ - 0.045, 0.038);
            // End frames carry a complete X, visible through the open end bay.
            if (frame === 0 || frame === cfg.bays) {
              if ((frame + level) % 2 === 0)
                rod(sideBraces, x + 0.022, high, frontZ + 0.045, x + 0.022, low, rearZ - 0.045, 0.035);
              else
                rod(sideBraces, x + 0.022, low, frontZ + 0.045, x + 0.022, high, rearZ - 0.045, 0.035);
            }
          }
        }

        for (let level = 0; level <= cfg.levels; level++) {
          const datum = level * cfg.levelH;
          const beamBatch = isUpper && level === 0 ? duplicateBeams : beams;
          const railBatch = isUpper && level === 0 ? duplicateRails : rails;
          const plateBatch = isUpper && level === 0 ? duplicatePlates : plates;
          const boltBatch = isUpper && level === 0 ? duplicateBolts : bolts;
          for (let bay = 0; bay < cfg.bays; bay++) {
            const x = (bay + 0.5) * cfg.bayW;
            for (const edge of [-1, 1]) {
              const z = rowZ + edge * cfg.rackD / 2;
              beamBatch.add(x, datum + 0.065, z, 1, 1, 1, edge < 0 ? reverseRail : null);
              railBatch.add(x + edge * cfg.bayW * 0.30, datum + 0.20, rowZ, 1, 1, 1, edge > 0 ? reverseRail : null);
            }
          }
          for (let frame = 0; frame <= cfg.bays; frame++) {
            for (const edge of [-1, 1]) {
              const x = frame * cfg.bayW, z = rowZ + edge * (cfg.rackD / 2 + 0.072);
              plateBatch.add(x, datum + 0.085, z);
              for (const deltaY of [-0.058, 0.058])
                boltBatch.add(x, datum + 0.085 + deltaY, z + edge * 0.022, 1, 1, 1, forwardBolt);
            }
          }
        }

        // Rear tension Xs occupy selected zones, preserving open pallet access
        // from the aisle and an unobstructed view through most empty locations.
        const outerZ = rowZ + side * (cfg.rackD / 2 + 0.028);
        const bracedStarts = new Set([0, Math.max(0, Math.floor(cfg.bays / 2) - 1), Math.max(0, cfg.bays - 2)]);
        for (const bay of bracedStarts) {
          const x0 = bay * cfg.bayW + 0.08, x1 = Math.min(cfg.bays, bay + 2) * cfg.bayW - 0.08;
          for (let level = 0; level < cfg.levels; level++) {
            const y0 = level * cfg.levelH + 0.20, y1 = (level + 1) * cfg.levelH - 0.18;
            rod(backBraces, x0, y0, outerZ, x1, y1, outerZ, 0.026);
            rod(backBraces, x0, y1, outerZ + side * 0.015, x1, y0, outerZ + side * 0.015, 0.026);
          }
        }
        for (const edge of [-1, 1])
          rod(topTies, 0.07, height - 0.03, rowZ + edge * (cfg.rackD / 2 - 0.03),
            length - 0.07, height - 0.03, rowZ + edge * (cfg.rackD / 2 - 0.03), 0.028);
      }
    }

    let posts;
    for (const item of batches) {
      const instances = item.finish();
      if (item === postsBatch) posts = instances;
    }
    const metadata = {
      type: 'galvanized-pallet-rack',
      uprightProfile: 'perforated-lipped-C',
      rows: cfg.aisles * 2,
      frames: cfg.aisles * 2 * (cfg.bays + 1),
      baysPerRow: cfg.bays,
      levels: cfg.levels,
      sectionHeight: height,
      length,
      openBayCentres: true,
      palletSupport: 'paired-depth-L-rails',
      seamPolicy: isUpper ? 'hide-duplicate-base-rails-and-beams-when-stacked' : 'ground-anchored',
      components: counts,
      drawCalls: Object.keys(counts).length,
      currentDetail: 'high',
      postTriangles: posts.geometry.getAttribute('position').count / 3,
      totalPostTriangles: posts.geometry.getAttribute('position').count / 3 * posts.count
    };
    group.userData.rack = metadata;

    function updateLOD(distanceToSectionBounds, quality) {
      // The caller supplies distance to the nearest point on the section AABB,
      // not its centre: standing beside a long rack must keep the nearby holes.
      if (typeof distanceToSectionBounds !== 'number' || Number.isNaN(distanceToSectionBounds))
        return metadata.currentDetail;
      const thresholds = LOD_THRESHOLDS[quality || 'balanced'] || LOD_THRESHOLDS.balanced;
      let detail = metadata.currentDetail;
      if (detail === 'high' && distanceToSectionBounds > thresholds.far) detail = 'low';
      else if (detail === 'low' && distanceToSectionBounds < thresholds.near) detail = 'high';
      if (detail !== metadata.currentDetail) {
        // Reuse the same InstancedMesh and its transforms. Both geometry variants
        // are cached by height, so camera movement never duplicates rack meshes.
        posts.geometry = uprightGeometry(height, detail);
        metadata.currentDetail = detail;
        metadata.postTriangles = posts.geometry.getAttribute('position').count / 3;
        metadata.totalPostTriangles = metadata.postTriangles * posts.count;
      }
      return detail;
    }

    return { group, posts, seamParts, metadata, updateLOD };
  }

  global.WcsRackModel = Object.freeze({ createSection });
})(typeof window !== 'undefined' ? window : globalThis);
