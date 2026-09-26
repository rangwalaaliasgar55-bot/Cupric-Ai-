import JSZip from 'jszip'

/** Read an HTML file or find the primary HTML document inside a generated zip. */
export async function readGeneratedPackage(file: File): Promise<{ html: string; name: string }> {
  if (/\.html?$/i.test(file.name)) return { html: await file.text(), name: file.name }
  if (!/\.zip$/i.test(file.name)) throw new Error('Choose a .zip, .html or .htm package')
  const zip = await JSZip.loadAsync(file)
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && /\.html?$/i.test(entry.name))
  const primary = entries.find((entry) => /(^|\/)index\.html?$/i.test(entry.name)) ?? entries[0]
  if (!primary) throw new Error('This zip has no index.html or other HTML document to break down')
  return { html: await primary.async('text'), name: primary.name.split('/').pop() || file.name }
}
