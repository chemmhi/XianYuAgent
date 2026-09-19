import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: process.env.VITE_API_PROXY_TARGET ? {
      '/api': { target: process.env.VITE_API_PROXY_TARGET, changeOrigin: false },
    } : undefined,
  },
});
