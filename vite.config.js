import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Electron loads the renderer from this dev server (port 5173) in development,
// and from the ./dist folder (relative paths) in production.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
