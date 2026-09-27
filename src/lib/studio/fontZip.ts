/**
 * UI-side: turn dropped files (font files or a .zip such as a Fontshare
 * download) into font entries. Kept out of userFonts.ts so the renderer's
 * font path never pulls in the zip library.
 */
import { FONT_FILE_EXT, importFontEntries, type FontFileEntry, type ImportFontsResult, type UserFontFace } from './userFonts'

export async function importFontFiles(files: File[], source: UserFontFace['source'] = 'file'): Promise<ImportFontsResult> {
  const entries: FontFileEntry[] = []
  const skipped: string[] = []
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      const { default: JSZip } = await import('jszip')
      const zip = await JSZip.loadAsync(await file.arrayBuffer())
      for (const e of Object.values(zip.files)) {
        if (e.dir || !FONT_FILE_EXT.test(e.name) || /__MACOSX|\/\._/.test(e.name)) continue
        entries.push({ name: e.name, data: await e.async('arraybuffer') })
      }
      if (!entries.length) skipped.push(`${file.name} (no font files inside)`)
    } else if (FONT_FILE_EXT.test(file.name)) entries.push({ name: file.name, data: await file.arrayBuffer() })
    else skipped.push(`${file.name} (not a font)`)
  }
  return importFontEntries(entries, source, skipped)
}
