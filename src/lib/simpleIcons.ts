/**
 * Simple Icons (simpleicons.org, CC0) — brand-name → slug using the project's
 * own title→slug rules, and the CDN URL for a single-colour SVG.
 */
export function simpleIconSlug(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/\+/g, 'plus')
    .replace(/^\./, 'dot-')
    .replace(/\.$/, '-dot')
    .replace(/\./g, 'dot')
    .replace(/^&/, 'and-')
    .replace(/&$/, '-and')
    .replace(/&/g, 'and')
    .replace(/đ/g, 'd')
    .replace(/ħ/g, 'h')
    .replace(/ı/g, 'i')
    .replace(/ĸ/g, 'k')
    .replace(/ŀ/g, 'l')
    .replace(/ł/g, 'l')
    .replace(/ß/g, 'ss')
    .replace(/ŧ/g, 't')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

export function simpleIconUrl(slug: string, hex?: string): string {
  const color = hex && /^[0-9a-f]{6}$/i.test(hex) ? `/${hex.toLowerCase()}` : ''
  return `https://cdn.simpleicons.org/${slug}${color}`
}
