import { useEffect, useRef, useState } from 'react'

/** Dependency-free HTML5 preview inspired by the playback state patterns in Video.js/react-video-editor. */
export function VideoPreview({ path, poster, className }: { path?: string | null; poster?: string | null; className?: string }) {
  const video = useRef<HTMLVideoElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  useEffect(() => { let alive = true; setError(null); setUrl(null); const ipc = (window as any).northframe?.ipc; if (!path) return; if (!ipc) { setUrl(path); return } void ipc.invoke('arena:previewPath', path).then((value: string) => alive && setUrl(value)).catch(() => alive && setError('Preview is unavailable for this local file')); return () => { alive = false } }, [path])
  if (!path) return <div className="grid aspect-video place-items-center rounded-lg bg-bg text-xs text-muted">No preview available</div>
  if (error) return <div className="grid aspect-video place-items-center rounded-lg bg-bg px-4 text-center text-xs text-muted">{error}</div>
  return <div className={`overflow-hidden rounded-lg bg-black ${className ?? ''}`}><video ref={video} src={url ?? undefined} poster={poster ?? undefined} className="aspect-video w-full object-contain" onTimeUpdate={e => setTime(e.currentTarget.currentTime)} onLoadedMetadata={e => setDuration(e.currentTarget.duration)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => setError('The video could not be decoded')} controls playsInline /><div className="flex items-center gap-3 p-2 text-xs text-muted"><button type="button" className="rounded bg-panel-alt px-2 py-1 text-text" onClick={() => { const v = video.current; if (!v) return; void (v.paused ? v.play() : v.pause()) }}>{playing ? 'Pause' : 'Play'}</button><input aria-label="Seek preview" type="range" min={0} max={duration || 0} step={0.01} value={time} onChange={e => { const v = video.current; if (v) v.currentTime = Number(e.target.value) }} className="min-w-0 flex-1" /><span>{Math.floor(time)}s / {Math.floor(duration)}s</span></div></div>
}
