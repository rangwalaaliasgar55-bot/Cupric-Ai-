# Phase 1.1 — AI Backend / Brain: provider layer

Status: **implemented and verified in this Linux dev container; Windows end-to-end still UNVERIFIED.**
Every "verified" line below names the command that produced it. Nothing here was run on Windows,
so the desktop-GUI flows are listed as UNVERIFIED with the exact steps to close them.

The four mandatory sections, in order: **what was found → what changed and why → verification
performed + observed result → what is still broken / incomplete / UNVERIFIED.**

---

## 1. What was found (file/line at the commit this phase started from, `ffae6ef`)

| # | Finding | Where |
|---|---|---|
| 1.1 | A third-party **keyless** service (Pollinations) was the default brain for a fresh install, and its ad-laden replies were **regex-rewritten** before the app would use them: `stripSponsored()` removed sponsor blocks, `---`-delimited footers and `🌸 Ad` lines from every keyless answer. The app's own copy sold this to the user as "the built-in free brain". | `electron/free-brain.cjs:112-120` (`stripSponsored`, `AD_LINE`), `:149` (`const clean = route.kind === 'keyless' ? stripSponsored(text) : text`), `:31-38` (`KEYLESS_ENDPOINTS`, one entry, `minIntervalMs: 15_500`), `electron/main.cjs:636-645` (autoDiscover picks it), `:2592-2603` (its completion branch) |
| 1.2 | **No error taxonomy.** Failures were prose strings joined with ` \| `, then re-classified by regex at three different places (`isQuotaError`, `retryableAiError`, `/404\|model_not_found/`). The UI received "whatever the first provider said". | `electron/main.cjs:2196-2260` (`fetchOrExplain`), `:2620-2680` (join into one `Error`), `:2704-2712` (`retryableAiError`) |
| 1.3 | **Only two providers were representable**: Gemini (via `@google/generative-ai`) and any OpenAI-compatible endpoint through the "OpenCode" settings. There was no OpenAI adapter, no Anthropic adapter, and no way for the user to say "use this provider" — only a base URL + key pair under an OpenCode-shaped name. | `electron/main.cjs:686-701` (`aiSettings`), `:297-307` (`geminiApiKey`/`geminiModel`), `src/app-shell/AskPanel.tsx:495-660` (the settings drawer) |
| 1.4 | Retry policy was **split and duplicated**: `freeBrain.BACKOFF_MS = [1000, 4000]` inside the route walker, `AI_BACKOFF_MS = [1000, 4000]` again around it in `completeWithFallback`, and per-model Gemini cooldowns on top. Nothing reported how many attempts a call took. | `electron/free-brain.cjs:36`, `electron/main.cjs:2590`, `:2273-2320` |
| 1.5 | **No local-server detection in the UI.** Discovery walked `:4096 → :11434 → :1234 → :8080` silently and the Settings drawer could only show a hardcoded OpenRouter free-model preset list plus a "Load" button that hit `opencode:listModels`. | `electron/main.cjs:2340-2360`, `src/app-shell/AskPanel.tsx:280-300` |
| 1.6 | The user-visible status was **not derived from anything real**: `statusDots: { gemini: 'unknown', zen: …, local: … }` — Gemini was hardcoded to `'unknown'` whether or not a key existed. | `electron/main.cjs:668-675` |
| 1.7 | Copy promised the removed capability: greeting text, the "Why:" line under Auto, the model browser's empty state, and `humanError`'s no-provider message all told the user a "built-in free brain" would answer with no setup. | `src/app-shell/AskPanel.tsx:95`, `:531`, `src/app-shell/FreeModels.tsx:50`, `src/lib/humanError.ts:45-50` |

## 2. What changed and why

### 2.1 A real provider layer with typed errors — new `electron/ai-providers.cjs` (350 lines)

```
generate(config, request, options) → { ok: true, text, model, usage, attempts } 
                                   | { ok: false, error: { code, detail, status, retryable, action, message } }
```

- **Five codes the brief asked for** — `NO_KEY_CONFIGURED`, `RATE_LIMITED`, `NETWORK_ERROR`,
  `INVALID_RESPONSE`, `TIMEOUT` — plus `UNAUTHORIZED`, `MODEL_NOT_FOUND`, `BAD_REQUEST`,
  `SERVER_ERROR`, `CANCELLED`. Each has its own user-facing sentence and its own action
  (`ERROR_SPEC`, `ai-providers.cjs:47-58`), produced by `describeError()`.
- **Real adapters, one interface**: OpenAI + every OpenAI-compatible local server
  (`/chat/completions`), Anthropic (`/v1/messages` with `x-api-key`, `anthropic-version`,
  a `system` field and mandatory `max_tokens`), Gemini (`:generateContent?key=…`,
  `systemInstruction`, image `inlineData`). Request and response shapes are pure functions
  (`buildRequest`, `parseResponse`), so they are unit-tested rather than hoped for.
- **Failure classification that reads reality**: `classifyStatus` maps 401/403→UNAUTHORIZED,
  429→RATE_LIMITED, 5xx→SERVER_ERROR, and only calls a 400/404 a `MODEL_NOT_FOUND` when the
  body actually names a model; `classifyTransportError` reads Node's hidden `err.cause.code`
  (`ECONNREFUSED`/`ENOTFOUND`/`EAI_AGAIN`), so a refused localhost connection is a network
  error with a sentence, not `fetch failed`.
- **Retry that stops**: bounded schedule `[1000, 4000]`, only for `retryable` codes, and the
  attempt count is part of the result.
- **The provider's text is returned byte-for-byte.** No stripping, no trimming, no cleanup.
- **Injection for tests**: `transport`, `sleep`, `signal` are parameters; the default transport
  is the real `fetch` (`ai-providers.cjs:239`, and asserted by a test that reads the source). No mocking library is needed to prove the real
  path, because a real HTTP server is used in the check script.

### 2.2 Settings → provider, as its own tested mapping — new `electron/ai-provider-config.cjs` (209 lines)

`providerConfig(settings, env)` is the single place that decides which provider is in use:

- explicit `aiKind` (`openai` | `anthropic` | `gemini` | `local`) wins;
- otherwise a saved/env key is detected, then a local base URL, then nothing;
- **nothing** means `kind: 'none'` with a `NO_KEY_CONFIGURED` error and a `fix` sentence — not a
  silent substitution;
- a chosen-but-unkeyed provider reports `NO_KEY_CONFIGURED` **for that provider**, so the user is
  told their own choice is incomplete instead of being switched to a different vendor;
- existing installs that configured an OpenAI-compatible endpoint through the OpenCode-shaped
  settings keep working unchanged (`source: 'legacy-opencode'`);
- `providerSummary()` is the key-free report the UI renders; `listModelsRequest()`/`parseModels()`
  reach each vendor's real `/models` endpoint and never invent a row.

### 2.3 The main process now routes through the layer — `electron/main.cjs`

- `configuredProvider()` (`:296`) wraps the mapping; `geminiApiKey()` (`:286`) now accepts
  `GOOGLE_API_KEY`/`GEMINI_API_KEY` through the same resolver.
- `brainRoutes()` (`:2605`) puts the configured provider **first** as a `provider` route; the
  legacy OpenCode/Gemini/local walk stays for everything else.
- `completeWithFallback()` (`:2735-2755`) calls `aiProviders.generate(route.config, …, { backoffMs: [] })`
  and rethrows the typed error with its code and `fix`. Retries now have **one owner per path**:
  the layer retries when it is called directly (`ai:testProvider`), the router retries when it owns
  the call — previously both retried, so one logical request could become nine.
- The no-route case (`:2700-2712`) names the missing provider and its fix instead of a generic
  "no provider" line.
- `autoDiscover()` no longer consults a third-party service: with no key and no local server it
  returns `kind: 'none'`, `setupRequired: true`, and a reason that states both facts
  (`main.cjs:650-661`).
- `statusDots` are derived from what discovery actually found (`:681-690`), not hardcoded.
- Four new IPC handlers, all registered in `electron/preload.cjs:10`:
  `ai:providerState`, `ai:testProvider` (one real minimal completion, reporting code + fix + ms + attempts),
  `ai:listModels` (the vendor's own list), `ai:detectLocal` (real probes of 4096/11434/1234/8080).
- `liveAiChat` (`:3064`) attaches the typed fix to what crosses IPC, and the rundown queue only
  queues polish work when a provider can actually answer (`:3107`).

### 2.4 The third-party keyless brain and the reply rewriter are gone — `electron/free-brain.cjs`

- `KEYLESS_ENDPOINTS` is now `[]` (`:27`), with a comment recording why (Pollinations was removed;
  LLM7 was never embedded because its terms forbid it).
- `stripSponsored()` and `AD_LINE` are **deleted** (the module now jumps from the keyless comment block at `:99-106` straight to `keylessRevoked`); `chatOnce` returns the provider's
  text unchanged (`:150-153`). The old tests that asserted ad-stripping were replaced by tests that
  assert verbatim passthrough.
- `keylessRevoked()` stays (a caller may still configure an endpoint explicitly) and is still covered.

### 2.5 Renderer: real settings UI + typed client

- `src/lib/aiProvider.ts` — typed wrappers over the four IPC handlers, plus `providerErrorText()`.
- `src/app-shell/ProviderSettings.tsx` — four providers as radio buttons with per-provider key and
  model fields; **Save**, **Test connection** (real request; success shows model, latency and
  attempt count; failure shows the code, the sentence and the fix, with a **Retry test** button),
  **Load models** (real `/models`), **Detect** local servers, and an explicit
  "no provider configured" state that names the fix. Keys are write-only: the field shows whether a
  key is saved and whether it came from the environment.
- Mounted in the Ask panel's settings drawer (`AskPanel.tsx:499`), above the legacy OpenCode section
  rather than replacing it (that path still serves existing installs).
- Removed the promises the code can no longer keep: the greeting, the Auto "Why:" line, the model
  browser's empty state and `humanError`'s no-provider sentence no longer claim a built-in free brain
  (`AskPanel.tsx:95,531`, `FreeModels.tsx:50`, `humanError.ts:45`).

### 2.6 Deliberate deviation from the brief, stated plainly

The brief suggested `openai` / `@anthropic-ai/sdk` / `ollama` / `p-retry`. This implementation uses
**zero new dependencies**: the three REST shapes are ~120 lines of pure request/response code, and
the retry policy had to return a *typed code plus an action* — which the SDKs do not surface
uniformly. The trade-off is explicit: fewer moving parts and no extra licences in a 200 MB
Windows installer, at the cost of maintaining those shapes ourselves. Because every call funnels
through `ai-providers.cjs`, swapping in the official SDKs later is a contained change. If you want
the SDKs in, say so and it is a small follow-up — it is not hidden behind an abstraction that would
make it hard.

## 3. Verification performed, and what was observed

| Check | Command | Result |
|---|---|---|
| Provider unit tests (taxonomy, request shapes, retry, verbatim text) | `npx vitest run src/tests/ai-providers.test.ts` | **24 passed** |
| Config mapping unit tests (key precedence, honest none-state, legacy compatibility, `/models` parsing) | `npx vitest run src/tests/ai-provider-config.test.ts` | **12 passed** |
| Whole suite | `npm test` | **4 files, 67 passed / 1 skipped** |
| **Real HTTP**, OpenAI-compatible + Anthropic servers on 127.0.0.1, real `fetch`, real delays | `node scripts/check-ai-providers.mjs` | **37 assertions passed** — includes: bearer/system/`response_format` arrive as built; Anthropic receives `x-api-key`, `anthropic-version` and `max_tokens`; a 429 is retried with a **measured ≥5 s** backoff and then succeeds in 3 attempts; 401→UNAUTHORIZED, 404-model→MODEL_NOT_FOUND, non-JSON→INVALID_RESPONSE, empty→INVALID_RESPONSE, stalled→TIMEOUT (single attempt in 0.8 s with no backoff schedule; 3 attempts bounded under 12 s with the default); missing key → **zero HTTP requests** (server-counted); a closed port → NETWORK_ERROR without the string `fetch failed`; an ad-looking reply is **not** rewritten; settings → config → generate reaches the server (the `ai:testProvider` path) |
| Removed-brain contradictions | `node scripts/check-ai-connections.mjs` | **passed** — asserts `KEYLESS_ENDPOINTS.length === 0`, that no shipping code names pollinations/llm7 (comments stripped before scanning — this is why an earlier draft of the same assertion failed, and the failure was real: the module header names Pollinations), that `stripSponsored` is **absent from the exports** rather than merely unused, that provider text is verbatim, and that a fresh install routes nothing and reports `offline brain` |
| Types | `npx tsc --noEmit` | clean |
| Whole release chain (now **77** checks, was 76) | `node scripts/run-checks.mjs` | **`BUILD PASSED: all 77 checks`**, incl. `✓ 17/77 check-ai-connections.mjs`, `✓ 18/77 check-ai-providers.mjs`, `✓ 72/77 check-ui-audit.mjs` (0 remaining debt) |
| UI rules | `node scripts/check-ui-audit.mjs` | passed, 82 files, no recorded debt — the new panel's three `disabled` buttons were given explanatory `title`s rather than added to a baseline |

Negative evidence (things that really fail, so the green is not vacuous):

- The first version of the "no third-party service" assertion **failed**, because the module header
  comment still contained the word `stripSponsored`. Fix: scan code with comments stripped, and
  assert on the export surface (`'stripSponsored' in brain === false`) — a stronger statement than a
  grep.
- The first version of the timeout assertion **failed** with 8,007 ms because the layer retried the
  timeout (1 s + 4 s + 3×0.7 s). The code was right and the assertion was wrong; it now asserts both
  behaviours separately.
- `check-ui-audit` **failed** on the new panel (`disabled-help: 3`) until the buttons explained
  themselves. No baseline entry was added.

## 4. Still broken, incomplete, or UNVERIFIED

1. **UNVERIFIED on Windows.** No part of this phase was exercised on Windows 10/11. This container
   has no Electron binary (its download fails on TLS) and no Chrome, so the GUI never ran here.
   Verification that is still required, in order:
   1. `npm ci` then `npm run build` on Windows — expect `BUILD PASSED: all 77 checks`.
   2. Launch the app, open the Ask panel, click the gear: the provider panel must show
      **"No AI provider configured"** with the fix line (no key, no Ollama running).
   3. Ask a question: the answer must be labelled as the offline planner (`source: 'local'`), and
      `%APPDATA%\NewBrand\logs` must contain no request to a third-party service.
   4. Paste a real OpenAI key → **Save** → **Test connection**: expect "... answered in <ms> ms" and
      the model's reply; then **Load models** must list the account's models.
   5. Test a **wrong** key: expect `UNAUTHORIZED` and "Check the key in Settings"; test with the
      network cable out: expect `NETWORK_ERROR`; test with a key whose account is rate-limited:
      expect `RATE_LIMITED` and a retry that succeeds.
   6. Start Ollama with one model, press **Detect**: expect the server row with its model; ask a
      question and confirm the reply is attributed to the local model.
   7. Anthropic and Gemini with real keys: same three steps, confirming Anthropic receives
      `max_tokens` (a model picker that returns models is proof the headers were accepted).
2. **UNVERIFIED: `scripts/live-acceptance-zero-setup.playwright.mjs`.** Its AI mocks were updated to
   the new contract (provider object, no keyless rows, removed "free brain" copy), but it cannot run
   here — no Chrome, and it needs `vite preview`. It also still asserts on the *mocked* bridge, so it
   is not evidence about the real main process.
3. **The provider panel is functional, not designed.** It lives inside the Ask drawer's settings area
   with the existing hand-rolled styles. Phase 3 (design system) is where it gets a real layout —
   until then it is honest and usable, not pretty.
4. **`src/lib/gemini.ts` still falls back to the deterministic planner on any failure**, and appends
   the reason. That is deliberate (the timeline must not be held hostage) and it *labels* the source,
   but the label is a sentence rather than the typed code; a `{ code, message, fix }` reply shape
   across IPC would be better and is scheduled with the Phase 1.2 automation rewrite.
5. **`ai:testProvider` is not reachable from any script here** (the handlers live in `main.cjs`,
   which needs Electron). What is tested is every piece it composes: settings → config (unit),
   config → request → socket → typed result (real HTTP). The handler itself is 20 lines of glue and
   is on the Windows checklist above.
6. **`resources/libraries-dev/review.json` and `resources/packs/index.json`** are rewritten with
   line-number churn by the build; they are included in the commit because ignoring them leaves a
   dirty tree, but they are generated artifacts that arguably should not be tracked.
7. **`free-brain.cjs` still exists** for the legacy local/OpenCode walking path and the model
   catalogue. Phase 1.1 removed its third-party default and its reply rewriting; retiring the module
   entirely belongs with Phase 1.2, once the OpenCode-shaped settings are themselves migrated.
