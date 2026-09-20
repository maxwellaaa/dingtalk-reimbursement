import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

/** 钉钉/部分 WebView 会去掉尾斜杠，/h5 → 404；强制跳到 /h5/ */
function redirectH5Slash() {
  return {
    name: 'redirect-h5-slash',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const raw = req.url || '';
        const pathOnly = raw.split('?')[0];
        if (pathOnly === '/h5') {
          const qs = raw.includes('?') ? raw.slice(raw.indexOf('?')) : '';
          res.statusCode = 302;
          res.setHeader('Location', `/h5/${qs}`);
          res.end();
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [vue(), redirectH5Slash()],
  base: '/h5/',
  server: {
    host: '0.0.0.0',
    port: 5173,
    // 钉钉穿透域名（cpolar / ngrok 等）访问时需放行 Host
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
