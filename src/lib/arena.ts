/**
 * Mocked local file ingestion: Arena zip/html imports and raw footage
 * "upload + silence analysis". All fake, all local, realistic timing.
 */

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

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
): Promise<{ durationSec: number; silenceRanges: [number, number][] }> {
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
  return { durationSec, silenceRanges: ranges }
}
