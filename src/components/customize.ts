/* Applies schema values from the gallery "Customize" panel to an asset's preview document. */
import type { AssetDef, VideoDoc } from "@/core/types";
import { buildTemplate } from "@/video/templates";

export function customizePreview(asset: AssetDef, values: Record<string, unknown>): VideoDoc {
  const base = asset.preview!(values);
  switch (asset.kind) {
    case "template": {
      const id = asset.id.replace("template:", "");
      return buildTemplate(id, { brand: { name: "Cupric AI" }, headline: values.headline as string, subtitle: values.subtitle as string, cta: values.cta as string, duration: values.duration as number });
    }
    case "effect": return { ...base, effects: [{ type: asset.id.replace("effect:", ""), params: values }] };
    case "transition": return { ...base, scenes: base.scenes.map((s, i) => (i === 1 ? { ...s, transition: { type: asset.id.replace("transition:", ""), duration: Number(values.duration ?? 18), params: { ease: values.ease } } } : s)) };
    case "motion": return { ...base, scenes: base.scenes.map((s) => ({ ...s, nodes: s.nodes.map((n) => (n.id.endsWith("_preview") ? { ...n, ...(n.loop ? { loop: { ...n.loop, intensity: values.intensity as number, distance: values.distance as number } } : { enter: { preset: n.enter!.preset, delay: 10, duration: values.duration as number, ease: values.ease as string, intensity: values.intensity as number, distance: values.distance as number } }) } : n)) })) };
    case "caption": return { ...base, captions: base.captions?.map((c) => ({ ...c, props: values })) };
    case "theme": return base;
    default:
      return { ...base, scenes: base.scenes.map((s) => ({ ...s, nodes: s.nodes.map((n) => (n.id.endsWith("_preview") ? { ...n, props: { ...n.props, ...values } } : n)) })) };
  }
}

export const LOCAL_DOC_KEY = "motionos:editor-transfer";

/**
 * JOB 8 — this used to blank the whole app.
 *
 * It navigated with a hard location assignment to "/editor?from=local".
 * Cupric is a single-page
 * shell whose routing is a `View` union in the store, not URLs — so that line
 * navigated the browser off the app to a path no server serves, and the user
 * got a black screen with no way back except a reload.
 *
 * The handoff contract is unchanged (the doc still goes through LOCAL_DOC_KEY,
 * which is what Editor.tsx reads); only the navigation is. We raise an event
 * the Motion Engine listens for and open its editor tab in place.
 */
export const OPEN_EDITOR_EVENT = "cupric:open-motion-editor";

export function sendToEditor(doc: VideoDoc) {
  try {
    localStorage.setItem(LOCAL_DOC_KEY, JSON.stringify(doc));
  } catch (err) {
    // A full quota is an expected failure, not a crash: say so and stop.
    window.dispatchEvent(new CustomEvent(OPEN_EDITOR_EVENT, {
      detail: { ok: false, reason: `Could not hand this composition to the editor: ${err instanceof Error ? err.message : String(err)}. Export the template.json instead.` },
    }));
    return;
  }
  window.dispatchEvent(new CustomEvent(OPEN_EDITOR_EVENT, { detail: { ok: true } }));
}
