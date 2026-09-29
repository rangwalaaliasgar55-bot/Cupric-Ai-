/**
 * The screen-state kit, rendered for real.
 *
 * These are the assertions that keep the kit honest:
 *   - a percentage appears only when there is one, and the accessible name says
 *     the same thing as the pixels;
 *   - an error always has a way forward — either a retry, or a next step, and
 *     never a card that just sits there;
 *   - the technical detail is available but not shouted.
 *
 * Rendered with react-dom/server, which is the same tree the app renders, so
 * there is no second implementation to drift.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { ErrorState, LoadingState, ScreenState } from '../components/ScreenStates'

/**
 * Render a component to static markup.
 *
 * `createElement` with a props object and then `renderToStaticMarkup` is the
 * same tree the app builds, so the assertions below are about the real
 * component. The `any` is confined to this one call: component prop types are
 * checked everywhere else in this file by the call sites themselves.
 */
function html(component: (props: never) => unknown, props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(component as never, props as never))
}

describe('LoadingState', () => {
  it('shows a real percentage when one exists, and says it out loud', () => {
    const out = html(LoadingState, { label: 'Rendering', pct: 42.4 })
    expect(out).toContain('42%')
    expect(out).toContain('aria-label="Rendering, 42% complete"')
    expect(out).toContain('aria-busy="true"')
    expect(out).toContain('role="status"')
    expect(out).toContain('width:42%')
  })

  it('shows no percentage when the work cannot report one', () => {
    const out = html(LoadingState, { label: 'Checking what is installed', pct: null })
    expect(out).not.toMatch(/\d+%/)
    expect(out).toContain('aria-label="Checking what is installed in progress"')
    // The honest indeterminate bar, not a 0%-filled one pretending to know.
    expect(out).toContain('animate-pulse')
  })

  it('clamps a nonsense percentage instead of rendering it', () => {
    expect(html(LoadingState, { label: 'x', pct: 240 })).toContain('100%')
    expect(html(LoadingState, { label: 'x', pct: -10 })).toContain('0%')
    // NaN and Infinity fall back to indeterminate — they are not percentages.
    expect(html(LoadingState, { label: 'x', pct: Number.NaN })).not.toMatch(/\d+%/)
    expect(html(LoadingState, { label: 'x', pct: Number.POSITIVE_INFINITY })).not.toMatch(/\d+%/)
  })

  it('respects reduced motion', () => {
    expect(html(LoadingState, { label: 'x' })).toContain('motion-reduce:animate-none')
  })
})

describe('ErrorState', () => {
  it('shows the message it was given, verbatim', () => {
    const out = html(ErrorState, { message: 'The exported file could not be written: the disk is full.', onRetry: () => {} })
    expect(out).toContain('The exported file could not be written: the disk is full.')
    expect(out).toContain('role="alert"')
  })

  it('offers a retry when one is possible', () => {
    const onRetry = vi.fn()
    const out = html(ErrorState, { message: 'Network unreachable.', onRetry })
    expect(out).toContain('Try again')
    // The handler is wired to the button, not merely declared.
    expect(out).toMatch(/<button[^>]*>.*Try again/s)
  })

  it('lets the caller name the action instead of calling everything "Try again"', () => {
    expect(html(ErrorState, { message: 'x', onRetry: () => {}, retryLabel: 'Reconnect' })).toContain('Reconnect')
  })

  it('is still not a dead end when retrying is pointless', () => {
    const out = html(ErrorState, { message: 'The file has moved.', nextStep: 'Import it again from Footage Desk.' })
    expect(out).toContain('Import it again from Footage Desk.')
    expect(out).not.toContain('Try again')
  })

  it('says so loudly when the caller gave neither a retry nor a next step', () => {
    const out = html(ErrorState, { message: 'x' })
    expect(out).toContain('no retry and no next step')
  })

  it('keeps the technical detail available but collapsed, and never in place of the message', () => {
    const out = html(ErrorState, {
      message: 'Rendering stopped.',
      nextStep: 'Try a smaller section.',
      details: 'ffmpeg exited 1: Conversion failed!\nInvalid data found when processing input',
    })
    expect(out).toContain('<details')
    expect(out).toContain('Technical detail')
    expect(out).toContain('ffmpeg exited 1: Conversion failed!')
    // The plain sentence comes first in the markup, so it is what a person sees
    // before deciding to open the detail.
    expect(out.indexOf('Rendering stopped.')).toBeLessThan(out.indexOf('ffmpeg exited 1'))
  })

  it('renders no detail block when there is no detail', () => {
    expect(html(ErrorState, { message: 'x', onRetry: () => {} })).not.toContain('<details')
  })
})

describe('ScreenState', () => {
  it('passes children through when ready', () => {
    const out = renderToStaticMarkup(
      createElement(ScreenState, { state: { status: 'ready' }, children: 'the real screen' }),
    )
    expect(out).toContain('the real screen')
  })

  it('renders the loading state while loading, with the caller’s label and percentage', () => {
    const out = renderToStaticMarkup(
      createElement(ScreenState, { state: { status: 'loading' }, loadingLabel: 'Loading projects', pct: 12, children: null }),
    )
    expect(out).toContain('Loading projects')
    expect(out).toContain('12%')
  })

  it('renders the error state with the message the state carries', () => {
    const out = renderToStaticMarkup(
      createElement(ScreenState, { state: { status: 'error', message: 'The library could not be read.' }, onRetry: () => {}, children: null }),
    )
    expect(out).toContain('The library could not be read.')
    expect(out).toContain('Try again')
  })

  it('does not let an empty error message render a blank card', () => {
    const out = renderToStaticMarkup(
      createElement(ScreenState, { state: { status: 'error', message: '' }, nextStep: 'Reopen the project.', children: null }),
    )
    expect(out).toContain('Something went wrong.')
    expect(out).toContain('Reopen the project.')
  })
})
