/**
 * The marks a person has made, before any of them is a PDF object.
 *
 * Held as plain data for as long as possible. The tool has to draw them on
 * screen, list them, let one be deleted and only then write them into the file
 * — and a pdf-lib annotation dictionary can do none of those things, because it
 * belongs to a document that has not been created yet.
 *
 * Coordinates in here are already PDF space (see `geometry.ts`). Converting at
 * the moment of the gesture, rather than at save time, means a highlight does
 * not move when the page is re-rendered at a different zoom.
 */
import type { Point, Quad } from './geometry'

export type HighlightColour = {
  readonly id: string
  readonly label: string
  /** For the swatch and the on-screen overlay. */
  readonly hex: string
}

/**
 * Five, and no picker.
 *
 * A highlight is read through the text it covers, so the useful axis is "can I
 * still read the words", not "which of 16 million". These are the five a
 * highlighter pen comes in, at a lightness that keeps black text legible under
 * them at the 0.4 alpha `/CA` is written with.
 */
export const HIGHLIGHT_COLOURS: readonly HighlightColour[] = [
  { id: 'yellow', label: 'Yellow', hex: '#ffe14d' },
  { id: 'green', label: 'Green', hex: '#8ce99a' },
  { id: 'blue', label: 'Blue', hex: '#74c0fc' },
  { id: 'pink', label: 'Pink', hex: '#ffa8c5' },
  { id: 'orange', label: 'Orange', hex: '#ffc078' },
]

export const DEFAULT_COLOUR = HIGHLIGHT_COLOURS[0] as HighlightColour

export function colourById(id: string): HighlightColour {
  return HIGHLIGHT_COLOURS.find((colour) => colour.id === id) ?? DEFAULT_COLOUR
}

/**
 * '#ffe14d' -> [1, 0.882, 0.302].
 *
 * PDF colour components are 0–1 floats, not bytes; writing 255 into a `/C`
 * array is not a bright colour, it is out of range, and viewers clamp it to
 * white — a highlight that appears to have vanished. Three-digit hex is
 * accepted because that is how half the palettes in the world are written.
 */
export function hexToPdfRgb(hex: string): readonly [number, number, number] {
  const text = hex.trim().replace(/^#/, '')
  const full =
    text.length === 3 ? [...text].map((character) => character + character).join('') : text
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return [0, 0, 0]
  const byte = (at: number) => Number.parseInt(full.slice(at, at + 2), 16) / 255
  return [byte(0), byte(2), byte(4)]
}

export type Highlight = {
  readonly id: string
  readonly kind: 'highlight'
  /** 0-based, matching every page index in this app. */
  readonly page: number
  readonly quads: readonly Quad[]
  readonly colourId: string
  /** The words underneath, kept so the list can show what was marked. */
  readonly text: string
  readonly note: string
}

export type Note = {
  readonly id: string
  readonly kind: 'note'
  readonly page: number
  readonly at: Point
  readonly body: string
}

export type Annotation = Highlight | Note

export const onPage = (annotations: readonly Annotation[], page: number) =>
  annotations.filter((annotation) => annotation.page === page)

export const without = (annotations: readonly Annotation[], id: string) =>
  annotations.filter((annotation) => annotation.id !== id)

/**
 * 'two highlights and a comment' — for the button that writes them.
 *
 * Counted by kind rather than totalled, because they are not interchangeable:
 * "3 annotations" leaves a person wondering whether the comment they typed
 * actually took.
 */
export function summarise(annotations: readonly Annotation[]): string {
  const highlights = annotations.filter((a) => a.kind === 'highlight').length
  const notes = annotations.filter((a) => a.kind === 'note').length
  const parts: string[] = []
  if (highlights > 0) parts.push(`${highlights} highlight${highlights === 1 ? '' : 's'}`)
  if (notes > 0) parts.push(`${notes} comment${notes === 1 ? '' : 's'}`)
  if (parts.length === 0) return 'nothing yet'
  return parts.join(' and ')
}

/** The text a highlight covers, tidied for a one-line list row. */
export function excerpt(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  // Cut at a word boundary when there is one near the end, so the ellipsis does
  // not land mid-word on every row.
  const cut = flat.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max - 12 ? cut.slice(0, space) : cut).trimEnd()}…`
}
