/**
 * L1 — the keyword palette, keywords, and sticky notes painted in it.
 * Re-exported by `core/model.ts`.
 */

/**
 * The palette a keyword can be painted in — and the only set of colours this
 * app ever asks a person to choose from.
 *
 * Eight, and picked as hues rather than as meanings. The first five are the
 * originals and their ids are kept exactly as they were, because they are the
 * wire format: they are stored on every keyword, validated by `s.enum` against
 * this array, and written into backups. `teal` is the id of the blue — a
 * misnomer from the first five minutes of this feature that is now not worth a
 * migration, which is why `TONE_LABEL` below exists to say what each one is
 * actually called.
 *
 * Why a fixed palette rather than a colour wheel: every colour here is drawn as
 * text on its own tinted background in two themes, and each of the eight was
 * measured at 5.1:1 or better against both (`index.css` records the figures).
 * A hex a person types cannot be measured, and the ones people reach for first
 * — a bright yellow, a mid grey — are exactly the ones that disappear against
 * one theme or the other. Sixteen tokens with known contrast beats infinite
 * choice with none.
 *
 * Separation, measured in CIELAB: the closest pair by eye is Grey/Cyan at
 * dE 28. Simulated for deuteranopia the closest is Amber/Red at dE 5.6, which
 * is a pair this palette inherited rather than introduced — the three colours
 * added alongside sit at dE 12 or more from their nearest neighbour. Every
 * swatch carries its name as its accessible name for that reason.
 */

import type { Hex } from './ink'

export const LABEL_TONE_VALUES = [
  'teal',
  'cyan',
  'green',
  'amber',
  'red',
  'pink',
  'violet',
  'gray',
] as const
export type LabelTone = (typeof LABEL_TONE_VALUES)[number]

/**
 * What each colour is called out loud — in the swatch's label, its tooltip and
 * the phone's radio.
 *
 * Here rather than once per app, which is where it was: the web called `teal`
 * "Blue" and the phone called it "Teal", so the same keyword had two different
 * colours depending on which screen you asked. A `Record<LabelTone, string>`
 * annotation is also the only spelling in which adding a colour and forgetting
 * to name it is a compile error.
 */
export const TONE_LABEL: Record<LabelTone, string> = {
  teal: 'Blue',
  cyan: 'Cyan',
  green: 'Green',
  amber: 'Amber',
  red: 'Red',
  pink: 'Pink',
  violet: 'Violet',
  gray: 'Grey',
}

export type Label = {
  id: string
  name: string
  tone: LabelTone
  /**
   * A colour off the spectrum, when one of the eight was not the one.
   *
   * ADDITIVE, and `tone` stays required beside it rather than being replaced by
   * it. Three reasons, in the order they bite:
   *
   *   - `tone` is the wire format. It is on every keyword ever stored, in every
   *     backup, and validated by `s.enum`. Widening that field to "a name or a
   *     hex" would make every `Record<LabelTone, …>` in both apps a lie.
   *   - It is the fallback. `ink` is in `SALVAGEABLE_PROPS`, so a keyword whose
   *     custom colour fails validation comes back in the colour it had before —
   *     rather than the whole keyword being dropped, which is what happens to a
   *     node that fails whole.
   *   - A surface that cannot compute a colour can still draw the preset. There
   *     are fewer of those than there were, but "the chip is blue instead of
   *     the plum you chose" is a better failure than a chip with no colour.
   *
   * Stored as '#rrggbb' — `core/ink.ts` normalises on the way in and derives
   * the three values a chip actually needs, per theme, on the way out.
   */
  ink?: Hex
}

export type KeywordProps = {
  slug: string
  name: string
  tone: LabelTone
  /** A colour off the spectrum. See `Label.ink`, which this is projected into. */
  ink?: Hex
}

/** The longest a sticky note may be: a note, not a document. */
export const MAX_STICKY_TEXT = 500

/** The colour a new sticky takes when none is picked: the colour of a paper sticky. */
export const DEFAULT_STICKY_TONE: LabelTone = 'amber'

export type StickyNoteProps = {
  slug: string
  text: string
  /** From the keyword palette — the one set of colours this app offers. */
  tone: LabelTone
}

/** A sticky note, as the board shows it. */
export type StickyNote = {
  id: string
  text: string
  tone: LabelTone
  createdAt: string
  updatedAt: string
}
