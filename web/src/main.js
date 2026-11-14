import { createApp } from 'vue';
// 界面样式沿用仓库根目录的样式表，构建时由 Vite 打包，dev 时由 vite.config.js 的中间件直出。
import '../../assets/css/twin.css';
import '../../assets/css/module-navigation.css';
import '../../assets/css/platform.css';
import App from './App.vue';
import { router } from './router';
import { installBridge } from './store/twin';

// 状态桥必须在三维引擎装载前挂上：twin-scene.js 通过 window.WcsTwin 发布面板状态。
installBridge();
createApp(App).use(router).mount('#app');
