import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, CameraOff, Copy, Mic, MicOff, Phone, PhoneOff, RefreshCw, Video } from 'lucide-react'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { copyText } from '../lib/utils'
import { getIpc } from '../lib/bridge'
import { humanError } from '../lib/humanError'
import { rlog } from '../lib/log'
import { ErrorState, LoadingState } from '../components/ScreenStates'

type RoomState = 'idle' | 'previewing' | 'connecting' | 'connected' | 'error'

type TwilioRoomLike = {
  name?: string
  disconnect: () => void
  on: (event: string, callback: (value: unknown) => void) => void
  participants?: Map<string, unknown>
}

type TwilioTrackLike = {
  attach?: () => HTMLElement
  detach?: () => HTMLElement[]
}

type ReviewComment = { id: string; at: number; text: string; author: string; resolved: boolean }

function roomFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get('room') || 'newbrand-review'
  } catch {
    return 'newbrand-review'
  }
}

function attachPublication(publication: unknown, target: HTMLElement | null) {
  const pub = publication as { track?: TwilioTrackLike; on?: (event: string, callback: (track: TwilioTrackLike) => void) => void }
  const attachTrack = (track: TwilioTrackLike) => {
    const element = track.attach?.()
    if (element && target) {
      element.classList.add('h-full', 'w-full', 'rounded-lg', 'object-cover')
      target.appendChild(element)
    }
  }
  if (pub.track) attachTrack(pub.track)
  pub.on?.('subscribed', attachTrack)
}

function wireParticipant(participant: unknown, target: HTMLElement | null) {
  const p = participant as { tracks?: Map<string, unknown>; on?: (event: string, callback: (publication: unknown) => void) => void; identity?: string }
  p.tracks?.forEach((publication) => attachPublication(publication, target))
  p.on?.('trackSubscribed', (track) => attachPublication({ track }, target))
}

export function ReviewRoom() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const remoteRef = useRef<HTMLDivElement>(null)
  const roomRef = useRef<TwilioRoomLike | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [state, setState] = useState<RoomState>('idle')
  const [error, setError] = useState<string | null>(null)
  /** Loading the notes is its own state: it is the first thing this screen does. */
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [roomName, setRoomName] = useState(roomFromUrl)
  const [token, setToken] = useState('')
  const [cameraOff, setCameraOff] = useState(false)
  const [micOff, setMicOff] = useState(false)
  const [copied, setCopied] = useState(false)
  const [remoteCount, setRemoteCount] = useState(0)
  const [comments, setComments] = useState<ReviewComment[]>([])
  const [commentAt, setCommentAt] = useState('0')
  const [commentText, setCommentText] = useState('')
  const [commentAuthor, setCommentAuthor] = useState('Guest reviewer')

  const inviteUrl = useMemo(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('room', roomName)
    return url.toString()
  }, [roomName])

  useEffect(() => {
    if (!videoRef.current) return
    videoRef.current.srcObject = stream
  }, [stream])

  /**
   * Load the room's notes.
   *
   * Before this was a `useEffect` whose `.catch` set an empty list: a failed
   * `review:list` was indistinguishable from a room with no notes, which is the
   * exact failure mode Phase 3 forbids — an error nobody is told about. Now the
   * failure is a state with a message and a retry that calls this same function.
   */
  const loadComments = useCallback(async (signal?: { alive: boolean }) => {
    setLoadState('loading')
    const ipc = getIpc()
    if (!ipc) {
      try {
        const raw = JSON.parse(localStorage.getItem(`newbrand.review.${roomName}`) || '[]')
        if (signal && !signal.alive) return
        setComments(Array.isArray(raw) ? raw : [])
        setLoadState('ready')
      } catch (err) {
        if (signal && !signal.alive) return
        // Unreadable stored notes are a real error: the room is not empty, its
        // notes could not be read.
        rlog.error('review', 'stored review notes could not be read', err)
        setLoadError(humanError(err, 'This room’s saved review notes'))
        setLoadState('error')
      }
      return
    }
    try {
      const value = (await ipc.invoke('review:list', { room: roomName })) as ReviewComment[]
      if (signal && !signal.alive) return
      setComments(Array.isArray(value) ? value : [])
      setLoadState('ready')
    } catch (err) {
      if (signal && !signal.alive) return
      rlog.error('review', 'review:list failed', err)
      setLoadError(humanError(err, 'This review room’s notes'))
      setLoadState('error')
    }
  }, [roomName])

  useEffect(() => {
    const signal = { alive: true }
    void loadComments(signal)
    return () => { signal.alive = false }
  }, [loadComments])

  function toggleComment(comment: ReviewComment) {
    const resolved = !comment.resolved
    const ipc = getIpc()
    if (ipc) {
      void ipc.invoke('review:resolve', { room: roomName, id: comment.id, resolved }).then((value: ReviewComment[]) => setComments(Array.isArray(value) ? value : [])).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not update review note.'))
    } else {
      setComments((current) => {
        const next = current.map((item) => item.id === comment.id ? { ...item, resolved } : item)
        try { localStorage.setItem(`newbrand.review.${roomName}`, JSON.stringify(next)) } catch { /* private mode */ }
        return next
      })
    }
  }

  function addComment() {
    const text = commentText.trim()
    if (!text) return
    const payload = { room: roomName, at: Math.max(0, Number(commentAt) || 0), text, author: commentAuthor.trim() || 'Guest reviewer' }
    const ipc = getIpc()
    if (ipc) {
      void ipc.invoke('review:add', payload).then((comment: ReviewComment) => setComments((current) => [...current, comment])).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not save review note.'))
    } else {
      const comment = { id: `${roomName}-${comments.length}`, ...payload, resolved: false }
      setComments((current) => [...current, comment])
      try { localStorage.setItem(`newbrand.review.${roomName}`, JSON.stringify([...comments, comment])) } catch { /* private mode */ }
    }
    setCommentText('')
  }

  useEffect(() => {
    stream?.getVideoTracks().forEach((track) => {
      track.enabled = !cameraOff
    })
    const local = (roomRef.current as { localParticipant?: { videoTracks?: Map<string, { track?: { enable?: () => void; disable?: () => void } }> } } | null)?.localParticipant
    local?.videoTracks?.forEach((publication) => cameraOff ? publication.track?.disable?.() : publication.track?.enable?.())
  }, [cameraOff, stream])

  useEffect(() => {
    stream?.getAudioTracks().forEach((track) => {
      track.enabled = !micOff
    })
    const local = (roomRef.current as { localParticipant?: { audioTracks?: Map<string, { track?: { enable?: () => void; disable?: () => void } }> } } | null)?.localParticipant
    local?.audioTracks?.forEach((publication) => micOff ? publication.track?.disable?.() : publication.track?.enable?.())
  }, [micOff, stream])

  useEffect(() => () => {
    roomRef.current?.disconnect()
    stream?.getTracks().forEach((track) => track.stop())
  }, [stream])

  async function startPreview() {
    setError(null)
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      setStream(media)
      setState('previewing')
    } catch (err) {
      setState('error')
      setError(humanError(err, 'Camera and microphone are unavailable'))
    }
  }

  function stopPreview() {
    roomRef.current?.disconnect()
    roomRef.current = null
    stream?.getTracks().forEach((track) => track.stop())
    setStream(null)
    setRemoteCount(0)
    if (remoteRef.current) remoteRef.current.innerHTML = ''
    setState('idle')
  }

  async function connectTwilio() {
    if (!token.trim() || !roomName.trim()) return
    setError(null)
    setState('connecting')
    try {
      const twilio = await import('twilio-video')
      const room = (await twilio.connect(token.trim(), {
        name: roomName.trim(),
        audio: !micOff,
        video: !cameraOff,
      })) as TwilioRoomLike
      roomRef.current = room
      room.participants?.forEach((participant) => {
        wireParticipant(participant, remoteRef.current)
        setRemoteCount((count) => count + 1)
      })
      room.on('participantConnected', (participant) => {
        wireParticipant(participant, remoteRef.current)
        setRemoteCount((count) => count + 1)
      })
      room.on('participantDisconnected', () => setRemoteCount((count) => Math.max(0, count - 1)))
      room.on('disconnected', () => setState('previewing'))
      setState('connected')
    } catch (err) {
      setState('error')
      setError(humanError(err, 'Twilio room connection'))
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-5 px-6 py-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <div>
            <h1 className="text-lg font-bold">Review Room</h1>
            <p className="text-sm text-muted">Twilio-compatible live review: camera check, room invites, and optional token-based video rooms.</p>
          </div>

          <Card className="overflow-hidden">
            <div className="relative aspect-video bg-black">
              {stream ? (
                <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
                  <Video size={30} />
                  <div className="text-sm">Start camera preview to verify devices before a client review.</div>
                </div>
              )}
              <div className="absolute left-3 top-3 flex gap-2">
                <Badge tone={state === 'connected' ? 'accent' : state === 'error' ? 'danger' : state === 'idle' ? 'neutral' : 'info'}>{state}</Badge>
                {stream && <Badge tone="neutral">local preview</Badge>}
              </div>
              <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2 rounded-full border border-line bg-panel/85 p-2 backdrop-blur">
                <Button size="sm" variant={micOff ? 'danger' : 'outline'} onClick={() => setMicOff((value) => !value)} disabled={!stream} title={(!stream) ? 'Join the room first' : undefined}>
                  {micOff ? <MicOff size={14} /> : <Mic size={14} />}
                  {micOff ? 'Muted' : 'Mic'}
                </Button>
                <Button size="sm" variant={cameraOff ? 'danger' : 'outline'} onClick={() => setCameraOff((value) => !value)} disabled={!stream} title={(!stream) ? 'Join the room first' : undefined}>
                  {cameraOff ? <CameraOff size={14} /> : <Camera size={14} />}
                  {cameraOff ? 'Hidden' : 'Camera'}
                </Button>
                {stream ? (
                  <Button size="sm" variant="ghost" onClick={stopPreview}>
                    <PhoneOff size={14} /> Stop
                  </Button>
                ) : (
                  <Button size="sm" variant="primary" onClick={startPreview}>
                    <Camera size={14} /> Start preview
                  </Button>
                )}
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Remote participants</div>
                <div className="text-xs text-muted">Tracks attach here after a valid Twilio access token connects.</div>
              </div>
              <Badge tone={remoteCount > 0 ? 'accent' : 'neutral'}>{remoteCount} remote</Badge>
            </div>
            <div ref={remoteRef} className="grid min-h-48 grid-cols-1 gap-3 rounded-lg border border-line bg-bg/60 p-3 md:grid-cols-2">
              {remoteCount === 0 && <div className="grid min-h-40 place-items-center text-center text-xs text-muted">No remote video yet. Paste a Twilio Video access token and connect.</div>}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="space-y-4 p-4">
            <div>
              <div className="text-sm font-semibold">Room setup</div>
              <p className="mt-1 text-xs text-muted">Local preview works without credentials. Multi-party calls need a Twilio Video access token from your own token server.</p>
              <p className="rounded-md border border-line bg-bg/50 px-3 py-2 text-xs text-muted">{getIpc() ? 'Review notes persist in this desktop profile.' : 'Browser review notes stay on this browser. Cross-device guest sync needs a deployed, authenticated room service; this build never pretends local notes are shared.'}</p>
            </div>
            <label className="block text-xs font-medium text-muted">
              Room name
              <input value={roomName} onChange={(event) => setRoomName(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-line bg-panel-alt px-3 text-sm text-text" />
            </label>
            <label className="block text-xs font-medium text-muted">
              Twilio access token
              <textarea value={token} onChange={(event) => setToken(event.target.value)} placeholder="Paste a short-lived Video token…" className="mt-1 min-h-24 w-full rounded-lg border border-line bg-panel-alt px-3 py-2 text-sm text-text" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={startPreview}>
                <RefreshCw size={14} /> Check devices
              </Button>
              <Button variant="primary" disabled={!token.trim() || !roomName.trim()} title={(!token.trim() || !roomName.trim()) ? 'Enter a room name and token first' : undefined} onClick={connectTwilio}>
                <Phone size={14} /> Connect
              </Button>
            </div>
            {error && <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}

            {loadState === 'loading' && <LoadingState label="Loading this room’s notes" />}
            {loadState === 'error' && (
              <ErrorState
                title="The notes for this room could not be loaded"
                message={loadError || 'The review notes could not be read.'}
                onRetry={() => void loadComments()}
                retryLabel="Load again"
                nextStep="Your notes are still on the machine — nothing was deleted. Loading again is usually enough."
              />
            )}
          </Card>

          <Card className="space-y-3 p-4">
            <div className="text-sm font-semibold">Invite link</div>
            <div className="break-all rounded-lg bg-bg/70 p-3 font-mono text-xs text-muted">{inviteUrl}</div>
            <Button
              variant="outline"
              className="w-full"
              onClick={async () => {
                if (await copyText(inviteUrl)) {
                  setCopied(true)
                  window.setTimeout(() => setCopied(false), 1500)
                }
              }}
            >
              <Copy size={14} /> {copied ? 'Copied' : 'Copy invite'}
            </Button>
          </Card>

          <Card className="space-y-3 p-4">
            <div>
              <div className="text-sm font-semibold">Time-coded review notes</div>
              <p className="mt-1 text-xs text-muted">Guests do not need an account. Notes are stored per room on this device and can be resolved after the fix lands.</p>
            </div>
            <div className="grid grid-cols-[90px_1fr] gap-2">
              <input aria-label="Comment time in seconds" type="number" min="0" step="0.1" value={commentAt} onChange={(event) => setCommentAt(event.target.value)} className="h-9 rounded-lg border border-line bg-panel-alt px-2 text-xs" placeholder="Seconds" />
              <input aria-label="Reviewer name" value={commentAuthor} onChange={(event) => setCommentAuthor(event.target.value)} className="h-9 rounded-lg border border-line bg-panel-alt px-2 text-xs" placeholder="Name" />
            </div>
            <textarea aria-label="Review note" value={commentText} onChange={(event) => setCommentText(event.target.value)} className="min-h-16 w-full rounded-lg border border-line bg-panel-alt px-2 py-1.5 text-xs" placeholder="What should change at this moment?" />
            <Button variant="primary" className="w-full" onClick={addComment}>Add note at {Number(commentAt || 0).toFixed(1)}s</Button>
            <div className="max-h-52 space-y-1.5 overflow-y-auto">
              {comments.length === 0 && <p className="text-xs text-muted">No notes yet.</p>}
              {comments.slice().sort((a, b) => a.at - b.at).map((comment) => <div key={comment.id} className={`rounded-lg border px-2.5 py-2 text-xs ${comment.resolved ? 'border-accent/20 bg-accent/5 opacity-60' : 'border-line bg-panel-alt/40'}`}>
                <div className="flex items-center justify-between gap-2"><span className="font-mono text-accent-text">{comment.at.toFixed(1)}s</span><span className="truncate text-muted">{comment.author}</span><button type="button" className="text-[10px] text-muted underline" onClick={() => toggleComment(comment)}>{comment.resolved ? 'Reopen' : 'Resolve'}</button></div>
                <p className="mt-1 text-text">{comment.text}</p>
              </div>)}
            </div>
          </Card>

          <Card className="space-y-2 p-4 text-xs leading-relaxed text-muted">
            <div className="font-semibold text-text">What is implemented</div>
            <p>Device preview, mute/camera toggles, shareable room names, and Twilio Video connection are live. NewBrand requires a real short-lived Twilio token from your own backend for multi-party calls.</p>
          </Card>
        </div>
      </div>
    </div>
  )
}
