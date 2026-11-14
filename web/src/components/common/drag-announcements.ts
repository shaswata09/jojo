import type { Announcements, UniqueIdentifier } from '@dnd-kit/core'

/**
 * What a screen reader hears while something is dragged, in names not ids.
 *
 * dnd-kit's defaults read the raw ids — "Picked up draggable item 3f9c…" — and
 * every draggable in jojo is keyed by a UUID or a minted key, so a keyboard drag
 * on the board, the calendar or the PDF merge list announced strings nobody can
 * act on. Each page hands over the two lookups it already has; this owns the
 * sentences, so the three surfaces say the same thing the same way.
 *
 * A lookup that misses (a record deleted mid-drag) reads as "the item" or "a
 * drop target" rather than falling back to the id it was meant to hide.
 */
export type DragNames = {
  /** The dragged thing's name: an application, an event title, a file name. */
  item: (id: string) => string | undefined
  /** The place it is over: a stage column, a day, a position in a list. */
  target: (id: string) => string | undefined
}

export function dragAnnouncements({ item, target }: DragNames): Announcements {
  const nameOf = (id: UniqueIdentifier) => item(String(id)) ?? 'the item'
  // Sentence case for the lines that open on the name, which may be the fallback.
  const Name = (id: UniqueIdentifier) => {
    const name = nameOf(id)
    return name.charAt(0).toUpperCase() + name.slice(1)
  }
  const placeOf = (id: UniqueIdentifier) => target(String(id)) ?? 'a drop target'

  return {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${Name(active.id)} is over ${placeOf(over.id)}.`
        : `${Name(active.id)} is no longer over a drop target.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `${Name(active.id)} was dropped on ${placeOf(over.id)}.`
        : `${Name(active.id)} was dropped where it started.`,
    onDragCancel: ({ active }) =>
      `Dragging was cancelled. ${nameOf(active.id)} was put back where it started.`,
  }
}
