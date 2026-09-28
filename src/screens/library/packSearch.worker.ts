/* Search index work stays off the React thread when a pack is large. */
type SearchItem = { id: string; name?: string; description?: string; tags?: string[] }

type SearchRequest = { items: SearchItem[]; query: string }

const worker = self as unknown as { onmessage: ((event: MessageEvent<SearchRequest>) => void) | null; postMessage: (value: unknown) => void }

worker.onmessage = (event) => {
  const query = String(event.data?.query || '').trim().toLowerCase()
  const matches = !query
    ? event.data.items.map((item) => item.id)
    : event.data.items.filter((item) => {
        const haystack = `${item.name || ''} ${item.description || ''} ${(item.tags || []).join(' ')}`.toLowerCase()
        return haystack.includes(query)
      }).map((item) => item.id)
  worker.postMessage({ query, ids: matches })
}

export {}
