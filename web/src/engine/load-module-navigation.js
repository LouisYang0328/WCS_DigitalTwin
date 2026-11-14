/* 顶栏模块导航的弹层交互（外点关闭、Esc、单开）由 assets/js/module-navigation.js 提供。
 * 三维引擎装载时会顺带注入它；直达工程页（不载引擎）也需要同样的弹层行为，
 * 这里按需注入一次。脚本自身带 window.WcsModuleNavigation 守卫，重复注入不会重复初始化。 */
let injected = false;

export function ensureModuleNavigation() {
  if (injected || window.WcsModuleNavigation) return;
  injected = true;
  const script = document.createElement('script');
  script.src = '/assets/js/module-navigation.js';
  document.head.appendChild(script);
}
