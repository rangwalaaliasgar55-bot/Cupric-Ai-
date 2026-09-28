# Cupric AI 0.14.1 — connecting two modules that were never called

A patch release. 0.14.0 shipped two new modules that nothing imported, and one
of them made the interface tell you something untrue. Both are now wired, and
both wirings are asserted by a check so they cannot quietly come apart again.

## The motion-craft pass really runs locally now

The Auto polish question offered a choice labelled **"Motion craft — sprung
entrances on a beat"**, hinted *"Runs locally, no AI"*. That hint was false.
`craftPass()` — the deterministic local pass — was written and tested but
never invoked; clicking the choice sent an instruction string to the AI planner
exactly like every other option. So the pass needed a model to be reachable,
took as long as any other request, and produced whatever the model decided
rather than the deterministic result its own tests verified.

`PolishChoice` now carries a `runsLocally` flag and the Studio branches on it:

- the pass is computed in the renderer and the plan appears **instantly**,
- it works with **no model reachable at all**,
- the result is an ordinary reviewable plan marked `source: 'local'`, fully
  editable and undoable in one step,
- a timeline with nothing to fix gets a toast saying so, instead of an empty
  approval card asking you to accept nothing.

The check now counts every hint containing "no AI" and asserts it belongs to a
choice actually flagged local — a label cannot drift away from what runs.

## The eight film styles are reachable

`filmStyles.ts` had the same problem: nothing imported `pickFilmStyle` or
`styleQuestion`, so the style router existed only inside its own test. The
autonomous agent could not use the thing built for it.

The Autonomous screen now has a style picker under the brief, and it follows
the rule the router was written for:

- when the brief gives real evidence, Cupric proposes a style **and quotes the
  words that decided it**, with every other style one click away;
- when the brief does not say, it **asks** — a quarterly report silently
  rendered as a particle swarm is worse than one extra question;
- the chosen style travels into the agent's brief with the Studio pieces it is
  assembled from, its `notFor` list, and the instruction to leave any slot you
  have not filled **visibly empty** rather than inventing content for it.

Choosing nothing still starts a job. The style is guidance, not a gate.

## Also

An audit of all ten modules added in the 0.14 line confirms every one is now
imported by real application code, not only by its test.

## Downloads

- `Cupric-AI-Setup-0.14.1.exe` — NSIS installer.
- `Cupric-AI-0.14.1-x64-Portable.exe` — portable, no install.

Unsigned, so Windows SmartScreen prompts on first run: **More info → Run
anyway**.
