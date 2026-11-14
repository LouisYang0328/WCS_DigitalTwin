/* Three r149 screen-space contact shading. The scene owns its renderer, camera,
 * canvas sizing and animation loop; this module only owns offscreen passes.
 * Vendor source/integrity: assets/vendor/three-postfx.sources.json.
 */
(function (global) {
  'use strict';
  const qualities = Object.freeze({
    performance: { scale: 1, maxDpr: 1.5, radius: 0, intensity: 0 },
    // 接触阴影抬到 0.32/0.34：货架立柱与横梁的夹角本来就是暗的，
    // 这一点点加深比加灯更能让钢架从背景里立起来。
    balanced: { scale: 1, maxDpr: 1.75, radius: 0.38, intensity: 0.38 },
    high: { scale: 1, maxDpr: 2, radius: 0.48, intensity: 0.46 }
  });

  function create(options) {
    const opts = options || {};
    const renderer = opts.renderer, scene = opts.scene, camera = opts.camera;
    if (!renderer || typeof renderer.render !== 'function' || !scene || !camera)
      throw new Error('Postprocessing requires a renderer, scene and camera.');
    const T = global.THREE;
    let width = dimension(opts.width ?? renderer.domElement?.clientWidth ?? renderer.domElement?.width);
    let height = dimension(opts.height ?? renderer.domElement?.clientHeight ?? renderer.domElement?.height);
    let pipeline = null, warned = false, disposed = false;
    const visibilityCache = new Map();
    const stats = { quality: 'balanced', mode: 'direct', enabled: false, fallbackReason: null,
      width, height, renderWidth: width, renderHeight: height, renderScale: 1, gammaCorrection: false,
      aoRadius: 0, aoIntensity: 0, beautySamples: 0, lastNormalExcluded: 0, frames: 0, disposed: false };

    function dimension(value) { return Math.max(1, Math.round(Number(value) || 1)); }
    function warnOnce(reason) {
      if (!warned && global.console?.warn) {
        warned = true;
        global.console.warn('WCS postprocessing disabled; direct rendering remains active. ' + reason);
      }
    }
    function restoreVisibility() {
      visibilityCache.forEach((visible, object) => { object.visible = visible; });
      visibilityCache.clear();
    }
    function excludeFromNormals(object) {
      if (object.isSprite || object.isLine || object.isPoints || object.userData?.noShadow || object.userData?.noAO)
        return true;
      const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      return materials.some(material => material.transparent || material.opacity <= 0.001 || material.colorWrite === false || material.visible === false);
    }
    function filterNormals() {
      restoreVisibility();
      scene.traverse(object => {
        if (excludeFromNormals(object)) {
          visibilityCache.set(object, object.visible);
          object.visible = false;
        }
      });
      stats.lastNormalExcluded = visibilityCache.size;
    }
    function snapshotRenderer() {
      return { target: renderer.getRenderTarget(), autoClear: renderer.autoClear,
        clearColor: renderer.getClearColor(new T.Color()), clearAlpha: renderer.getClearAlpha(),
        overrideMaterial: scene.overrideMaterial, shadowAutoUpdate: renderer.shadowMap?.autoUpdate };
    }
    function restoreRenderer(saved) {
      restoreVisibility();
      scene.overrideMaterial = saved.overrideMaterial;
      renderer.autoClear = saved.autoClear;
      if (renderer.shadowMap) renderer.shadowMap.autoUpdate = saved.shadowAutoUpdate;
      renderer.setClearColor(saved.clearColor, saved.clearAlpha);
      renderer.setRenderTarget(saved.target);
    }
    function releasePipeline() {
      if (!pipeline) return;
      const current = pipeline; pipeline = null;
      // r149 SSAOPass.dispose omits these two owned resources.
      current.ssao.noiseTexture?.dispose();
      current.ssao.ssaoMaterial?.dispose();
      current.ssao.dispose(); current.gamma.dispose(); current.fxaa.dispose(); current.composer.dispose();
    }
    function fallback(reason, shouldWarn) {
      restoreVisibility();
      releasePipeline();
      stats.mode = 'direct'; stats.enabled = false; stats.fallbackReason = reason;
      stats.renderScale = 1; stats.renderWidth = width; stats.renderHeight = height;
      stats.aoRadius = 0; stats.aoIntensity = 0; stats.beautySamples = 0; stats.gammaCorrection = false;
      if (shouldWarn) warnOnce(reason);
    }
    function renderSize() {
      const config = qualities[stats.quality];
      const dpr = Math.min(config.maxDpr, Math.max(1, Number(renderer.getPixelRatio()) || 1));
      const maximum = Math.max(1, renderer.capabilities?.maxTextureSize || 8192);
      let scale = config.scale * dpr;
      scale = Math.min(scale, maximum / width, maximum / height);
      stats.renderScale = config.scale;
      stats.renderWidth = Math.max(1, Math.round(width * scale));
      stats.renderHeight = Math.max(1, Math.round(height * scale));
    }
    function updateCameraUniforms() {
      if (!pipeline) return;
      const pass = pipeline.ssao, config = qualities[stats.quality];
      const range = Math.max(1, camera.far - camera.near);
      pass.kernelRadius = config.radius;
      // SSAOShader compares orthographic-normalized depth. Define contact
      // thresholds in metres so changing the far plane does not erase shading.
      pass.minDistance = 0.025 / range; pass.maxDistance = config.radius * 1.6 / range;
      pass.ssaoMaterial.uniforms.cameraNear.value = camera.near;
      pass.ssaoMaterial.uniforms.cameraFar.value = camera.far;
      pass.ssaoMaterial.uniforms.cameraProjectionMatrix.value.copy(camera.projectionMatrix);
      pass.ssaoMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);
      pipeline.gamma.enabled = renderer.outputEncoding === T.sRGBEncoding;
      stats.gammaCorrection = pipeline.gamma.enabled;
    }
    function checkFramebuffers(gl, targets) {
      const previous = renderer.getRenderTarget();
      try {
        targets.forEach(target => {
          renderer.setRenderTarget(target);
          if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
            throw new Error('framebuffer-incomplete');
        });
      } finally { renderer.setRenderTarget(previous); }
    }
    function initialize() {
      if (!renderer.isWebGLRenderer || typeof renderer.getContext !== 'function')
        return fallback('renderer-unavailable', false);
      const C = global.WcsPostFXComponents;
      if (!T || !C?.EffectComposer || !C.SSAOPass || !C.ShaderPass || !C.GammaCorrectionShader || !C.FXAAShader)
        return fallback('components-unavailable', true);
      if (T.REVISION !== '149' || C.THREE_REVISION !== '149') return fallback('three-version-mismatch', true);
      let composer, ssao, gamma, fxaa;
      try {
        const gl = renderer.getContext();
        if (!gl || typeof gl.checkFramebufferStatus !== 'function' || gl.isContextLost?.())
          throw new Error('webgl-context-unavailable');
        if (!renderer.capabilities?.isWebGL2 &&
            (!renderer.extensions?.has('WEBGL_depth_texture') || !renderer.extensions?.has('OES_texture_float')))
          throw new Error('depth-texture-unavailable');
        renderSize();
        const target = new T.WebGLRenderTarget(stats.renderWidth, stats.renderHeight, { depthBuffer: false, stencilBuffer: false });
        composer = new C.EffectComposer(renderer, target);
        ssao = new C.SSAOPass(scene, camera, stats.renderWidth, stats.renderHeight);
        // The renderer's canvas antialias flag does not apply to offscreen
        // targets. Preserve thin steel members with colour-pass MSAA only;
        // the normal/depth target stays single-sample for portable depth reads.
        if (renderer.capabilities.isWebGL2) {
          const limit = Number(renderer.capabilities.maxSamples);
          ssao.beautyRenderTarget.samples = Math.max(0, Math.min(4, Number.isFinite(limit) ? limit : 4));
        }
        stats.beautySamples = ssao.beautyRenderTarget.samples;
        gamma = new C.ShaderPass(C.GammaCorrectionShader);
        fxaa = new C.ShaderPass(C.FXAAShader);
        gamma.material.toneMapped = false; fxaa.material.toneMapped = false;
        // ANGLE/D3D clamps the original -100 LOD bias to -16 and emits a
        // warning. Both select the finest available mip; use the valid bound.
        fxaa.material.fragmentShader = fxaa.material.fragmentShader.replaceAll('-100.0', '-16.0');
        ssao.normalMaterial.toneMapped = false;
        // Suppress unstable subpixel occlusion in distant rack/roller details.
        // Contact shading is fully active once the kernel covers 5.5 pixels.
        const occlusionAnchor = 'occlusion = clamp( occlusion / float( KERNEL_SIZE ), 0.0, 1.0 );';
        ssao.ssaoMaterial.fragmentShader = ssao.ssaoMaterial.fragmentShader.replace(occlusionAnchor,
          occlusionAnchor + '\nfloat projectedRadius = kernelRadius * abs(cameraProjectionMatrix[1][1]) * resolution.y / (2.0 * max(-viewZ, 0.001));\nocclusion *= smoothstep(1.5, 5.5, projectedRadius);');

        // r149's stock normal override only hides lines/points. Its override
        // material otherwise turns invisible hit boxes and sprites into opaque
        // occluders. Replace visibility handling, and restore even on GL errors.
        ssao.overrideVisibility = filterNormals;
        ssao.restoreVisibility = restoreVisibility;
        const originalOverride = ssao.renderOverride;
        ssao.renderOverride = function (activeRenderer, ...args) {
          const saved = snapshotRenderer();
          try {
            if (activeRenderer.shadowMap) activeRenderer.shadowMap.autoUpdate = false;
            return originalOverride.call(this, activeRenderer, ...args);
          } finally { restoreRenderer(saved); }
        };
        // Retain the official pass's AO multiplication but soften its strength
        // with alpha blending: beauty * (1 - strength + strength * AO).
        const originalRenderPass = ssao.renderPass;
        // r149 CopyShader scales alpha only. Scale RGB as well before using
        // DstColor blending, otherwise an unoccluded pixel becomes
        // beauty * (2 - strength) and the whole frame is overexposed.
        ssao.copyMaterial.fragmentShader = ssao.copyMaterial.fragmentShader.replace(
          /gl_FragColor\.a\s*\*=\s*opacity\s*;/, 'gl_FragColor *= opacity;');
        ssao.copyMaterial.blendDst = T.OneMinusSrcAlphaFactor;
        ssao.copyMaterial.blendDstAlpha = T.OneMinusSrcAlphaFactor;
        ssao.renderPass = function (activeRenderer, material, ...args) {
          if (material === this.copyMaterial) material.uniforms.opacity.value =
            material.blending === T.CustomBlending ? qualities[stats.quality].intensity : 1;
          return originalRenderPass.call(this, activeRenderer, material, ...args);
        };
        composer.addPass(ssao); composer.addPass(gamma); composer.addPass(fxaa);
        pipeline = { composer, ssao, gamma, fxaa, gl, firstFrame: true };
        composer.setSize(stats.renderWidth, stats.renderHeight);
        fxaa.uniforms.resolution.value.set(1 / stats.renderWidth, 1 / stats.renderHeight);
        updateCameraUniforms();
        checkFramebuffers(gl, [composer.renderTarget1, composer.renderTarget2, ssao.beautyRenderTarget,
          ssao.normalRenderTarget, ssao.ssaoRenderTarget, ssao.blurRenderTarget]);
        stats.mode = 'ssao'; stats.enabled = true; stats.fallbackReason = null;
        stats.aoRadius = qualities[stats.quality].radius; stats.aoIntensity = qualities[stats.quality].intensity;
      } catch (error) {
        // Constructors may fail before all passes have been attached.
        if (!pipeline) {
          ssao?.noiseTexture?.dispose(); ssao?.ssaoMaterial?.dispose(); ssao?.dispose();
          gamma?.dispose(); fxaa?.dispose(); composer?.dispose();
        }
        fallback(error.message || 'initialization-failed', true);
      }
    }
    function setQuality(value) {
      if (disposed) return;
      const quality = Object.hasOwn(qualities, value) ? value : 'balanced';
      if (quality === stats.quality && pipeline) return;
      releasePipeline(); stats.quality = quality;
      if (quality === 'performance') fallback(null, false);
      else initialize();
    }
    function resize(nextWidth, nextHeight) {
      if (disposed) return;
      width = dimension(nextWidth); height = dimension(nextHeight);
      stats.width = width; stats.height = height;
      if (!pipeline) { stats.renderWidth = width; stats.renderHeight = height; return; }
      try {
        renderSize(); pipeline.composer.setSize(stats.renderWidth, stats.renderHeight);
        pipeline.fxaa.uniforms.resolution.value.set(1 / stats.renderWidth, 1 / stats.renderHeight);
        updateCameraUniforms(); pipeline.firstFrame = true;
      } catch (error) { fallback(error.message || 'resize-failed', true); }
    }
    function render() {
      if (disposed) return;
      stats.frames++;
      if (!pipeline) { renderer.render(scene, camera); return; }
      const saved = snapshotRenderer();
      let failure = null;
      try {
        updateCameraUniforms();
        pipeline.composer.render(0);
        if (pipeline.firstFrame) {
          pipeline.firstFrame = false;
          const failedProgram = renderer.info?.programs?.some(program => program.diagnostics?.runnable === false);
          if (failedProgram) throw new Error('postprocessing-shader-unavailable');
          if (pipeline.gl.getError?.() !== pipeline.gl.NO_ERROR) throw new Error('postprocessing-webgl-error');
        }
      } catch (error) { failure = error; }
      finally { restoreRenderer(saved); }
      if (failure) {
        fallback(failure.message || 'render-failed', true);
        renderer.render(scene, camera);
      }
    }
    function dispose() {
      if (disposed) return;
      disposed = true; restoreVisibility(); releasePipeline();
      stats.enabled = false; stats.mode = 'direct'; stats.disposed = true;
    }

    setQuality(opts.quality || 'balanced');
    return { render, resize, setQuality, dispose, stats };
  }

  global.WcsPostProcessing = Object.freeze({ create });
})(window);
