/**
 * Offscreen export host (F-4).
 *
 * The main process hands a whole Studio document to a hidden window and asks
 * it to record. That path needs the entire compositor — `renderer.ts` and the
 * kit, phone, shape and HTML-import modules behind it — which is a quarter of
 * a megabyte of JavaScript that an interactive window never runs.
 *
 * So it lives here, behind a dynamic import that only resolves when an export
 * job actually arrives. `main.tsx` keeps the (free) IPC listener; the code
 * below is fetched the first time a job is handed over.
 */
import { exportStudio } from './export'
import { registerUrl } from './media'
import type { StudioDoc } from '../../types/project'

export type BackgroundExportAsset = {
  id: string
  kind: 'video' | 'image' | 'audio'
  fileName: string
  localPath: string | null
  /** Pre-resolved file:// URL from the main process (F-2). */
  url?: string
  /** Set when the sandbox refused the path — skip it, never fail the batch. */
  unusable?: string
}

export type BackgroundExportRequest = {
  jobId: string
  doc: StudioDoc
  assets: BackgroundExportAsset[]
  fileName?: string
  scale?: number
}

type Ipc = {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
}

export async function runBackgroundExport(ipc: Ipc, request: BackgroundExportRequest): Promise<void> {
  // F-2: the main process already resolved each asset against the
  // project-data sandbox, so a single unreadable clip is skipped with a
  // logged reason instead of failing the whole export batch.
  for (const asset of request.assets || []) {
    if (!asset.localPath || asset.unusable) continue
    try {
      const url = asset.url || (await ipc.invoke('arena:previewPath', asset.localPath) as string)
      await registerUrl(url, asset.fileName, asset.kind, asset.localPath, asset.id)
    } catch (assetError) {
      await ipc.invoke('log:write', {
        level: 'warn',
        scope: 'export-asset-skipped',
        message: assetError instanceof Error ? assetError.message : String(assetError),
        data: { jobId: request.jobId, asset: asset.id },
      }).catch(() => undefined)
    }
  }
  const result = await exportStudio(request.doc, {
    fileName: request.fileName,
    scale: request.scale,
    onProgress: (pct) => { void ipc.invoke('studio:progress', { jobId: request.jobId, pct }) },
  })
  const bytes = new Uint8Array(await result.blob.arrayBuffer())
  await ipc.invoke('studio:submitRecording', { jobId: request.jobId, bytes })
}
