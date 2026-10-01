import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createReadStream, readFileSync, statSync } from 'node:fs'
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
    const [url, query = ''] = String(req.url ?? '').split('?')
    if (!url.startsWith('/resources/')) return next()
    // Source files `import catalog from '../resources/x.json'` — Vite turns
    // those into `/resources/x.json?import` module requests. Serving raw JSON
    // for them (application/json) made every module fail and blanked the app.
    if (/(^|&)(import|raw|url|inline|worker|t=)/.test(query)) return next()
    if (req.headers?.['sec-fetch-dest'] === 'script') return next()
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
    name: 'newbrand-serve-resources',
    configureServer(server: any) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server: any) {
      server.middlewares.use(handler)
    },
  }
}

// base './' so the built bundle loads over file:// inside Electron
const appVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string

export default defineConfig({
  base: './',
  // One source of truth for the version shown in the sidebar.
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [react(), tailwindcss(), serveResources()],
  build: {
    // heic2any and rapier are already dynamic imports (loaded only on HEIC
    // import / physics use); they are big because they embed WASM, so the
    // warning threshold is set just above them rather than splitting further.
    chunkSizeWarningLimit: 2200,
    rollupOptions: {
      output: {
        // Split stable vendors out of the entry chunk so it stays cacheable
        // and smaller; app code changes no longer invalidate them.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|zustand)[\\/]/.test(id)) return 'vendor-react'
          if (/[\\/]node_modules[\\/]three[\\/]/.test(id)) return 'vendor-three'
          if (/[\\/]node_modules[\\/](motion|framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) return 'vendor-motion'
          if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return 'vendor-icons'
          return undefined
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'next/link': fileURLToPath(new URL('./src/shims/next/link.tsx', import.meta.url)),
      'next/navigation': fileURLToPath(new URL('./src/shims/next/navigation.ts', import.meta.url)),
      'next/server': fileURLToPath(new URL('./src/shims/next/server.ts', import.meta.url)),
      'next': fileURLToPath(new URL('./src/shims/next/index.ts', import.meta.url)),
      // NOTE: there is deliberately no `vitest` alias. It used to point at
      // src/shims/vitest.ts, whose expect() matchers were empty functions, so
      // any test bundled through this config passed without asserting
      // anything. Tests now run under the real runner (`npm test`).
      'mediabunny': fileURLToPath(new URL('./src/shims/mediabunny.ts', import.meta.url)),
      'radix-ui': fileURLToPath(new URL('./src/shims/radix-ui.tsx', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    // Allow the sandbox preview host (and any *.e2b.app proxy)
    allowedHosts: true,
  },
})
