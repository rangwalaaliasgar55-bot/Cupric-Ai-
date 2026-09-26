import { useEffect, useRef, useState } from 'react'
import videojs from 'video.js'
import 'video.js/dist/video-js.css'

function isBrowserUrl(path: string) {
  return /^(blob|data|https?):/i.test(path)
}

/** Video.js-backed player for browser object URLs and Electron project files. */
export function VideoPreview({ path, poster, className }: { path?: string | null; poster?: string | null; className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const playerRef = useRef<ReturnType<typeof videojs> | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setError(null)
    setUrl(null)
    if (!path) return
    const ipc = (window as any).cupric?.ipc || (window as any).northframe?.ipc
    if (!ipc || isBrowserUrl(path)) {
      setUrl(path)
      return
    }
    void ipc
      .invoke('arena:previewPath', path)
      .then((value: string) => alive && setUrl(value))
      .catch(() => alive && setError('Preview is unavailable for this local file'))
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
  if (error) return <div className="grid aspect-video place-items-center rounded-lg bg-bg px-4 text-center text-xs text-muted">{error}</div>

  return (
    <div className={`overflow-hidden rounded-lg bg-black ${className ?? ''}`}>
      <div data-vjs-player>
        <video ref={videoRef} className="video-js vjs-big-play-centered vjs-theme-cupric aspect-video w-full" playsInline />
      </div>
    </div>
  )
}
