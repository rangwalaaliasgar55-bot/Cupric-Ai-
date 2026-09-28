/**
 * `no-restricted-syntax` selectors that ban writes to the read-only desktop
 * bridge (window.cupric / window.northframe). Shared by eslint.config.mjs and
 * scripts/check-bridge.mjs (which also self-tests them against known-bad code).
 *
 * They match on the property NAME, whatever object it hangs off — `window`,
 * `globalThis`, an alias like `const w = window as any`, or a minifier's
 * `nt.cupric` — because every one of those is the same read-only property.
 */
const NAMES = '/^(cupric|northframe)$/'
const MSG =
  'window.cupric / window.northframe are read-only (contextBridge). Writing to them threw "Cannot assign to read only property" and blanked the Studio in 0.10.0. Read via getBridge()/getIpc(); keep renderer globals under their own name (e.g. window.__cupricStudio).'

export const BRIDGE_RESTRICTED_SYNTAX = [
  // x.cupric = …   x['cupric'] = …   x.cupric ??= …
  { selector: `AssignmentExpression > MemberExpression.left[property.name=${NAMES}]`, message: MSG },
  { selector: `AssignmentExpression > MemberExpression.left[property.value=${NAMES}]`, message: MSG },
  // x.cupric.studio = …   x.cupric['studio'] = …
  { selector: `AssignmentExpression > MemberExpression.left > MemberExpression.object[property.name=${NAMES}]`, message: MSG },
  { selector: `AssignmentExpression > MemberExpression.left > MemberExpression.object[property.value=${NAMES}]`, message: MSG },
  // delete x.cupric   delete x.cupric.studio
  { selector: `UnaryExpression[operator='delete'] MemberExpression[property.name=${NAMES}]`, message: MSG },
  { selector: `UnaryExpression[operator='delete'] MemberExpression[property.value=${NAMES}]`, message: MSG },
  // x.cupric++ and friends
  { selector: `UpdateExpression > MemberExpression[property.name=${NAMES}]`, message: MSG },
  // Object.assign(window.cupric, …) / Object.defineProperty(window.cupric, …) / Reflect.set(window.cupric, …)
  {
    selector: `CallExpression[callee.property.name=/^(assign|defineProperty|defineProperties|deleteProperty|set|setPrototypeOf)$/] > MemberExpression.arguments[property.name=${NAMES}]`,
    message: MSG,
  },
  // Object.defineProperty(window, 'cupric', …) / Reflect.deleteProperty(window, 'cupric')
  {
    selector: `CallExpression[callee.property.name=/^(defineProperty|deleteProperty|set)$/] > Literal.arguments[value=${NAMES}]`,
    message: MSG,
  },
]
