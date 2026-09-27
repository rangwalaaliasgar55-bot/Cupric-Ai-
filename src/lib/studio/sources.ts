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
  overlay: (clip, localSec = 0) => {
    const frames = clip.frames?.length ? clip.frames : null
    if (!frames) return overlayImage(clip.id, clip.dataUrl)
    // Warm the whole short frame strip at first sight. Export is synchronous,
    // so waiting to decode each image until its exact frame would create blank
    // flashes in the recorded video.
    frames.forEach((frame, index) => { overlayImage(`${clip.id}:${index}`, frame) })
    // Loop the strip when the clip is longer than the capture, so a UI
    // component keeps moving instead of freezing on its last frame.
    const raw = Math.max(0, Math.floor(localSec * (clip.frameFps ?? 8)))
    const frameIndex = raw % frames.length
    return overlayImage(`${clip.id}:${frameIndex}`, frames[frameIndex])
  },
  sticker: (clip, localSec) => stickerFrame(clip, localSec),
}

export { getMedia }
