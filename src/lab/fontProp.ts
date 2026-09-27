/** Font family names are plain words; anything else is rejected before it reaches CSS. */
export const FONT_FAMILY_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,59}$/
