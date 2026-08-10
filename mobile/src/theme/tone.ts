import { useColors } from '@/theme/theme-context'

/**
 * The roles text can play, named rather than coloured.
 *
 * A screen asks for `tone="danger"`, never for `#c81e1e` — so a palette change
 * reaches every string in the app without a screen being opened, and the colour
 * law stays enforceable: `danger` is past due and nothing else.
 */
export type Tone =
  | 'primary'
  | 'secondary'
  | 'muted'
  | 'accent'
  | 'danger'
  | 'warning'
  | 'success'
  | 'info'
  | 'inverse'

export function useTone(tone: Tone = 'primary') {
  const c = useColors()
  const map: Record<Tone, string> = {
    primary: c.text1,
    secondary: c.text2,
    muted: c.text3,
    accent: c.accent,
    danger: c.danger,
    warning: c.warning,
    success: c.success,
    info: c.info,
    inverse: c.accentFg,
  }
  return map[tone]
}
