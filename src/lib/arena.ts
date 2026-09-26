/**
 * Local file ingestion: Arena zip/html imports and raw footage analysis.
 * Electron builds use native IPC + FFmpeg; web preview keeps deterministic mocks.
 */

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

type ArenaImportResult = { htmlFileName: string; thumbnailDataUrl?: string | null; localPath?: string | null }
type FootageAnalyzeResult = {
  durationSec: number
  silenceRanges: [number, number][]
  videoPath?: string | null
  waveform?: number[]
}

export async function fakeImportArenaZip(
  file: File | null,
  onProgress: (pct: number) => void,
): Promise<{ htmlFileName: string }> {
  const base = file
    ? file.name.replace(/\.(zip|html?)$/i, '')
    : `arena-winner-${Math.floor(Math.random() * 900 + 100)}`
  const steps = [6, 19, 38, 57, 74, 88, 96, 100]
  for (const pct of steps) {
    await wait(120 + Math.random() * 160)
    onProgress(pct)
  }
  return { htmlFileName: `${base}.html` }
}

export async function fakeUploadFootage(
  _file: File | null,
  onProgress: (pct: number) => void,
): Promise<{ durationSec: number; silenceRanges: [number, number][]; waveform: number[] }> {
  const steps = [4, 14, 30, 52, 71, 86, 95, 100]
  for (const pct of steps) {
    await wait(180 + Math.random() * 200)
    onProgress(pct)
  }
  const durationSec = Math.round((26 + Math.random() * 52) * 10) / 10
  const ranges: [number, number][] = []
  const count = 2 + Math.floor(Math.random() * 2)
  let t = 2 + Math.random() * 6
  for (let i = 0; i < count && t < durationSec - 6; i++) {
    const len = 1.4 + Math.random() * 3
    const end = Math.min(Math.round((t + len) * 10) / 10, durationSec - 1)
    ranges.push([Math.round(t * 10) / 10, end])
    t += len + 8 + Math.random() * 14
  }
  const waveform = Array.from({ length: 88 }, (_, i) => {
    const pulse = Math.abs(Math.sin(i * 0.29)) * 0.55
    return Math.max(0.08, Math.min(1, pulse + 0.15 + Math.random() * 0.22))
  })
  return { durationSec, silenceRanges: ranges, waveform }
}

export async function importArenaZip(
  file: File | null,
  projectId: string,
  onProgress: (pct: number) => void,
): Promise<ArenaImportResult> {
  const ipc = (window as any).northframe?.ipc
  if (!ipc) return { ...(await fakeImportArenaZip(file, onProgress)), thumbnailDataUrl: null, localPath: null }

  onProgress(10)
  const filePath = ((file as any)?.path as string | undefined) || (await ipc.invoke('dialog:pickArena'))
  if (!filePath) throw new Error('No Arena file selected')
  onProgress(35)
  const result = await ipc.invoke('arena:import', { filePath, projectId })
  onProgress(100)
  return result
}

export async function uploadFootage(
  file: File | null,
  projectId: string,
  onProgress: (pct: number) => void,
): Promise<FootageAnalyzeResult> {
  const ipc = (window as any).northframe?.ipc
  if (!ipc) return fakeUploadFootage(file, onProgress)

  const srcPath = ((file as any)?.path as string | undefined) || (await ipc.invoke('dialog:pickFootage'))
  if (!srcPath) throw new Error('No footage selected')
  onProgress(10)
  const result = await ipc.invoke('footage:analyze', { srcPath, projectId })
  onProgress(100)
  return result
}
