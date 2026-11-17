/**
 * The icons that point somewhere, and so have to turn round in Arabic and Urdu.
 *
 * `LocaleProvider` forces right-to-left for those languages, and React Native
 * then mirrors every `flexDirection: 'row'` — but not the glyphs. Feather's are
 * characters from a private-use range, which bidi never mirrors, so in the
 * Calendar header "Previous" (chevron-left) moved to the right and "Next" to
 * the left, both arrows pointing inward at Today; every disclosure chevron
 * pointed back against the reading direction. The web flips the same controls
 * with `rtl:-scale-x-100`; `Icon` does it here, for every name below.
 *
 * Pure, so the list is tested without loading React Native.
 */
const DIRECTIONAL: ReadonlySet<string> = new Set([
  'chevron-left',
  'chevron-right',
  'chevrons-left',
  'chevrons-right',
  'arrow-left',
  'arrow-right',
  'arrow-up-left',
  'arrow-up-right',
  'arrow-down-left',
  'arrow-down-right',
  'corner-down-right',
  'corner-down-left',
  'corner-up-right',
  'corner-up-left',
  'log-in',
  'log-out',
  'skip-back',
  'skip-forward',
])

/** True for a glyph that points along the line of text. */
export const isDirectional = (name: string): boolean => DIRECTIONAL.has(name)

/** The transform that turns a directional glyph round when the layout is right-to-left. */
export function mirrorFor(name: string, rtl: boolean): { transform: [{ scaleX: -1 }] } | undefined {
  return rtl && isDirectional(name) ? { transform: [{ scaleX: -1 }] } : undefined
}
