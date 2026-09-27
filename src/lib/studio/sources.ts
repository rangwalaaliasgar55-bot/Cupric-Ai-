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
    if (!frames) return clip.dataUrl ? overlayImage(`${clip.id}:${clip.dataUrl.length}:${clip.dataUrl.slice(-16)}`, clip.dataUrl) : null
    // Warm the whole short frame strip at first sight. Export is synchronous,
    // so waiting to decode each image until its exact frame would create blank
    // flashes in the recorded video.
    // Keys carry a signature of the pixels so a re-recorded component never
    // shows the previous recording from the decode cache.
    const key = (index: number) => `${clip.id}:${index}:${frames[index].length}:${frames[index].slice(-16)}`
    frames.forEach((frame, index) => { overlayImage(key(index), frame) })
    // Loop the strip when the clip is longer than the capture, so a UI
    // component keeps moving instead of freezing on its last frame.
    const raw = Math.max(0, Math.floor(localSec * (clip.frameFps ?? 8) * (clip.playbackRate ?? 1)))
    const frameIndex = clip.loop === false ? Math.min(frames.length - 1, raw) : raw % frames.length
    return overlayImage(key(frameIndex), frames[frameIndex])
  },
  sticker: (clip, localSec) => stickerFrame(clip, localSec),
}

export { getMedia }
