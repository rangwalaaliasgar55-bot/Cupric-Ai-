/**
 * Local file ingestion: Arena zip/html imports and raw footage analysis.
 * Electron builds use native IPC + FFmpeg; browser preview uses real File, Web Audio,
 * object-URL previews, and ZIP/HTML parsing so it is not a fake progress demo.
 */

import { analyzeFootageFileInBrowser, importArenaFileInBrowser } from './browserMedia'
import { getIpc, getBridge } from './bridge'

type ArenaImportResult = { htmlFileName: string; thumbnailDataUrl?: string | null; localPath?: string | null }
type FootageAnalyzeResult = {
  name?: string
  durationSec: number
  silenceRanges: [number, number][]
  videoPath?: string | null
  waveform?: number[]
}

function desktopFilePath(file: File | null): string | null {
  if (!file) return null
  const bridge = getBridge()
  return bridge?.filePathFor?.(file) || ((file as any).path as string | undefined) || null
}

export async function importArenaZip(
  file: File | null,
  projectId: string,
  onProgress: (pct: number) => void,
): Promise<ArenaImportResult> {
  const ipc = getIpc()
  if (!ipc) return importArenaFileInBrowser(file, onProgress)

  onProgress(10)
  const filePath = desktopFilePath(file)
  if (filePath) {
    onProgress(35)
    const result = await ipc.invoke('arena:import', { filePath, projectId })
    onProgress(100)
    return result
  }

  if (file) return importArenaFileInBrowser(file, onProgress)

  const picked = await ipc.invoke('dialog:pickArena')
  if (!picked) throw new Error('No Arena file selected')
  onProgress(35)
  const result = await ipc.invoke('arena:import', { filePath: picked, projectId })
  onProgress(100)
  return result
}

export async function uploadFootage(
  file: File | null,
  projectId: string,
  onProgress: (pct: number) => void,
): Promise<FootageAnalyzeResult> {
  const ipc = getIpc()
  if (!ipc) return analyzeFootageFileInBrowser(file, onProgress)

  const srcPath = desktopFilePath(file)
  if (srcPath) {
    onProgress(10)
    const result = await ipc.invoke('footage:analyze', { srcPath, projectId })
    onProgress(100)
    return result
  }

  if (file) return analyzeFootageFileInBrowser(file, onProgress)

  const picked = await ipc.invoke('dialog:pickFootage')
  if (!picked) throw new Error('No footage selected')
  onProgress(10)
  const result = await ipc.invoke('footage:analyze', { srcPath: picked, projectId })
  onProgress(100)
  return result
}
