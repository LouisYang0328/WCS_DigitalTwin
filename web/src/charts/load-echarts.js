/* echarts 约 1MB，首屏用不到：第一次打开看板时由图表组件按需加载，
 * 之后复用同一个 Promise，避免重复插脚本。 */
let loader = null;

export function loadEcharts() {
  if (window.echarts) return Promise.resolve(window.echarts);
  if (loader) return loader;
  loader = new Promise(resolve => {
    const script = document.createElement('script');
    script.src = '/assets/echarts.min.js';
    script.async = true;
    script.onload = () => resolve(window.echarts || null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return loader;
}
