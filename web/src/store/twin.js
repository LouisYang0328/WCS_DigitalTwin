import { reactive } from 'vue';

/* 引擎与界面之间唯一的状态通道：
 *   引擎（twin-scene.js）只调用 publish(path, value) 产出状态快照；
 *   面板/看板组件直接读 twin 上的响应式状态渲染，不再被引擎写 DOM；
 *   组件里的操作走 callEngine(name, ...args) 回到引擎。
 * 路径按段定位（如 'left.kpis'），引擎侧自带签名比对，只在内容变化时发布。 */

function initialState() {
  return {
    engine: { ready: false },
    left: {
      floorTag: '1F',
      kpis: { total: 600, occupancy: null, tasks: 0, alarms: 0 },
      devices: { total: 0, items: [] },
      aisles: [],
      lineMap: { floorTag: '1F', groups: [] },
      controls: { speed: 1, paused: false }
    },
    right: {
      // kind: empty | crane | conveyor | cell
      selection: { kind: 'empty' },
      tasks: [],
      alarms: []
    },
    dash: {
      open: false,
      opened: false,
      domain: 'all',
      snapshot: null,
      log: [],
      clock: { time: '00:00:00', date: '----' },
      updatedAt: '--:--:--'
    },
    // 第一视角：placing=等待点击地面就位，active=已就位；
    // nearby 为按距离排序的周边设备清单（含相对方位与距离）。
    fpv: {
      active: false,
      placing: false,
      floor: '1F',
      x: 0,
      z: 0,
      nearby: []
    }
  };
}

export const twin = reactive(initialState());

let commands = null;

export function publish(path, value) {
  const keys = String(path).split('.');
  let node = twin;
  for (let i = 0; i < keys.length - 1; i++) {
    node = node[keys[i]];
    if (!node) return;
  }
  node[keys[keys.length - 1]] = value;
}

export function bindEngine(api) {
  commands = api && typeof api === 'object' ? api : null;
  twin.engine.ready = Boolean(commands);
}

/* 引擎未就绪前点击只是空操作：加载期只持续一两秒，排队反而会让按钮回放一堆旧点击。 */
export function callEngine(name, ...args) {
  if (!commands || typeof commands[name] !== 'function') return undefined;
  return commands[name](...args);
}

let installed = false;

export function installBridge() {
  if (installed) return window.WcsTwin;
  installed = true;
  window.WcsTwin = Object.freeze({
    state: twin,
    publish,
    bind: bindEngine
  });
  return window.WcsTwin;
}
