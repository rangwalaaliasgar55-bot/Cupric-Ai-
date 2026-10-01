/* Applies schema values from the gallery "Customize" panel to an asset's preview document. */
import type { AssetDef, VideoDoc } from "@/core/types";
import { buildTemplate } from "@/video/templates";

export function customizePreview(asset: AssetDef, values: Record<string, unknown>): VideoDoc {
  const base = asset.preview!(values);
  switch (asset.kind) {
    case "template": {
      const id = asset.id.replace("template:", "");
      return buildTemplate(id, { brand: { name: "NewBrand" }, headline: values.headline as string, subtitle: values.subtitle as string, cta: values.cta as string, duration: values.duration as number });
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
export function sendToEditor(doc: VideoDoc) {
  localStorage.setItem(LOCAL_DOC_KEY, JSON.stringify(doc));
  window.location.href = "/editor?from=local";
}
