/**
 * Resource packs.
 *
 * The packs live in *this repository*, under `resources/packs/`, and the app
 * fetches them over the internet from the raw GitHub URL for the branch it was
 * built from. Nothing is read from the user's machine and nothing is written
 * there unless they press "Download all" — which copies the packs into
 * IndexedDB so the Library keeps working with the network off.
 *
 * Resolution order for a pack:
 *   1. in-memory cache (this session)
 *   2. IndexedDB cache (previous "Download all", survives restarts)
 *   3. network — `${PACKS_BASE}/<id>.json`
 *   4. same-origin `/resources/packs/<id>.json` (desktop build ships the tree)
 *
 * Every step is attempted in order, so a cold offline start still works if the
 * user downloaded the packs once, and a fresh online start works with no cache.
 */

export type PackItemKind = 'glass' | 'transition' | 'animation' | 'background' | 'effect' | 'component' | 'voice' | 'template' | 'font' | 'skill' | 'icon' | 'block' | 'provider' | 'saas-template'

export type PackItem = {
  id: string
  kind: PackItemKind
  name: string
  description: string
  /** Free-form payload, shaped by `kind`. Kept loose so packs can evolve. */
  data?: Record<string, unknown>
  /** Optional CSS the Library can preview directly. */
  css?: string
  tags?: string[]
}

export type Pack = {
  id: string
  name: string
  description: string
  version: string
  /** Where the material originally came from, shown as a credit. */
  source: string
  license: string
  items: PackItem[]
}

export type PackIndexEntry = {
  id: string
  name: string
  description: string
  itemCount: number
  bytes: number
}

export type PackIndex = {
  version: string
  updated: string
  repo: string
  packs: PackIndexEntry[]
}

/** Raw base for the branch this session works on. */
export const PACKS_REPO = 'rangwalaaliasgar55-bot/Cupric-Ai-'
export const PACKS_BRANCH = 'arena/01a0dcbd-cupric-ai'
export const PACKS_BASE = `https://raw.githubusercontent.com/${PACKS_REPO}/${PACKS_BRANCH}/resources/packs`

/* ——— IndexedDB key/value, ~40 lines, no dependency ——— */

const DB_NAME = 'cupric-packs'
const STORE = 'packs'

function idb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  })
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await idb()
  if (!db) return null
  return new Promise((resolve) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
    req.onsuccess = () => resolve((req.result as T) ?? null)
    req.onerror = () => resolve(null)
  })
}

async function idbSet(key: string, value: unknown): Promise<boolean> {
  const db = await idb()
  if (!db) return false
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve(true)
    tx.onerror = () => resolve(false)
  })
}

async function idbKeys(): Promise<string[]> {
  const db = await idb()
  if (!db) return []
  return new Promise((resolve) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys()
    req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String))
    req.onerror = () => resolve([])
  })
}

export async function clearPackCache(): Promise<void> {
  const db = await idb()
  if (!db) return
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
  memory.clear()
}

/* ——— fetching ——— */

const memory = new Map<string, Pack | PackIndex>()

async function fetchJson<T>(url: string, timeoutMs = 12_000): Promise<T | null> {
  if (typeof fetch === 'undefined') return null
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  try {
    const res = await fetch(url, { signal: ctrl?.signal, cache: 'no-cache' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Same-origin copy. `/resources/...` is the Vite dev middleware; the relative
 * form is the mirror `vite build` copies from `public/`, which is how the
 * packaged desktop app (loaded over file://) finds the packs offline.
 */
async function fetchLocal<T>(name: string): Promise<T | null> {
  return (
    (await fetchJson<T>(`/resources/packs/${name}.json`, 4000)) ??
    (await fetchJson<T>(`./resources/packs/${name}.json`, 4000))
  )
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false
}

export async function loadPackIndex(): Promise<{ index: PackIndex | null; source: 'memory' | 'cache' | 'network' | 'local' | 'none' }> {
  const mem = memory.get('index') as PackIndex | undefined
  if (mem) return { index: mem, source: 'memory' }

  const cached = await idbGet<PackIndex>('index')
  // The network copy wins when it is reachable, so an updated repo shows up.
  const remote = isOnline() ? await fetchJson<PackIndex>(`${PACKS_BASE}/index.json`) : null
  if (remote) {
    memory.set('index', remote)
    return { index: remote, source: 'network' }
  }
  if (cached) {
    memory.set('index', cached)
    return { index: cached, source: 'cache' }
  }
  const local = await fetchLocal<PackIndex>('index')
  if (local) {
    memory.set('index', local)
    return { index: local, source: 'local' }
  }
  return { index: null, source: 'none' }
}

export async function loadPack(id: string): Promise<{ pack: Pack | null; source: 'memory' | 'cache' | 'network' | 'local' | 'none' }> {
  const mem = memory.get(id) as Pack | undefined
  if (mem) return { pack: mem, source: 'memory' }

  const cached = await idbGet<Pack>(id)
  if (cached) {
    memory.set(id, cached)
    return { pack: cached, source: 'cache' }
  }
  if (isOnline()) {
    const remote = await fetchJson<Pack>(`${PACKS_BASE}/${id}.json`)
    if (remote) {
      memory.set(id, remote)
      return { pack: remote, source: 'network' }
    }
  }
  const local = await fetchLocal<Pack>(id)
  if (local) {
    memory.set(id, local)
    return { pack: local, source: 'local' }
  }
  return { pack: null, source: 'none' }
}

/** True when every pack in the index is already in IndexedDB. */
export async function offlineStatus(): Promise<{ downloaded: string[]; total: number }> {
  const [{ index }, keys] = await Promise.all([loadPackIndex(), idbKeys()])
  const ids = index?.packs.map((p) => p.id) ?? []
  return { downloaded: ids.filter((id) => keys.includes(id)), total: ids.length }
}

/**
 * Pull every pack and store it for offline use. Reports progress 0–100 so the
 * Library can show a real bar instead of a spinner that means nothing.
 */
export async function downloadAllPacks(onProgress?: (pct: number, label: string) => void): Promise<{ ok: number; failed: string[] }> {
  const { index } = await loadPackIndex()
  if (!index) return { ok: 0, failed: ['index'] }
  await idbSet('index', index)

  const failed: string[] = []
  let ok = 0
  for (let i = 0; i < index.packs.length; i++) {
    const entry = index.packs[i]
    onProgress?.(Math.round((i / index.packs.length) * 100), entry.name)
    const { pack } = await loadPack(entry.id)
    if (pack && (await idbSet(entry.id, pack))) ok += 1
    else failed.push(entry.id)
  }
  onProgress?.(100, 'Done')
  return { ok, failed }
}
