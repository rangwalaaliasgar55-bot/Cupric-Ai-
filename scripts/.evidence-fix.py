#!/usr/bin/env python3
"""Point the evidence runner at the real entry points (planLocally + loadCatalogue)."""
import io

p = 'scripts/lib/pipeline-evidence.mjs'
s = io.open(p, encoding='utf-8').read()

old = """/**
 * Run every brief and return both the shapes and the raw rundowns.
 *
 * `deps.plan` is the app's own local planner; a caller may inject a different
 * one (the tests do, to check the failure path) but the default is the shipped
 * code.
 */
export async function runEvidence(root = process.cwd(), briefs = EVIDENCE_BRIEFS) {
  const m = await loadAutomationModules(root)
  const deps = m.run.makeDeps()
  const shapes = []
  for (const brief of briefs) {
    // The same intake the UI builds from the form.
    const intake = m.plan.intakeFromBrief({
      brief: brief.brief,
      aspect: '16:9',
      fps: 30,
      quality: 'draft',
    })
    const planned = await deps.plan(intake)
    shapes.push(shapeOf(brief, planned, planned.rundown))
  }
  return { shapes, modules: m }
}"""
new = """/**
 * Run every brief through the app's own planner and return what came out.
 *
 * `planLocally` is the shipped, deterministic path the renderer calls when there
 * is no model configured — the same function `makeDeps().plan` wraps. Calling it
 * directly means the evidence measures the real planner and not a wrapper.
 */
export async function runEvidence(root = process.cwd(), briefs = EVIDENCE_BRIEFS) {
  const m = await loadAutomationModules(root)
  const catalogue = await m.plan.loadCatalogue()
  const shapes = []
  for (const brief of briefs) {
    const planned = m.plan.planLocally(
      { brief: brief.brief, aspect: '16:9', fps: 30, quality: 'draft' },
      catalogue,
    )
    shapes.push(shapeOf(brief, planned, planned.rundown))
  }
  return { shapes, modules: m }
}"""
assert s.count(old) == 1, 'runEvidence'
s = s.replace(old, new, 1)

io.open(p, 'w', encoding='utf-8').write(s)
print('evidence runner fixed')
