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
}

/** What each tone is called out loud. 'teal' is the type's name for the blue. */
export const toneName: Record<LabelTone, string> = {
  teal: 'Blue',
  green: 'Green',
  amber: 'Amber',
  red: 'Red',
  gray: 'Grey',
}

export const TONE_ORDER = [
  'teal',
  'green',
  'amber',
  'red',
  'gray',
] as const satisfies readonly LabelTone[]

/** "9 records" / "1 record" — used in the menu, the confirm and the undo toast. */
export function usage(n: number) {
  return n === 1 ? '1 record' : `${n} records`
}
