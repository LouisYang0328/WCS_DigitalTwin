/* 三维引擎按顺序装载：先让 Vue 壳与加载层上屏，再解析 1.6MB 脚本，
 * 避免首屏被同步脚本解析阻塞成白屏。echarts 由 twin-scene.js 在打开看板时按需加载。 */
const ENGINE_SCRIPTS = [
  '/assets/three.min.js',
  '/assets/conveyor-layout.js',
  '/assets/conveyor-s7-mapping.js',
  '/assets/js/equipment/rack-model.js',
  '/assets/js/equipment/crane-model.js',
  '/assets/js/equipment/inventory-model.js',
  '/assets/js/equipment/conveyor-model.js',
  '/assets/js/equipment/conveyor-load.js',
  '/assets/js/equipment/pallet-magazine.js',
  '/assets/js/equipment/warehouse-lighting.js',
  '/assets/js/equipment/warehouse-environment.js',
  '/assets/vendor/three-postfx.min.js',
  '/assets/js/rendering/postprocessing.js',
  '/assets/js/api-client.js',
  '/assets/js/twin-scene.js',
  '/assets/js/module-navigation.js'
];

let loading = null;

function injectScript(src) {
  return new Promise(resolve => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => {
      console.error('模块加载失败: ' + src);
      resolve();
    };
    document.head.appendChild(script);
  });
}

/* 串行装载，保证 THREE、各模型模块、twin-scene 的依赖顺序与旧页面一致。 */
export function loadEngine() {
  if (loading) return loading;
  loading = new Promise(resolve => {
    // 两帧后再装载，确保 Vue 渲染出的 #stage 与各面板已经上屏。
    requestAnimationFrame(() => requestAnimationFrame(async () => {
      for (const src of ENGINE_SCRIPTS) await injectScript(src);
      resolve();
    }));
  });
  return loading;
}
