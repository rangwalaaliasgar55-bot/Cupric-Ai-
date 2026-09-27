/**
 * The one Apply path for every resource — Library cards, the Studio's
 * Resources panel and drops onto the Studio stage all call this.
 *
 * `applyResource` (pure) decides what the item becomes; this hook performs it:
 * one undoable store patch for edits, then selects the new layer and parks the
 * playhead where it is visible; or runs the Lab capture, the HTML scene
 * render, a voice command, or opens a reference link.
 */
import { useCallback, useState } from 'react'
import type { StudioOverlayClip } from '../../types/project'
import { availableSlugs } from '../../lab/demos'
import { copyText, uid } from '../../lib/utils'
import { humanError } from '../../lib/humanError'
import { docDuration, studioOf } from '../../lib/studio/doc'
import { ensureFont } from '../../lib/studio/fonts'
import { captureHtmlTemplate } from '../../lib/studio/htmlTemplateCapture'
import { applyResource, type ApplyItem } from '../../lib/studio/resourceApply'
import { briefLines, type BriefSource } from '../../lib/studio/storyboard'
import { requestStudioFocus, runVoicePhrase, studioPlayhead } from '../../lib/studio/studioLink'
import { useActiveProject, useProjectStore } from '../../state/useProjectStore'

export type ApplyProgress = { id: string; pct: number } | null

export function useResourceApply() {
  const project = useActiveProject()
  const patchStudio = useProjectStore((s) => s.patchStudio)
  const addStudioClip = useProjectStore((s) => s.addStudioClip)
  const setView = useProjectStore((s) => s.setView)
  const pushToast = useProjectStore((s) => s.pushToast)
  const [progress, setProgress] = useState<ApplyProgress>(null)

  const apply = useCallback(
    async (item: ApplyItem, opts: { atSec?: number; selectedId?: string | null } = {}): Promise<boolean> => {
      if (!project) {
        pushToast('info', 'Open or create a project first — resources apply to its timeline.')
        setView('home')
        return false
      }
      const doc = studioOf(project)
      const livePlayhead = studioPlayhead()
      const inStudio = livePlayhead !== null
      // In the Studio, at the playhead; from the Library, after the edit.
      const atSec = opts.atSec ?? livePlayhead ?? docDuration(doc)
      const openStudio = inStudio ? undefined : { label: 'Open Studio', run: () => setView('studio') }

      const result = applyResource(doc, item, {
        atSec,
        selectedId: opts.selectedId ?? null,
        brief: briefLines(project as unknown as BriefSource),
        brandName: project.name,
        hasLabDemo: (slug) => availableSlugs.has(slug),
      })

      if (!result.ok) {
        pushToast('info', result.reason)
        return false
      }

      switch (result.type) {
        case 'doc': {
          const next = result.doc
          patchStudio(project.id, { clips: next.clips, trackCount: next.trackCount, backgroundId: next.backgroundId })
          requestStudioFocus(result.focusId, result.focusSec)
          if (result.font) {
            const family = result.font.family
            void ensureFont(family, result.font.weights).then((ok) => {
              if (!ok) pushToast('info', `${family} could not be downloaded right now, so it shows in the fallback font. It loads automatically once you are online.`, { id: `font-${family}` })
            })
          }
          // Components record in the Studio, so go there to watch it happen.
          if (result.needsStudio && !inStudio) {
            setView('studio')
            pushToast('success', result.message)
            return true
          }
          pushToast('success', result.message, openStudio ? { action: openStudio } : undefined)
          return true
        }

        case 'html-template': {
          setProgress({ id: item.id, pct: 0 })
          try {
            const captured = await captureHtmlTemplate({
              file: result.file,
              size: result.size,
              durationSec: result.durationSec,
              onProgress: (pct) => setProgress({ id: item.id, pct }),
            })
            const clip: StudioOverlayClip = {
              id: uid(),
              kind: 'overlay',
              track: 1,
              startSec: Math.round(result.atSec * 100) / 100,
              durationSec: result.durationSec,
              name: result.name,
              transitionIn: 'fade',
              transitionOut: 'fade',
              opacity: 1,
              dataUrl: captured.frames[Math.floor(captured.frames.length / 2)] ?? captured.frames[0],
              ...(captured.frames.length > 1 ? { frames: captured.frames, frameFps: captured.frameFps } : {}),
              source: `HTML scene · ${result.file}`,
              x: 0.5,
              y: 0.5,
              scale: 1,
            }
            addStudioClip(project.id, clip)
            requestStudioFocus(clip.id, clip.startSec + Math.min(1, clip.durationSec / 2))
            pushToast('success', `“${result.name}” rendered into a ${result.durationSec}s animated clip (${captured.frames.length} frames).`, openStudio ? { action: openStudio } : undefined)
            return true
          } catch (error) {
            pushToast('error', humanError(error, `Could not render “${result.name}”`))
            return false
          } finally {
            setProgress(null)
          }
        }

        case 'voice-command': {
          const ranNow = runVoicePhrase(result.phrase)
          if (!ranNow) setView('studio')
          pushToast('success', ranNow ? result.message : `${result.message} Opening the Studio to run it.`)
          return true
        }

        case 'link':
          void copyText(result.cue)
          if (result.url) window.open(result.url, '_blank', 'noopener,noreferrer')
          pushToast('info', result.message)
          return true
      }
    },
    [addStudioClip, patchStudio, project, pushToast, setView],
  )

  return { apply, progress }
}
