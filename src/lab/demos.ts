import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

/**
 * Lazy demo registry for the vendored UI Lab.
 *
 * Every file in `src/lab/components` default-exports a demo. Vite's glob
 * import keeps each one in its own chunk, so opening the Lab screen never
 * pulls all 190 demos into the main bundle.
 */
type DemoModule = { default: ComponentType }

const modules = import.meta.glob<DemoModule>('./components/*.tsx')

function slugOf(path: string): string {
  return path.replace('./components/', '').replace(/\.tsx$/, '')
}

/** slug -> lazy component, built once at module load. */
export const demos: Record<string, LazyExoticComponent<ComponentType>> = Object.fromEntries(
  Object.entries(modules).map(([path, loader]) => [slugOf(path), lazy(loader)]),
)

/** Slugs that actually exist on disk (registry entries without a file are skipped). */
export const availableSlugs = new Set(Object.keys(demos))

export function getDemo(slug: string): LazyExoticComponent<ComponentType> | null {
  return demos[slug] ?? null
}
