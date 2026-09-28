import { useEffect, useRef, useState } from 'react'
import videojs from 'video.js'
import 'video.js/dist/video-js.css'
import { getIpc } from '../lib/bridge'
import { resolvePreviewUrl, revealPath } from '../lib/previewPath'

function isBrowserUrl(path: string) {
  return /^(blob|data|https?):/i.test(path)
}

/** Video.js-backed player for browser object URLs and Electron project files. */
export function VideoPreview({ path, poster, className }: { path?: string | null; poster?: string | null; className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const playerRef = useRef<ReturnType<typeof videojs> | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // F-2: a refused path names itself and offers one click to find it.
  const [revealTarget, setRevealTarget] = useState<string>('')

  useEffect(() => {
    let alive = true
    setError(null)
    setUrl(null)
    if (!path) return
    const ipc = getIpc()
    if (!ipc || isBrowserUrl(path)) {
      setUrl(path)
      return
    }
    void resolvePreviewUrl(path).then((result) => {
      if (!alive) return
      if (result.ok) { setUrl(result.url); setRevealTarget(''); return }
      setError(result.message)
      setRevealTarget(result.canReveal ? result.path : '')
    })
    return () => {
      alive = false
    }
  }, [path])

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
    player.on('error', () => setError('The video could not be decoded by Video.js'))
  }, [poster, url])

  useEffect(() => () => {
    playerRef.current?.dispose()
    playerRef.current = null
  }, [])

  if (!path) return <div className="grid aspect-video place-items-center rounded-lg bg-bg text-xs text-muted">No preview available</div>
  if (error) {
    return (
      <div className="grid aspect-video place-items-center gap-2 rounded-lg bg-bg px-4 text-center text-xs text-muted">
        <p>{error}</p>
        {revealTarget && (
          <button type="button" onClick={() => void revealPath(revealTarget)} className="rounded-md border border-line px-2 py-1 text-text">
            Reveal folder
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={`overflow-hidden rounded-lg bg-black ${className ?? ''}`}>
      <div data-vjs-player>
        <video ref={videoRef} className="video-js vjs-big-play-centered vjs-theme-cupric aspect-video w-full" playsInline />
      </div>
    </div>
  )
}
