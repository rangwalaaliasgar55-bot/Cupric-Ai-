import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base './' so the built bundle loads over file:// inside Electron
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    // Allow the sandbox preview host (and any *.e2b.app proxy)
    allowedHosts: true,
  },
})
