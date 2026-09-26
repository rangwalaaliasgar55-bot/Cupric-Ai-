import { categories, lab, type LabEntry } from "./registry";

// The reading order of the whole lab: by category, alphabetical within each.
// The sidebar lists it and the previous / next links on a component page
// walk it, so the two always agree.
export const groups = categories.map((c) => ({
  ...c,
  items: lab
    .filter((e) => e.category === c.id)
    .sort((a, b) => a.name.localeCompare(b.name)),
}));

export const ordered: LabEntry[] = groups.flatMap((g) => g.items);

export function neighbours(slug: string) {
  const i = ordered.findIndex((e) => e.slug === slug);
  return {
    previous: i > 0 ? ordered[i - 1] : undefined,
    next: i >= 0 && i < ordered.length - 1 ? ordered[i + 1] : undefined,
  };
}
