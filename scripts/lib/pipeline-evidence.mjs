#!/usr/bin/env node
/**
 * Run the Autonomous pipeline on real briefs and *measure* what came out.
 *
 * Phase 1.2 asked for the pipeline to be shown working "10+ times with varied
 * real inputs, confirming outputs differ meaningfully". Grepping for the word
 * "steps" does not show that. This module runs the shipped planning path — the
 * same `planLocally` the app calls — over a set of briefs and returns what each
 * one actually produced, so a caller can assert the differences.
 *
 * It is a module, not a script half, because `scripts/check-automation-steps.mjs`
 * asserts against it and `docs/PHASE1_AUTONOMOUS.md` reports the same numbers —
 * one code path, so the document cannot claim something the check does not run.
 *
 * The TS is bundled with esbuild the way the other checks do it (the repo has no
 * ts-node). Nothing here touches the network: `planLocally` is the keyless path.
 */
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

/**
 * Twelve briefs: different lengths (including the same length twice with
 * different content), different scene counts, different tones, one in Devanagari
 * and one deliberately vague.
 */
export const EVIDENCE_BRIEFS = [
  { id: 'bakery-sting', brief: 'A 6-second logo sting for a bakery called Crumb, warm and hand-made', durationSec: 6 },
  { id: 'payments', brief: 'An 11-second explainer for a payments API, developer audience', durationSec: 11 },
  { id: 'trailer', brief: 'A 17-second product trailer for a folding standing desk', durationSec: 17 },
  { id: 'podcast', brief: 'A 23-second podcast teaser about urban gardening', durationSec: 23 },
  { id: 'onboarding', brief: 'A 31-second onboarding walkthrough for warehouse software, forklift drivers', durationSec: 31 },
  { id: 'same-length-different-1', brief: 'A 17-second recruitment ad for a rural nursing programme', durationSec: 17 },
  { id: 'same-length-different-2', brief: 'A 17-second announcement that a ferry timetable has changed', durationSec: 17 },
  { id: 'no-duration', brief: 'A short social clip announcing that registration is open', durationSec: null },
  { id: 'hindi', brief: 'स्मार्ट बचत ऐप के लिए 20 सेकंड का विज्ञापन', durationSec: 20 },
  { id: 'vertical', brief: 'A 12-second vertical promo for a sneaker drop, aspect 9:16', durationSec: 12 },
  { id: 'long-copy', brief: 'A 45-second explainer for municipal water billing with four distinct points to cover', durationSec: 45 },
  { id: 'vague', brief: 'make something good', durationSec: null },
]

/**
 * Load the shipped planning modules. Cached in `node_modules/.cache`, which the
 * repo already excludes, so repeated runs do not re-bundle.
 */
export async function loadAutomationModules(root = process.cwd()) {
  const out = path.join(root, 'node_modules', '.cache', 'cupric-pipeline-evidence.mjs')
  mkdirSync(path.dirname(out), { recursive: true })
  rmSync(out, { force: true })
  await build({
    stdin: {
      contents: [
        "export * as plan from './src/lib/automation/plan'",
        "export * as run from './src/lib/automation/run'",
        "export * as design from './src/lib/studio/design'",
      ].join('\n'),
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    logLevel: 'silent',
  })
  return import(`${pathToFileURL(out).href}?t=${Date.now()}`)
}

/** A stable, comparable shape for one brief's output. */
export function shapeOf(brief, planned, rundown) {
  const scenes = rundown.scenes ?? []
  const sceneTypes = scenes.map((s) => s.type)
  return {
    id: brief.id,
    brief: brief.brief,
    durationSec: rundown.durationSec,
    fps: rundown.fps,
    size: `${rundown.size?.[0]}x${rundown.size?.[1]}`,
    aspect: planned?.aspect ?? '',
    sceneCount: scenes.length,
    sceneTypes: sceneTypes.join(','),
    hook: scenes[0]?.copy ?? '',
    cta: scenes[scenes.length - 1]?.copy ?? '',
    proof: scenes.find((s) => s.type === 'proof')?.copy ?? '',
    copyLines: scenes.map((s) => s.copy),
    style: rundown.style ?? '',
    title: rundown.title ?? '',
  }
}

/**
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
}

/** How many distinct values appear for each field, for a report table. */
export function distinctCounts(shapes) {
  const keys = ['durationSec', 'sceneCount', 'hook', 'cta', 'copyLines', 'style', 'title']
  const out = {}
  for (const key of keys) {
    const seen = new Set(shapes.map((shape) => JSON.stringify(shape[key])))
    out[key] = { distinct: seen.size, of: shapes.length }
  }
  return out
}
