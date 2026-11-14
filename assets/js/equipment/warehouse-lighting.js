/* Neutral industrial lighting with a generated reflection environment; no remote assets.
 * The palette is a night-shift factory hall: a cool concrete base, warm-white LED
 * lamps over the aisles and a cold skylight wash from above. Every texture here is
 * generated from typed arrays so the module also runs under the Node test harness.
 */
(() => {
  'use strict';

  const BACKDROP = 0x131d25;
  // 雾从厂房中段才开始起效：远景仍有纵深，近处货架不再被雾压成一片灰白。
  const FOG_NEAR = 132;
  const FOG_FAR = 460;

  /* Soft radial falloff used for lamp halos and floor light pools. */
  function radialTexture(size, power, stopAt) {
    const data = new Uint8Array(size * size * 4);
    const limit = Number.isFinite(stopAt) ? stopAt : 1;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x + 0.5) / size * 2 - 1;
        const dy = (y + 0.5) / size * 2 - 1;
        const r = Math.min(1, Math.hypot(dx, dy) / limit);
        const alpha = Math.pow(1 - r, power);
        const index = (y * size + x) * 4;
        data[index] = 255; data[index + 1] = 255; data[index + 2] = 255;
        data[index + 3] = Math.round(Math.min(1, alpha) * 255);
      }
    }
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  /* Vertical fade for the volumetric cones below each lamp: bright at the tube,
   * dissolving before it reaches the rack tops.  v = 1 is the lamp end. */
  function beamTexture(height) {
    const data = new Uint8Array(4 * height * 4);
    for (let y = 0; y < height; y++) {
      const v = y / (height - 1);
      const alpha = Math.pow(v, 1.6) * 0.85;
      for (let x = 0; x < 4; x++) {
        const index = (y * 4 + x) * 4;
        data[index] = 255; data[index + 1] = 250; data[index + 2] = 235;
        data[index + 3] = Math.round(alpha * 255);
      }
    }
    const texture = new THREE.DataTexture(data, 4, height, THREE.RGBAFormat);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  function setup({ renderer, scene }) {
    renderer.setClearColor(BACKDROP, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    scene.background = new THREE.Color(BACKDROP);
    scene.fog = new THREE.Fog(BACKDROP, FOG_NEAR, FOG_FAR);

    // A bright cold sky dome over a near-black floor is what gives an indoor hall
    // its vertical falloff: rack tops catch daylight, the bases stay in shadow.
    // 天光压到 0.3：环境反射已经提供了大部分漫射，再叠高天光会把钢架洗成白模。
    scene.add(new THREE.HemisphereLight(0xbcd9f0, 0x0e1418, 0.3));

    const key = new THREE.DirectionalLight(0xeaf3ff, 1.2);
    key.position.set(-16, 44, 30);
    key.target.position.set(16, 0, -4);
    scene.add(key.target);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -46, right: 46, top: 44, bottom: -44, near: 1, far: 125 });
    key.shadow.bias = -0.00025;
    key.shadow.normalBias = 0.018;
    key.shadow.radius = 3;
    scene.add(key);

    const fill = new THREE.DirectionalLight(0x84b3d8, 0.15);
    fill.position.set(32, 16, 30);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xa8d8f2, 0.42);
    rim.position.set(52, 26, -32);
    scene.add(rim);

    if (renderer.isWebGLRenderer) {
      const room = new THREE.Scene();
      const shellGeometry = new THREE.BoxGeometry(100, 70, 90);
      const shellMaterial = new THREE.MeshBasicMaterial({ color: 0x18242d, side: THREE.BackSide });
      room.add(new THREE.Mesh(shellGeometry, shellMaterial));
      const panelGeometry = new THREE.BoxGeometry(14, 0.2, 50);
      // 2.4 的灯板亮度会在金属件上留下大面积白斑；1.9 保留灯管高光但不糊掉轮廓。
      const panelMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 1.86, 1.66) });
      [-28, 0, 28].forEach(x => {
        const panel = new THREE.Mesh(panelGeometry, panelMaterial);
        panel.position.set(x, 32, 0);
        room.add(panel);
      });
      const generator = new THREE.PMREMGenerator(renderer);
      const environment = generator.fromScene(room, 0.03);
      scene.environment = environment.texture;
      generator.dispose(); shellGeometry.dispose(); shellMaterial.dispose(); panelGeometry.dispose(); panelMaterial.dispose();
      // Keep the render target alive for the scene's lifetime.
      scene.userData.reflectionEnvironment = environment;
    }

    const fx = {
      halo: radialTexture(64, 2.1),
      pool: radialTexture(96, 2.3),
      beam: beamTexture(64),
      dust: radialTexture(32, 1.4)
    };

    return {
      key,
      fx,
      setQuality(quality) {
        const size = quality === 'high' ? 4096 : quality === 'performance' ? 1024 : 2048;
        if (key.shadow.mapSize.x === size) return;
        key.shadow.mapSize.set(size, size);
        if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
        key.shadow.needsUpdate = true;
      }
    };
  }

  /* Polished concrete: fine grain plus faint pour joints, so the floor picks up
   * lamp pools and skylight instead of reading as flat white paper.
   * 512px 而不是 256px：同样一张贴图平铺到 57m 长的地面上，颗粒不至于被放大成噪点。 */
  function concreteTexture(renderer) {
    if (!renderer.isWebGLRenderer) return null;
    const size = 512, joint = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    const pixels = context.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        // Hash pixels independently; a repeating arithmetic ramp produces moire in close views.
        let hash = Math.imul((y * size + x) ^ 0x45d9f3b, 0x45d9f3b);
        hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
        const grain = ((hash ^ (hash >>> 16)) & 31) / 4 - 4;
        // 低频斑块模拟水泥浆的深浅差异，避免整块地面一个灰度。
        const blotch = Math.sin(x * 0.017 + y * 0.009) * 3.4 + Math.sin(x * 0.006 - y * 0.013 + 1.7) * 2.6;
        const seam = (x % joint === 0 || y % joint === 0) ? -14 : (x % joint === 1 || y % joint === 1) ? -6 : 0;
        pixels.data[i] = 132 + grain + blotch + seam;
        pixels.data[i + 1] = 137 + grain + blotch + seam;
        pixels.data[i + 2] = 139 + grain + blotch + seam;
        pixels.data[i + 3] = 255;
      }
    }
    context.putImageData(pixels, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.encoding = THREE.sRGBEncoding;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(14, 14);
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  /* Environment reflections are shared by every standard material in the scene.
   * Dimming the PMREM result (rather than the lights) deepens crevices and keeps
   * galvanised steel from reading as bright plastic; a single traversal avoids
   * touching each model module's material table. */
  function applyReflectance(scene, intensity) {
    const value = Number.isFinite(intensity) ? intensity : 0.85;
    if (!scene || typeof scene.traverse !== 'function') return 0;
    let touched = 0;
    scene.traverse(object => {
      const list = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      for (const material of list) {
        if (!material || material.isMeshStandardMaterial !== true || material.userData?.noEnvironment) continue;
        if (material.envMapIntensity === value) continue;
        material.envMapIntensity = value;
        material.needsUpdate = true;
        touched++;
      }
    });
    return touched;
  }

  window.WcsWarehouseLighting = Object.freeze({
    setup, concreteTexture, radialTexture, beamTexture, applyReflectance, BACKDROP, FOG_NEAR, FOG_FAR
  });
})();
