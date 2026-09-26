import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createReadStream, statSync } from 'node:fs'
import path from 'node:path'

/**
 * Serve `resources/` over HTTP in dev and preview.
 *
 * The packs live in the repo and are normally fetched from the raw GitHub URL;
 * this middleware is the same-origin fallback (`/resources/packs/...`) so the
 * Library also works with no network at all.
 */
function serveResources() {
  const rootDir = fileURLToPath(new URL('./resources', import.meta.url))
  const handler = (req: any, res: any, next: () => void) => {
    const url: string = (req.url ?? '').split('?')[0]
    if (!url.startsWith('/resources/')) return next()
    const rel = decodeURIComponent(url.slice('/resources/'.length))
    const file = path.join(rootDir, rel)
    // Never escape the resources directory.
    if (!file.startsWith(rootDir)) {
      res.statusCode = 403
      return res.end('Forbidden')
    }
    try {
      if (!statSync(file).isFile()) return next()
    } catch {
      return next()
    }
    const ext = path.extname(file).toLowerCase()
    const type =
      ext === '.json' ? 'application/json' :
      ext === '.html' ? 'text/html' :
      ext === '.css' ? 'text/css' :
      ext === '.js' ? 'text/javascript' :
      ext === '.svg' ? 'image/svg+xml' :
      ext === '.png' ? 'image/png' :
      ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
      'application/octet-stream'
    res.setHeader('Content-Type', type)
    createReadStream(file).pipe(res)
  }
  return {
    name: 'cupric-serve-resources',
    configureServer(server: any) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server: any) {
      server.middlewares.use(handler)
    },
  }
}

// base './' so the built bundle loads over file:// inside Electron
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), serveResources()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    // Allow the sandbox preview host (and any *.e2b.app proxy)
    allowedHosts: true,
  },
})
