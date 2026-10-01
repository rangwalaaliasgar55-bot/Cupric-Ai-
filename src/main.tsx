import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { installDiagnostics } from './lib/diagnostics'
import { installCrashGuard, renderFatalFallback, setCrashContextProvider } from './lib/crashGuard'
import { describeBridge, getIpc } from './lib/bridge'
import { exportStudio } from './lib/studio/export'
import { registerUrl } from './lib/studio/media'
import type { StudioDoc } from './types/project'
import { rlog } from './lib/log'
import { RouteErrorBoundary } from './app-shell/ErrorBoundary'
import { useProjectStore } from './state/useProjectStore'
import { primeVoiceEngines } from './lib/voice'
import './lib/studio/proxy' // registers the auto-proxy hook (2.7)

type BackgroundExportAsset = {
  id: string
  kind: 'video' | 'image' | 'audio'
  fileName: string
  localPath: string | null
}
type BackgroundExportRequest = {
  jobId: string
  doc: StudioDoc
  assets: BackgroundExportAsset[]
  fileName?: string
  scale?: number
}

// Desktop Studio exports are farm jobs. The main process owns this offscreen
// renderer, so a user's interactive window remains responsive and the exact
// Studio compositor is still used for preview and export. The recording bytes
// go back to the main process for durable WebM/MP4 output.
const backgroundIpc = getIpc()
if (backgroundIpc) {
  backgroundIpc.on('studio:backgroundExport', (request: BackgroundExportRequest) => {
    void (async () => {
      try {
        for (const asset of request.assets || []) {
          if (!asset.localPath) continue
          const url = await backgroundIpc.invoke('arena:previewPath', asset.localPath) as string
          await registerUrl(url, asset.fileName, asset.kind, asset.localPath, asset.id)
        }
        const result = await exportStudio(request.doc, {
          fileName: request.fileName,
          scale: request.scale,
          onProgress: (pct) => { void backgroundIpc.invoke('studio:progress', { jobId: request.jobId, pct }) },
        })
        const bytes = new Uint8Array(await result.blob.arrayBuffer())
        await backgroundIpc.invoke('studio:submitRecording', { jobId: request.jobId, bytes, durationSec: result.durationSec })
      } catch (error) {
        await backgroundIpc.invoke('studio:recordingError', {
          jobId: request.jobId,
          error: error instanceof Error ? error.message : String(error),
        }).catch(() => undefined)
      }
    })()
  })
}

installDiagnostics()
installCrashGuard()
setCrashContextProvider(
  () => {
    const s = useProjectStore.getState()
    return { projectId: s.activeProjectId, view: s.view }
  },
  () => useProjectStore.getState().setView('library'),
)

// Boot log (0.10.1): how the bridge arrived. Read-only inspection — the
// bridge is never written to (see lib/bridge.ts).
rlog.info('boot', 'bridge:init', { ...describeBridge(), sinceNavigationMs: Math.round(performance.now()) })

// Offline speech engines (1.10): known before the first mic press.
void primeVoiceEngines()

const container = document.getElementById('root')
try {
  if (!container) throw new Error('#root element is missing from index.html')
  ReactDOM.createRoot(container, {
    // An error no boundary caught means React unmounted the tree: never leave
    // the window white — draw the plain-DOM card.
    onUncaughtError: (error, info) => {
      console.error('[newbrand] uncaught render error', error)
      rlog.error('crash', 'uncaught render error', { error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error), componentStack: info.componentStack })
      renderFatalFallback(error instanceof Error ? `${error.name}: ${error.message}` : String(error), error instanceof Error ? error.stack : undefined)
    },
    onCaughtError: (error, info) => {
      // Boundaries log with route context themselves; keep React's console output.
      console.error('[newbrand] error caught by boundary', error, info.componentStack)
    },
  }).render(
    <React.StrictMode>
      <RouteErrorBoundary route="app" variant="app">
        <App />
      </RouteErrorBoundary>
    </React.StrictMode>,
  )
} catch (err) {
  rlog.error('crash', 'renderer failed to start', err)
  renderFatalFallback(err instanceof Error ? `${err.name}: ${err.message}` : String(err), err instanceof Error ? err.stack : undefined)
}
