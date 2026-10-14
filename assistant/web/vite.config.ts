import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Stili Liquid Glass presi direttamente dalla Liquid Dashboard (solo CSS, nessun JS condiviso).
const ldStyles = fileURLToPath(new URL('../../frontend/src/styles', import.meta.url))

export default defineConfig({
  plugins: [react()],
  // Percorsi relativi: l'interfaccia vive sotto il percorso ingress variabile di HA.
  base: './',
  resolve: { alias: { '@ld': ldStyles } },
  define: { __APP_VERSION__: JSON.stringify(process.env.ASSISTANT_VERSION || 'dev') },
  build: {
    outDir: process.env.ASSISTANT_WEB_OUT || 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    fs: { allow: ['..', '../../frontend/src/styles'] },
    // In sviluppo il server Node gira su 127.0.0.1:8099 (npm run dev:server).
    proxy: {
      '/api': 'http://127.0.0.1:8099',
      '/healthz': 'http://127.0.0.1:8099',
    },
  },
})
