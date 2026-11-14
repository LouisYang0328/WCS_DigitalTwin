import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(here, '..');
const assetRoot = path.join(workspaceRoot, 'assets');

/* 三维引擎、样式与模型仍放在仓库根目录的 assets/ 下：网关按 /assets 原样托管，
 * 这里只负责在 dev 时把 /assets/* 映射到工作区，免得起网关才能调试界面。 */
function workspaceAssets() {
  const types = {
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };
  return {
    name: 'wcs-workspace-assets',
    configureServer(server) {
      server.middlewares.use('/assets', (req, res, next) => {
        const rel = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, '');
        const file = path.resolve(assetRoot, rel);
        if (!file.startsWith(assetRoot) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
        res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        fs.createReadStream(file).pipe(res);
      });
    }
  };
}

export default defineConfig({
  plugins: [vue(), workspaceAssets()],
  // 产物由网关挂在 /app 下，用相对路径避免写死站点根。
  base: './',
  server: { port: 5173, open: false },
  build: {
    outDir: path.resolve(workspaceRoot, 'app'),
    emptyOutDir: true,
    assetsDir: 'bundle',
    target: 'es2020',
    sourcemap: false
  }
});
