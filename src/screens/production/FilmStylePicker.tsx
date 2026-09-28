/**
 * Which of the eight films the agent should build.
 *
 * The rule this component exists to enforce: Cupric proposes a style only when
 * the brief gives it real evidence, and it shows the evidence — the actual
 * words it matched, quoted back. When the brief does not say, it asks instead
 * of picking, because a quarterly report silently rendered as a particle swarm
 * is worse than one extra question.
 *
 * Whatever is chosen travels into the agent's brief along with the style's
 * `notFor` list, so the agent builds that kind of film and not a generic one.
 */
import { FILM_STYLES, filmStyle, pickFilmStyle, styleQuestion, type FilmStyleId } from '../../lib/studio/filmStyles'
import { cx } from '../../lib/utils'

export function FilmStylePicker({
  brief,
  value,
  onPick,
}: {
  brief: string
  value: FilmStyleId | null
  onPick: (id: FilmStyleId | null) => void
}) {
  const trimmed = brief.trim()
  if (!trimmed) return null

  const suggestion = pickFilmStyle(trimmed)
  const chosen = value ? filmStyle(value) : null

  // Once you have chosen, the card reports the decision and what it still needs.
  if (chosen) {
    return (
      <div className="mt-3 rounded-lg border border-accent/40 bg-accent/5 p-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{chosen.label}</div>
            <div className="mt-0.5 text-xs text-muted">{chosen.blurb}</div>
            <div className="mt-1.5 text-xs text-muted">
              Works best between {chosen.durationSec[0]}s and {chosen.durationSec[1]}s. Built from {chosen.builtFrom.join(', ')}.
            </div>
            {/* What the agent will NOT invent, stated before it starts. */}
            <ul className="mt-1.5 space-y-0.5">
              {chosen.needs.map((need) => (
                <li key={need} className="text-xs text-muted">· {need}</li>
              ))}
            </ul>
            <div className="mt-1.5 text-xs text-muted">
              Anything above you have not given stays a visibly empty slot — the agent will not fill it in for you.
            </div>
          </div>
          <button
            type="button"
            onClick={() => onPick(null)}
            className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-accent hover:text-text"
          >
            Change
          </button>
        </div>
      </div>
    )
  }

  // A confident read: propose it, but show the words that decided it.
  if (suggestion) {
    return (
      <div className="mt-3 rounded-lg border border-line bg-panel-alt p-3">
        <div className="text-xs text-muted">
          Your brief says{' '}
          {suggestion.because.map((word, i) => (
            <span key={word}>
              {i > 0 && ', '}
              <span className="font-mono text-text">“{word}”</span>
            </span>
          ))}
          , so this reads like:
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onPick(suggestion.style.id)}
            className="rounded-lg border border-accent bg-accent/10 px-3 py-1.5 text-left text-xs font-semibold hover:bg-accent/20"
          >
            {suggestion.style.label}
          </button>
          <span className="text-xs text-muted">{suggestion.style.blurb}</span>
        </div>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted underline underline-offset-2">Something else</summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {FILM_STYLES.filter((s) => s.id !== suggestion.style.id).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onPick(s.id)}
                title={s.blurb}
                className="rounded-md border border-line px-2 py-1 text-xs hover:border-accent hover:bg-panel"
              >
                {s.label}
              </button>
            ))}
          </div>
        </details>
      </div>
    )
  }

  // No evidence either way: ask, rather than guess.
  const ask = styleQuestion(trimmed)
  return (
    <div className="mt-3 rounded-lg border border-line bg-panel-alt p-3">
      <div className="text-sm font-semibold">{ask.question}</div>
      <div className="mt-0.5 text-xs text-muted">
        Your brief does not say yet, and Cupric will not pick for you — the answer changes the whole film.
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {ask.options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onPick(option.id)}
            className={cx('max-w-xs rounded-lg border border-line bg-panel px-3 py-2 text-left transition-colors hover:border-accent hover:bg-accent/10')}
          >
            <div className="text-xs font-semibold">{option.label}</div>
            <div className="mt-0.5 text-xs text-muted">{option.hint}</div>
          </button>
        ))}
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-muted underline underline-offset-2">All eight styles</summary>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {FILM_STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onPick(s.id)}
              title={s.blurb}
              className="rounded-md border border-line px-2 py-1 text-xs hover:border-accent hover:bg-panel"
            >
              {s.label}
            </button>
          ))}
        </div>
      </details>
    </div>
  )
}
