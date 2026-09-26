/**
 * The runtime frame sources.
 *
 * Kept out of `renderer.ts` on purpose: the renderer must stay importable
 * without a DOM (the headless render check bundles it), and the Lottie player
 * is emphatically not. Anything that needs a live browser to resolve a frame
 * belongs here.
 */
import { stickerFrame } from './lottie'
import { getMedia, overlayImage } from './media'
import { drawableElement, type FrameSources } from './renderer'

/** Preview convenience: resolve media straight from the runtime registry. */
export const registrySources: FrameSources = {
  media: (clip) => drawableElement(clip.mediaId),
  overlay: (clip) => overlayImage(clip.id, clip.dataUrl),
  sticker: (clip, localSec) => stickerFrame(clip, localSec),
}

export { getMedia }
