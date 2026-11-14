(function (global) {
  'use strict';

  // Local Y=0 is the conveyor surface. The caller places the returned group at
  // surfaceHeight; keeping that world offset out of the geometry avoids applying
  // the conveyor elevation twice when a pallet moves between line segments.
  const THREE = global.THREE;
  if (!THREE) throw new Error('conveyor-load.js requires THREE to be loaded first.');
  const cache = new Map();
  const materials = {
    wood: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.93, metalness: 0 }),
    carton: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.96, metalness: 0 }),
    strap: new THREE.MeshStandardMaterial({ color: 0x656761, roughness: 0.80, metalness: 0.02 })
  };

  function piece(width, height, depth, x, y, z, colour) {
    const geometry = new THREE.BoxGeometry(width, height, depth).toNonIndexed();
    geometry.translate(x, y, z);
    if (colour !== undefined) {
      const base = new THREE.Color(colour), positions = geometry.getAttribute('position');
      const colours = new Float32Array(positions.count * 3);
      for (let index = 0; index < positions.count; index++) {
        // Slight face variation retains the folds and boards at the overview scale.
        const normal = geometry.getAttribute('normal');
        const shade = normal.getY(index) > 0.5 ? 1.035 : normal.getZ(index) < -0.5 ? 0.95 : 1;
        colours[index * 3] = base.r * shade;
        colours[index * 3 + 1] = base.g * shade;
        colours[index * 3 + 2] = base.b * shade;
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    }
    return geometry;
  }

  function merge(parts, coloured) {
    const result = new THREE.BufferGeometry();
    for (const name of coloured ? ['position', 'normal', 'color'] : ['position', 'normal']) {
      const total = parts.reduce((sum, geometry) => sum + geometry.getAttribute(name).array.length, 0);
      const data = new Float32Array(total);
      let cursor = 0;
      for (const geometry of parts) {
        const source = geometry.getAttribute(name).array;
        data.set(source, cursor);
        cursor += source.length;
      }
      result.setAttribute(name, new THREE.BufferAttribute(data, 3));
    }
    parts.forEach(geometry => geometry.dispose());
    result.computeBoundingBox();
    result.computeBoundingSphere();
    return result;
  }

  function buildGeometry(width, depth) {
    const scale = Math.min(width / 0.42, depth / 0.45);
    const bottom = 0.01;
    const bottomBoard = 0.009 * scale, blockHeight = 0.028 * scale;
    const bearer = 0.009 * scale, topBoard = 0.011 * scale;
    const palletTop = bottom + bottomBoard + blockHeight + bearer + topBoard;
    const woods = [], cartons = [], bands = [];
    const woodColours = [0xb99a72, 0xc6aa82, 0xaf906b, 0xc2a27a, 0xb79a75];
    let woodIndex = 0;
    function plank(w, h, d, x, y, z) {
      woods.push(piece(w, h, d, x, y, z, woodColours[woodIndex++ % woodColours.length]));
    }

    // Bottom runners, nine separate feet and upper bearers leave real fork pockets.
    for (const x of [-width * 0.35, 0, width * 0.35]) {
      plank(width * 0.18, bottomBoard, depth * 0.98, x, bottom + bottomBoard / 2, 0);
      for (const z of [-depth * 0.36, 0, depth * 0.36])
        plank(width * 0.16, blockHeight, depth * 0.16, x,
          bottom + bottomBoard + blockHeight / 2, z);
      plank(width * 0.16, bearer, depth * 0.96, x,
        bottom + bottomBoard + blockHeight + bearer / 2, 0);
    }
    for (let board = 0; board < 5; board++)
      plank(width * 0.98, topBoard, depth * 0.145, 0, palletTop - topBoard / 2,
        (board - 2) * depth * 0.205);

    const cargoWidth = width * 0.87, cargoDepth = depth * 0.87;
    const cargoHeight = 0.34 * scale, cargoTop = palletTop + cargoHeight;
    const gap = 0.0025 * scale;
    const cartonWidth = (cargoWidth - gap) / 2, cartonDepth = (cargoDepth - gap) / 2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * (cartonWidth + gap) / 2, z = sz * (cartonDepth + gap) / 2;
      cartons.push(piece(cartonWidth, cargoHeight, cartonDepth, x,
        palletTop + cargoHeight / 2, z, sx === sz ? 0xc4beae : 0xbdb8aa));
      // A pale packing-tape seam across each carton lid shares its material batch.
      cartons.push(piece(cartonWidth * 0.96, 0.0008 * scale, 0.013 * scale,
        x, cargoTop + 0.0004 * scale, z, 0xd5cfbd));
    }

    const bandWidth = 0.012 * scale, bandThickness = 0.0025 * scale;
    const strapZ = cargoDepth * 0.20, strapX = -cargoWidth * 0.21;
    bands.push(piece(cargoWidth + bandThickness * 2, bandThickness, bandWidth,
      0, cargoTop + bandThickness / 2, strapZ));
    for (const sx of [-1, 1])
      bands.push(piece(bandThickness, cargoHeight, bandWidth,
        sx * (cargoWidth + bandThickness) / 2, palletTop + cargoHeight / 2, strapZ));
    bands.push(piece(bandWidth, bandThickness, cargoDepth + bandThickness * 2,
      strapX, cargoTop + bandThickness / 2, 0));
    for (const sz of [-1, 1])
      bands.push(piece(bandWidth, cargoHeight, bandThickness,
        strapX, palletTop + cargoHeight / 2, sz * (cargoDepth + bandThickness) / 2));

    // A small shipping label with geometric barcode, still within the carton batch.
    const labelX = cargoWidth * 0.25, labelY = palletTop + cargoHeight * 0.57;
    const labelZ = cargoDepth / 2 + 0.0005 * scale;
    cartons.push(piece(0.067 * scale, 0.047 * scale, 0.001 * scale,
      labelX, labelY, labelZ, 0xe8e6de));
    for (let line = 0; line < 15; line++) {
      const stroke = (line % 3 === 0 ? 0.0018 : 0.0009) * scale;
      bands.push(piece(stroke, (line % 4 === 0 ? 0.019 : 0.023) * scale, 0.0005 * scale,
        labelX + (line - 7) * 0.0034 * scale, labelY - 0.001 * scale,
        labelZ + 0.00075 * scale));
    }

    return {
      wood: merge(woods, true),
      carton: merge(cartons, true),
      strap: merge(bands, false),
      palletBottom: bottom, palletTop, cargoBottom: palletTop, cargoTop
    };
  }

  function create(options) {
    const { width = 0.42, depth = 0.45, surfaceHeight = 0.56 } = options || {};
    if (!Number.isFinite(width) || !Number.isFinite(depth) || width < 0.10 || depth < 0.10 ||
        !Number.isFinite(surfaceHeight))
      throw new Error('Conveyor load dimensions must be finite and at least 0.10 m.');
    const key = width + '/' + depth;
    if (!cache.has(key)) cache.set(key, buildGeometry(width, depth));
    const geometry = cache.get(key);
    const group = new THREE.Group();
    group.name = 'ConveyorPalletizedCartons';
    for (const [part, name] of [['wood', 'ConveyorLoadWoodenPallet'], ['carton', 'ConveyorLoadCartons'], ['strap', 'ConveyorLoadStrapsAndMarks']]) {
      const mesh = new THREE.Mesh(geometry[part], materials[part]);
      mesh.name = name;
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
    group.userData.conveyorLoad = {
      footprint: { width, depth }, surfaceHeight,
      palletBottom: geometry.palletBottom,
      palletTop: geometry.palletTop,
      cargoBottom: geometry.cargoBottom,
      cargoTop: geometry.cargoTop,
      drawCalls: 3
    };
    return group;
  }

  global.WcsConveyorLoad = Object.freeze({ create });
})(typeof window !== 'undefined' ? window : globalThis);
