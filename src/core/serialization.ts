import type { Composition, JsonValue, MotionElement } from "@/core/types";

const MAX_JSON_BYTES = 750_000;
const MAX_NODES = 600;
const MAX_DEPTH = 10;
const knownNodeTypes = new Set([
  "group",
  "background",
  "text",
  "shape",
  "ui",
  "chart",
  "effect",
  "three:model",
  "audio",
  "caption",
]);

export type ValidationResult =
  | { success: true; data: Composition }
  | { success: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSafeAssetUrl(value: unknown) {
  if (typeof value !== "string") return false;
  if (value.startsWith("data:image/")) return value.length < 250_000;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return value.startsWith("/");
  }
}

function validateNode(value: unknown, seen: Set<string>, depth: number, errors: string[]): value is MotionElement {
  if (!isRecord(value)) {
    errors.push("Every scene node must be an object.");
    return false;
  }
  if (depth > MAX_DEPTH) {
    errors.push(`Node ${String(value.id ?? "unknown")} exceeds the maximum nesting depth.`);
    return false;
  }
  if (typeof value.id !== "string" || !value.id.trim()) {
    errors.push("Every node needs a non-empty id.");
  } else if (seen.has(value.id)) {
    errors.push(`Duplicate node id: ${value.id}.`);
  } else {
    seen.add(value.id);
  }
  if (typeof value.name !== "string" || !value.name.trim()) errors.push("Every node needs a name.");
  if (typeof value.type !== "string" || !knownNodeTypes.has(value.type)) {
    errors.push(`Unsupported node type: ${String(value.type)}.`);
  }
  if (value.children !== undefined) {
    if (!Array.isArray(value.children)) errors.push("Node children must be an array.");
    else value.children.forEach((child) => validateNode(child, seen, depth + 1, errors));
  }
  const props = value.props;
  if (isRecord(props) && "src" in props && !isSafeAssetUrl(props.src)) {
    errors.push(`Node ${String(value.id)} has an unsafe asset URL.`);
  }
  return errors.length === 0;
}

export function validateComposition(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { success: false, errors: ["Template must be a JSON object."] };
  if (value.version !== 1) errors.push("Unsupported template version.");
  const requiredText = ["id", "name", "description"];
  requiredText.forEach((field) => {
    if (typeof value[field] !== "string" || !String(value[field]).trim()) errors.push(`Missing ${field}.`);
  });
  ["fps", "width", "height", "durationInFrames", "seed"].forEach((field) => {
    if (typeof value[field] !== "number" || !Number.isFinite(value[field])) errors.push(`Invalid ${field}.`);
  });
  if (typeof value.fps === "number" && (value.fps < 1 || value.fps > 120)) errors.push("FPS must be 1–120.");
  if (typeof value.durationInFrames === "number" && (value.durationInFrames < 1 || value.durationInFrames > 36_000)) {
    errors.push("Duration is out of bounds.");
  }
  if (!isRecord(value.brand)) errors.push("A template needs a brand object.");
  if (!Array.isArray(value.scenes) || value.scenes.length === 0) errors.push("A template needs at least one scene.");
  if (!Array.isArray(value.tracks)) errors.push("Timeline tracks must be an array.");
  if (!Array.isArray(value.propertyTracks)) errors.push("Property tracks must be an array.");
  if (!Array.isArray(value.markers)) errors.push("Markers must be an array.");

  const seen = new Set<string>();
  if (Array.isArray(value.scenes)) {
    value.scenes.forEach((scene) => {
      if (!isRecord(scene) || !Array.isArray(scene.nodes)) {
        errors.push("Each scene needs a nodes array.");
        return;
      }
      scene.nodes.forEach((node) => validateNode(node, seen, 0, errors));
    });
  }
  if (seen.size > MAX_NODES) errors.push(`A template may contain at most ${MAX_NODES} nodes.`);
  return errors.length ? { success: false, errors } : { success: true, data: value as Composition };
}

export function cloneComposition(composition: Composition): Composition {
  return JSON.parse(JSON.stringify(composition)) as Composition;
}

export function exportCompositionJson(composition: Composition) {
  return JSON.stringify(composition, null, 2);
}

export async function importCompositionFile(file: File): Promise<ValidationResult> {
  if (file.size > MAX_JSON_BYTES) return { success: false, errors: ["Template exceeds 750 KB."] };
  try {
    return validateComposition(JSON.parse(await file.text()) as JsonValue);
  } catch {
    return { success: false, errors: ["The selected file is not valid JSON."] };
  }
}
