import type { ChipTone } from '@/components/ui/Chip'
import type { Palette } from '@/theme/tokens'

export type ToneSkin = { bg: string; border: string; fg: string }

/**
 * A tone's three colours — fill, edge, ink — for whichever theme is on screen.
 *
 * Shared with the one other surface painted in a keyword's colour, the
 * Today screen's sticky notes: a note in Amber should be the amber a keyword
 * chip is, and a second table would drift the first time a colour moved.
 */
export function toneSkin(tone: ChipTone, c: Palette): ToneSkin {
  const tones: Record<ChipTone, ToneSkin> = {
    neutral: { bg: c.well, border: c.hairline, fg: c.text2 },
    gray: { bg: c.well, border: c.hairline, fg: c.text2 },
    teal: { bg: c.infoSoft, border: c.infoBorder, fg: c.info },
    amber: { bg: c.warningSoft, border: c.warningBorder, fg: c.warning },
    red: { bg: c.dangerSoft, border: c.dangerBorder, fg: c.danger },
    green: { bg: c.successSoft, border: c.successBorder, fg: c.success },
    // The three a keyword can take that no status owns. Same hexes as the web
    // app's `--kw-*` tokens; `theme/tokens.ts` is where they are transcribed.
    cyan: { bg: c.kwCyanSoft, border: c.kwCyanBorder, fg: c.kwCyan },
    pink: { bg: c.kwPinkSoft, border: c.kwPinkBorder, fg: c.kwPink },
    violet: { bg: c.kwVioletSoft, border: c.kwVioletBorder, fg: c.kwViolet },
  }
  return tones[tone]
}
