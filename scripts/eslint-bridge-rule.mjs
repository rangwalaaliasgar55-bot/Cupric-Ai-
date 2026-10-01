/**
 * `no-restricted-syntax` selectors that ban writes to the read-only desktop
 * bridge (window.newbrand / window.northframe). Shared by eslint.config.mjs and
 * scripts/check-bridge.mjs (which also self-tests them against known-bad code).
 *
 * They match on the property NAME, whatever object it hangs off — `window`,
 * `globalThis`, an alias like `const w = window as any`, or a minifier's
 * `nt.newbrand` — because every one of those is the same read-only property.
 */
const NAMES = '/^(newbrand|northframe)$/'
const MSG =
  'window.newbrand / window.northframe are read-only (contextBridge). Writing to them threw "Cannot assign to read only property" and blanked the Studio in 0.10.0. Read via getBridge()/getIpc(); keep renderer globals under their own name (e.g. window.__newbrandStudio).'

export const BRIDGE_RESTRICTED_SYNTAX = [
  // x.newbrand = …   x['newbrand'] = …   x.newbrand ??= …
  { selector: `AssignmentExpression > MemberExpression.left[property.name=${NAMES}]`, message: MSG },
  { selector: `AssignmentExpression > MemberExpression.left[property.value=${NAMES}]`, message: MSG },
  // x.newbrand.studio = …   x.newbrand['studio'] = …
  { selector: `AssignmentExpression > MemberExpression.left > MemberExpression.object[property.name=${NAMES}]`, message: MSG },
  { selector: `AssignmentExpression > MemberExpression.left > MemberExpression.object[property.value=${NAMES}]`, message: MSG },
  // delete x.newbrand   delete x.newbrand.studio
  { selector: `UnaryExpression[operator='delete'] MemberExpression[property.name=${NAMES}]`, message: MSG },
  { selector: `UnaryExpression[operator='delete'] MemberExpression[property.value=${NAMES}]`, message: MSG },
  // x.newbrand++ and friends
  { selector: `UpdateExpression > MemberExpression[property.name=${NAMES}]`, message: MSG },
  // Object.assign(window.newbrand, …) / Object.defineProperty(window.newbrand, …) / Reflect.set(window.newbrand, …)
  {
    selector: `CallExpression[callee.property.name=/^(assign|defineProperty|defineProperties|deleteProperty|set|setPrototypeOf)$/] > MemberExpression.arguments[property.name=${NAMES}]`,
    message: MSG,
  },
  // Object.defineProperty(window, 'newbrand', …) / Reflect.deleteProperty(window, 'newbrand')
  {
    selector: `CallExpression[callee.property.name=/^(defineProperty|deleteProperty|set)$/] > Literal.arguments[value=${NAMES}]`,
    message: MSG,
  },
]
