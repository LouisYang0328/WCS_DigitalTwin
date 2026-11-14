/* Deterministic rendering lifecycle checks without a GPU. Real WebGL output
 * and framebuffer support must be verified in a browser separately.
 * Run with: node tests/validate-rendering.cjs
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const THREE = require(path.join(root, 'assets/three.min.js'));
const source = fs.readFileSync(path.join(root, 'assets/js/rendering/postprocessing.js'), 'utf8');
const warnings = [];
const context = {
  THREE,
  console: { ...console, warn: (...args) => warnings.push(args) },
  requestAnimationFrame() { assert.fail('Post-processing must use the existing scene loop'); },
  setInterval() { assert.fail('Post-processing must not start a second render timer'); }
};
context.window = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'postprocessing.js' });
assert.equal(typeof context.WcsPostProcessing?.create, 'function');

function rendererProbe(pretendWebGL = false) {
  return {
    isWebGLRenderer: pretendWebGL,
    frames: [],
    canvasResizes: [],
    domElement: { width: 1280, height: 720 },
    getContext() { return {}; },
    getPixelRatio() { return 1; },
    setSize(width, height) { this.canvasResizes.push({ width, height }); },
    render(scene, camera) { this.frames.push({ scene, camera }); }
  };
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.15, 500);
const originalChild = new THREE.Group();
scene.add(originalChild);

for (const pretendWebGL of [false, true]) {
  const renderer = rendererProbe(pretendWebGL);
  const warningCount = warnings.length;
  const pipeline = context.WcsPostProcessing.create({ renderer, scene, camera, width: 1280, height: 720, quality: 'balanced' });
  assert.equal(pipeline.stats.mode, 'direct');
  assert.equal(pipeline.stats.enabled, false);
  assert.equal(pipeline.stats.fallbackReason, pretendWebGL ? 'components-unavailable' : 'renderer-unavailable');

  for (const [quality, width, height] of [
    ['high', 1920, 1080], ['performance', 800, 600], ['balanced', 1280, 720],
    ['high', 1600, 1000], ['balanced', 1280, 720]
  ]) {
    pipeline.setQuality(quality);
    pipeline.resize(width, height);
    assert.equal(pipeline.stats.quality, quality);
    assert.equal(pipeline.stats.mode, 'direct');
    const renderedFrames = renderer.frames.length;
    pipeline.render();
    assert.equal(renderer.frames.length, renderedFrames + 1, 'Fallback submits exactly one frame');
    assert.equal(renderer.frames.at(-1).scene, scene, 'Fallback preserves the authoritative scene');
    assert.equal(renderer.frames.at(-1).camera, camera, 'Fallback preserves the active camera');
    assert.equal(scene.children.length, 1, 'Changing quality cannot replace or duplicate scene content');
    assert.equal(scene.children[0], originalChild);
  }
  assert.equal(renderer.canvasResizes.length, 0, 'The scene remains the single owner of canvas sizing');
  if (pretendWebGL) assert.ok(warnings.length - warningCount <= 1, 'Missing optional dependencies warn once without flooding frames');
  else assert.equal(warnings.length, warningCount, 'The expected no-WebGL fallback is silent');
  pipeline.dispose();
}
console.log('PASS: missing renderer/optional post-processing dependencies fall back to one direct render without extra timers.');
console.log('PASS: quality and resize preserve the scene/camera and leave canvas ownership with the scene.');
