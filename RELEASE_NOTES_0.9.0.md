# Cupric AI 0.9.0

## New: Studio → Components

Every UI Lab component (190 of them) can now be added from inside the Studio, with its real animation.

- **Components button** in the Studio toolbar opens a searchable panel with category filters and a live preview.
  - Choose a length (2–8 s) and whether Cupric should **act it out**: hover, move over, press and long-press its controls.
  - Then press **Add at playhead**. You can also double-click a row, press its **+** button, or drag it onto the stage.
- **Recorded live, not frozen.** Cupric plays the real React component on screen and records it in real time. It then resamples the recording to steady 12 fps frames and crops it to the component.
  - Animations play at their real speed, even when the OS has "reduce motion" turned on.
  - Clips go on a free track (new tracks are created when needed), get sized to read well in the frame, and get a rise-in / fade-out.
- **Editable.** The inspector's new Component section lets you:
  - change the record length and performance (act it out / just watch), then **Record again**;
  - set motion speed (0.25–3×) and loop on/off;
  - rebuild the component as native text and glass layers you can type into.
  - Position, scale, keyframes, masks, grade and transitions all work as on any other clip.
- **The agent can use them.** The live agent sees a component catalog matched to your prompt and can place any component with the new `addComponent` operation. The local planner does the same, so it works offline or when a provider is out of quota.
  - Example: "add the like button after the title".
  - Unknown components are rejected, never invented.
- **One pipeline everywhere.** Studio → Components, Resources → Apply, drag-and-drop, UI Lab's *Add animated to Studio* and the agent all go through the same recorder.
- Export waits for components that are still recording. If recording is stopped or fails, the clip explains why and offers **Record again**.

## Also in this release (since 0.8.0)

- **Every resource has one Apply** that pastes into the timeline: templates, storyboards, fonts, effects, transitions, backgrounds, HTML scenes and voice commands.
- **Fixes:**
  - AI provider fallback to local models.
  - Tolerant HTML/ZIP import.
  - Even-size FFmpeg renders.
  - Deduplicated, human-readable errors.
  - Inline text editing.
  - Automatic tracks.
  - Light mode and scrolling panels.
  - Correct app icons.
  - Apex motion fit.
  - Richer Auto polish.

## Known limitation

- Voice control in the desktop app runs offline (Whisper, falling back to Windows Speech). A spoken "make a video…" now waits for "yes" before it starts a job. It still needs a hands-on pass on Windows hardware.
