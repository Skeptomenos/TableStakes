import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Phone clients connect to the Node server; during development Vite serves the
// client and proxies server routes so /g/<code> URLs behave like production.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    host: true,
    proxy: {
      '/healthz': 'http://localhost:8080',
      '/socket.io': {
        target: 'http://localhost:8080',
        ws: true,
      },
    },
  },
})
