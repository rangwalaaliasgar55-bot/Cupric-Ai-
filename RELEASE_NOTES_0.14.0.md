# Cupric AI 0.14.0 — thirteen fixes, and motion that behaves like motion

0.13.0 unblocked the release build. 0.14.0 is the first release since then
with new work in it: thirteen numbered jobs against the defects visible in the
0.13.0 screenshots, plus a motion core learned from
[motion-launch-videos](https://github.com/Kimeur/motion-launch-videos).

Every item below is covered by a check in the release chain, which now runs
**75 steps** before `vite build`.

---

## The thirteen jobs

**1 · Preview paths stopped refusing files Cupric wrote itself.** The
`arena:previewPath` allowlist compared raw strings, so a mixed-case drive
letter, a symlinked project folder or an 8.3 short name read as "outside the
sandbox". Paths are now canonicalised before comparison, and a genuine refusal
is an inline message naming the path with a Reveal folder button — never a raw
IPC error.

**2 · Stock downloads download.** `Stock download host is not allowlisted`
is gone. Each query walks a fallback chain — keyless Openverse/Picsum, then
your own Pixabay/Pexels keys, then the owner proxy, then project media — and
only reports failure when every source has actually been tried. The message
names what was searched and offers a one-click retry.

**3 · AI routes fail over instead of hanging.** 20-second abortable timeout
per attempt, silent failover across the fallback order, 1s→4s backoff on
429/503, and a route marked unhealthy after 2 failures in 5 minutes. The Ask
panel status line now shows the **real** route (`Auto · <actual host> ·
<model>`) rather than the configured one.

**4 · Voice intake fills the form visibly.** Offline-first dictation, and the
interviewer writes What/Who/Where/Duration/Aspect/Footage only when the
transcript literally contains them — each write citing the phrase it heard.
Gaps become visible assumptions, never invented answers.

**5 · Six suggested looks you can tell apart.** They were all called
"Dynamic". Now: Social pop, Clean caption, Round & warm, Poster slam, Tall
caps, Creator bold — verified to produce six different frame hashes.

**6 · Nothing lands on the timeline unreviewed.** A recording waits in a
review card (first/middle/last frame, duration, size) with Apply at playhead /
Save to shelf / Discard. Auto-insert is now opt-in. Component text — including
the "Hold to delete" pill — is a real editable field that survives re-record.

**7 · Resources stay on the stage.** One clamp shared by the drop handler, the
keyframe writer, the agent op and the renderer. 10,000 fuzzed placements
produced zero out-of-bounds values, with export frame-hash parity.

**8 · The two black screens are gone.** Motion Engine "Open in editor" and the
AI Scene Graph Generator both blanked the app — the cause was
`window.location.href` navigation in an SPA with no URL router. Both now route
in-place, behind an error boundary that shows diagnostics instead of a void.

**9 · The preview got its room back.** The right inspector collapses to a
44px rail with a draggable, persisted width; at 1120px the stage keeps ≥60% of
the window. Six surfaces were re-laned onto a single z-index contract — the
panel overlapping the toolbar was `StatusCenter` sitting above both the toast
and modal lanes.

**10 · Relink actually relinks.** On desktop the absolute path is stored
beside the handle, so a file that never moved is resolved silently on open. A
genuinely missing file shows its poster thumbnail, names the path it looked in,
and offers Locate… (native picker) and Remove.

**11 · Auto polish and Auto effects ask first.** Both fired the same
hard-coded paragraph regardless of the timeline. They now read the live
document, state what they found, and ask **one** question with named options —
generating only after you pick. Effects options are built from what is
*missing*, so a finished timeline is told so rather than given busywork.

**12 · One shared production plan.** Cupric and the agent tracked the same
film in three places and could disagree. There is now one spine: eight
canonical steps, one owner each (YOU / CUPRIC / AGENT), status derived from
saved artefacts rather than ticked by hand, and approval charged on exactly the
two destructive steps.

**13 · Highlight runs and chips.** `highlightWord` marked one word by
recolouring it. Captions now highlight a **phrase** — comma-separated, longest
match first, case and punctuation tolerant — and can draw a filled chip behind
the whole run as one box. A phrase that is not literally in your text
highlights nothing.

---

## Motion craft

Techniques adapted from motion-launch-videos by Marouane Gazouzi (MIT). No
code is vendored; they are reimplemented against Cupric's renderer and credited
in the README.

**Real springs.** `back-out` is a polynomial imitating a bounce. The
damped-harmonic response has a closed form, so it can be evaluated directly —
real overshoot and ring-down that is still a pure function of `t`, which is the
only way preview can equal export and backwards scrubbing can be bit-identical.
Four are available as keyframe eases (Land, Slam, Punch, Glide) in the
inspector, in the renderer, and in the agent's vocabulary.

**Cursor pack v2.** Eight pointers drawn from paths, so they stay sharp at any
export size, with a click dip, an expanding ripple and fade in/out. Travel is
sprung and takes real time. Each variant previews itself running the real loop
through the same draw call the export uses.

**The motion-craft pass.** A local, deterministic pass — no AI, no waiting —
offered as a choice in the Auto polish question. It fixes the three things a
motion designer fixes first: nothing arrives on a linear ramp, one thing
happens at a time (simultaneous entrances are staggered onto a rhythm grid),
and nothing sits dead still. Every change is an ordinary editable keyframe,
justified by a named finding, and clips you animated by hand are never touched.

**Film styles.** The eight kinds of motion film the agent can build, each
carrying an explicit `notFor` list that disqualifies rather than penalises — so
a quarterly report cannot come back as a particle swarm — and returning *no
pick* when the brief does not say, which makes the agent ask.

---

## Downloads

- `Cupric-AI-Setup-0.14.0.exe` — NSIS installer (choose install location,
  desktop and Start menu shortcuts).
- `Cupric-AI-0.14.0-x64-Portable.exe` — portable, no install.

Windows may show SmartScreen on first run because these builds are unsigned;
choose **More info → Run anyway**.
