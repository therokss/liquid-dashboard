import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://homeassistant.local:8123',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://homeassistant.local:8123',
        changeOrigin: true,
      },
    },
  },
})
