import { TONE_LABEL } from '@jojo/service/core/model'
import { LABEL_TONE_VALUES } from '@jojo/service/core/model'
import type { LabelTone } from '@/data/labels'

/**
 * How a keyword is drawn and how its count is worded.
 *
 * A plain module rather than an export off one of the component files: the
 * chips, the swatches, the chip menu and the delete confirm all need these, and
 * a constant exported beside a component is what breaks fast refresh for that
 * component's whole file.
 */

export const toneClass: Record<LabelTone, string> = {
  teal: 'border-info-border bg-info-soft text-info',
  amber: 'border-warning-border bg-warning-soft text-warning',
  red: 'border-danger-border bg-danger-soft text-danger',
  green: 'border-success-border bg-success-soft text-success',
  gray: 'border-hairline bg-well text-text-2',
  /*
   * The three that are a keyword's alone, through their own tokens.
   *
   * Arbitrary values rather than theme colours, and that is deliberate: a
   * `--color-cyan` registered in `@theme` would shadow Tailwind's own `cyan-*`
   * scale for the whole app. Written this way the reference is also CHECKED —
   * `ui/theme-tokens.test.ts` sweeps every `var(--x)` inside brackets and fails
   * on one the stylesheet does not declare, which is the failure mode with no
   * symptom: an unresolved custom property paints nothing and reports nothing.
   */
  cyan: 'border-[var(--kw-cyan-border)] bg-[var(--kw-cyan-soft)] text-[var(--kw-cyan)]',
  pink: 'border-[var(--kw-pink-border)] bg-[var(--kw-pink-soft)] text-[var(--kw-pink)]',
  violet: 'border-[var(--kw-violet-border)] bg-[var(--kw-violet-soft)] text-[var(--kw-violet)]',
}

/**
 * Solid fills for the swatches. The chip backgrounds above are the `-soft`
 * steps, which at swatch size are five near-identical pale discs — you cannot
 * pick a colour from a palette you cannot tell apart.
 */
export const toneFill: Record<LabelTone, string> = {
  teal: 'bg-info',
  amber: 'bg-warning',
  red: 'bg-danger',
  green: 'bg-success',
  gray: 'bg-text-3',
  cyan: 'bg-[var(--kw-cyan)]',
  pink: 'bg-[var(--kw-pink)]',
  violet: 'bg-[var(--kw-violet)]',
}

/**
 * What each colour is called out loud.
 *
 * Re-exported from the model rather than declared here. It was declared here,
 * and the phone declared its own with `teal: 'Teal'` against this file's
 * `teal: 'Blue'` — one keyword, two names, depending on which screen you asked.
 */
export const toneName = TONE_LABEL

/**
 * The order the swatches are offered in — the palette's own, which runs round
 * the wheel and ends on grey.
 *
 * It was a second array listing the five by hand, which is the shape of thing
 * that silently offers four after somebody adds a colour. `LABEL_TONE_VALUES`
 * is also what `s.enum` validates against, so this offers exactly what will
 * save.
 */
export const TONE_ORDER = LABEL_TONE_VALUES

/** "9 records" / "1 record" — used in the menu, the confirm and the undo toast. */
export function usage(n: number) {
  return n === 1 ? '1 record' : `${n} records`
}
