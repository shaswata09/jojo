import type { Announcements, ScreenReaderInstructions, UniqueIdentifier } from '@dnd-kit/core'
import { i18next } from '@/i18n/i18n'

const t = (key: string, options?: Record<string, string>) =>
  i18next.t(`common:drag.${key}`, options)

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
  const nameOf = (id: UniqueIdentifier) => item(String(id)) ?? t('theItem')
  // Sentence case for the lines that open on the name, which may be the fallback.
  const Name = (id: UniqueIdentifier) => {
    const name = nameOf(id)
    return name.charAt(0).toUpperCase() + name.slice(1)
  }
  const placeOf = (id: UniqueIdentifier) => target(String(id)) ?? t('aTarget')

  return {
    onDragStart: ({ active }) => t('start', { name: nameOf(active.id) }),
    onDragOver: ({ active, over }) =>
      over
        ? t('over', { name: Name(active.id), place: placeOf(over.id) })
        : t('notOver', { name: Name(active.id) }),
    onDragEnd: ({ active, over }) =>
      over
        ? t('dropped', { name: Name(active.id), place: placeOf(over.id) })
        : t('droppedHome', { name: Name(active.id) }),
    onDragCancel: ({ active }) => t('cancelled', { name: nameOf(active.id) }),
  }
}

/**
 * What a screen reader is told about HOW to drag, read when a draggable takes
 * focus. dnd-kit's default is English ("To pick up a draggable item, press the
 * space bar…") whatever the language on screen. Call it while rendering, so it
 * follows a language change.
 */
export function dragInstructions(): ScreenReaderInstructions {
  return { draggable: t('instructions') }
}
