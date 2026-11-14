/* Reusable instanced physical loads. Empty locations retain separate scene hit volumes. */
(() => {
  'use strict';

  function mergeBoxes(definitions) {
    const positions = [], normals = [], uvs = [];
    definitions.forEach(([w, h, d, x, y, z]) => {
      const geometry = new THREE.BoxGeometry(w, h, d).toNonIndexed();
      geometry.translate(x, y, z);
      positions.push(...geometry.attributes.position.array);
      normals.push(...geometry.attributes.normal.array);
      uvs.push(...geometry.attributes.uv.array);
      geometry.dispose();
    });
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    result.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    result.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    result.computeBoundingBox();
    result.computeBoundingSphere();
    return result;
  }

  function create({ cfg, count }) {
    const group = new THREE.Group();
    group.name = 'Palletized inventory';
    const width = cfg.bayW - 0.38, depth = cfg.rackD - 0.2;
    const palletParts = [];
    // Five separated deck boards, three runners and nine bearing blocks.
    for (let i = 0; i < 5; i++) palletParts.push([width, 0.035, depth / 5 - 0.025, 0, 0.09, -depth / 2 + depth * (i + 0.5) / 5]);
    for (let i = -1; i <= 1; i++) {
      palletParts.push([width, 0.03, 0.12, 0, -0.09, i * depth * 0.38]);
      for (let j = -1; j <= 1; j++) palletParts.push([0.14, 0.145, 0.12, j * width * 0.4, 0, i * depth * 0.38]);
    }
    const cartons = [];
    for (let x = -1; x <= 1; x += 2) for (let z = -1; z <= 1; z += 2) {
      for (let level = 0; level < 2; level++) cartons.push([
        width / 2 - 0.025, 0.548, depth / 2 - 0.025,
        x * width / 4, -0.28 + level * 0.56, z * depth / 4
      ]);
    }
    const straps = [];
    for (const x of [-width * 0.28, width * 0.28]) {
      straps.push([0.018, 0.008, depth - 0.018, x, 0.558, 0]);
      for (const z of [-depth / 2 + 0.004, depth / 2 - 0.004]) straps.push([0.018, 1.12, 0.008, x, 0, z]);
    }
    const cargoMesh = new THREE.InstancedMesh(mergeBoxes(cartons),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0.02 }), count);
    const palletMesh = new THREE.InstancedMesh(mergeBoxes(palletParts),
      new THREE.MeshStandardMaterial({ color: 0xb28b53, roughness: 0.94 }), count);
    const strapMesh = new THREE.InstancedMesh(mergeBoxes(straps),
      new THREE.MeshStandardMaterial({ color: 0x6b665b, roughness: 0.7, metalness: 0.1 }), count);
    const meshes = [cargoMesh, palletMesh, strapMesh];
    meshes.forEach(item => {
      item.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      item.castShadow = true;
      item.receiveShadow = true;
      // Instance transforms change as inventory moves; avoid an obsolete cached bound.
      item.frustumCulled = false;
      group.add(item);
    });
    cargoMesh.name = 'Carton loads'; palletMesh.name = 'Timber pallets'; strapMesh.name = 'Load straps';
    // 打包带是毫米级的深色窄条，总览视角纯属亚像素：标记为微件，
    // 主循环按相机到楼层的距离整批显隐，特写与第一视角不受影响。
    strapMesh.userData.detailTier = 'micro';
    const transform = new THREE.Object3D(), color = new THREE.Color();
    function update(cell) {
      transform.rotation.set(0, 0, 0);
      transform.scale.setScalar(cell.occupied ? 1 : 0);
      transform.position.set(cell.x, cell.y - 0.075, cell.z);
      transform.updateMatrix();
      cargoMesh.setMatrixAt(cell.idx, transform.matrix);
      strapMesh.setMatrixAt(cell.idx, transform.matrix);
      transform.position.y = cell.y - 0.75;
      transform.updateMatrix();
      palletMesh.setMatrixAt(cell.idx, transform.matrix);
      if (cell.alarm) color.setHex(0xe7ac58);
      // 纸箱是牛皮纸色，不是米白：偏深的暖色和冷灰钢架拉开色相差，
      // 满库时画面才不会糊成一片浅色块。
      else color.setHex([0xab8c66, 0x9c8460, 0xb69a72][cell.bay % 3]).multiplyScalar(cell.curve);
      cargoMesh.setColorAt(cell.idx, color);
      meshes.forEach(item => { item.instanceMatrix.needsUpdate = true; });
      if (cargoMesh.instanceColor) cargoMesh.instanceColor.needsUpdate = true;
    }
    return { group, cargoMesh, palletMesh, strapMesh, update };
  }

  window.WcsInventoryModel = Object.freeze({ create });
})();
