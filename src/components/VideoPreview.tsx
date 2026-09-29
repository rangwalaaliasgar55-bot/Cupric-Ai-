import { useEffect, useRef, useState } from 'react'
import videojs from 'video.js'
import 'video.js/dist/video-js.css'
import { getIpc } from '../lib/bridge'

function isBrowserUrl(path: string) {
  return /^(blob|data|https?):/i.test(path)
}

export type LocalMediaUrl = { url: string | null; error: string | null; loading: boolean }

/**
 * Turn a local media path into something a `<video>` can open: browser URLs pass
 * through, Electron project files go to the main process, which checks the path
 * is inside Cupric's own project data before handing back a `file://` URL.
 *
 * Exported because the Timeline screen drives its own `<video>` element from the
 * playhead (Video.js owns the element it creates, so a scrub-following preview
 * cannot share the player instance) — same URL rules, one implementation.
 */
export function useLocalMediaUrl(path?: string | null): LocalMediaUrl {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(path))

  useEffect(() => {
    let alive = true
    setError(null)
    setUrl(null)
    setLoading(Boolean(path))
    if (!path) {
      setLoading(false)
      return
    }
    if (isBrowserUrl(path)) {
      setUrl(path)
      setLoading(false)
      return
    }
    const ipc = getIpc()
    if (!ipc) {
      // A local path in the browser build has no URL to hand a <video>; saying
      // so beats a black rectangle that looks like a broken file.
      setError('Local files can only be previewed in the desktop app.')
      setLoading(false)
      return
    }
    void ipc
      .invoke('arena:previewPath', path)
      .then((value: string) => {
        if (!alive) return
        setUrl(value)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!alive) return
        // Never a silent blank frame: say why the file cannot be shown.
        setError(err instanceof Error && err.message ? `This file cannot be previewed: ${err.message}` : 'Preview is unavailable for this local file')
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [path])

  return { url, error, loading }
}

/** Video.js-backed player for browser object URLs and Electron project files. */
export function VideoPreview({ path, poster, className }: { path?: string | null; poster?: string | null; className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const playerRef = useRef<ReturnType<typeof videojs> | null>(null)
  const { url, error } = useLocalMediaUrl(path)
  // Decode failures are the player's business, not the URL helper's.
  const [playerError, setPlayerError] = useState<string | null>(null)

  useEffect(() => {
    const element = videoRef.current
    if (!element || !url) return
    if (playerRef.current) {
      playerRef.current.poster(poster ?? '')
      playerRef.current.src({ src: url })
      return
    }
    const player = videojs(element, {
      controls: true,
      fluid: true,
      responsive: true,
      preload: 'metadata',
      poster: poster ?? undefined,
      playbackRates: [0.5, 1, 1.25, 1.5, 2],
      controlBar: {
        pictureInPictureToggle: true,
        volumePanel: { inline: false },
      },
      sources: [{ src: url }],
    })
    playerRef.current = player
    player.on('error', () => setPlayerError('The video could not be decoded by Video.js'))
  }, [poster, url])

  useEffect(() => () => {
    playerRef.current?.dispose()
    playerRef.current = null
  }, [])

  if (!path) return <div className="grid aspect-video place-items-center rounded-lg bg-bg text-xs text-muted">No preview available</div>
  const problem = error ?? playerError
  if (problem) return <div className="grid aspect-video place-items-center rounded-lg bg-bg px-4 text-center text-xs text-muted">{problem}</div>

  return (
    <div className={`overflow-hidden rounded-lg bg-black ${className ?? ''}`}>
      <div data-vjs-player>
        <video ref={videoRef} className="video-js vjs-big-play-centered vjs-theme-cupric aspect-video w-full" playsInline />
      </div>
    </div>
  )
}
