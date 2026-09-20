import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createProxyTolerantLogger } from './src/vite-proxy-logger.js';

export default defineConfig({
  plugins: [react()],
  customLogger: createProxyTolerantLogger(),
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8080', changeOrigin: false, ws: true },
    },
  },
});
