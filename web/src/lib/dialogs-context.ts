import { createContext, useContext, useEffect } from 'react'

/**
 * Every dialog any surface can ask for by name.
 *
 * Only names the host actually mounts. It used to carry 'link', 'file',
 * 'snippet' and 'posting' as well, for dialogs nobody was building — so
 * `open('link')` type-checked and did nothing, which is the same defect as a
 * button that looks live and swallows the click. Those records are created in
 * place now (the Vault's tools, the scout's capture panel), and the create menu
 * navigates there rather than naming a dialog that does not exist. Add a name
 * back here in the same change that adds its branch to `DialogHost`.
 */
export type DialogName = 'application' | 'timelineItem' | 'draft'

export type OpenDialog = {
  name: DialogName
  /**
   * Whatever the caller wants the dialog to open with — a prefilled stage, the
   * application a timeline item belongs to. Left untyped on purpose: the moment
   * this knew each dialog's props it would have to import all of them, and the
   * registry would depend on the components that depend on it. The host casts
   * at the one place it renders each dialog.
   */
  props: Record<string, unknown>
}

export type DialogsContextValue = {
  /** Opens a dialog, replacing whatever was open. */
  open: (name: DialogName, props?: Record<string, unknown>) => void
  close: () => void
  /** The one dialog currently open, or null. */
  current: OpenDialog | null
}

export const DialogsContext = createContext<DialogsContextValue | null>(null)

export function useDialogs() {
  const ctx = useContext(DialogsContext)
  if (!ctx) throw new Error('useDialogs must be used inside <DialogsProvider>')
  return ctx
}

/** A point in viewport coordinates — where a dialog was summoned from. */
export type TriggerOrigin = { x: number; y: number }

/**
 * The place the next dialog should appear to come from.
 *
 * Module state rather than a field on the context value, deliberately. The
 * three dialogs this registry mounts are not the only ones on screen:
 * ConfirmDialog, the stage transition and the command palette own their own
 * `open` flag and never call `open()`. Threading the origin through the context
 * alone would give it to a third of the app's dialogs and leave the rest
 * growing out of the middle of the screen — which is the inconsistency the
 * origin exists to remove. `DialogsProvider` owns the listeners so there is no
 * import-time side effect; `DialogContent` reads the point at mount.
 */
let pointerOrigin: TriggerOrigin | null = null
let pointerAt = 0
/** The control that pointer landed on, if it was one — see `triggerElement`. */
let pointerTarget: HTMLElement | null = null

/**
 * Long enough to cover pointerdown → click → setState → mount, short enough
 * that a dialog opened much later by a shortcut does not inherit the last
 * place the pointer happened to land.
 */
const POINTER_TTL_MS = 1000

/** Call once, from the provider. Capture phase, so a `stopPropagation` on the
 *  way up cannot cost a dialog its origin. */
export function useTriggerOriginTracking() {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      pointerOrigin = { x: event.clientX, y: event.clientY }
      pointerAt = Date.now()
      // Read here rather than from `activeElement` later: on a mouse press the
      // focus has not moved yet, and Safari never moves it to a button at all.
      const target = event.target
      pointerTarget =
        target instanceof Element ? target.closest<HTMLElement>(RETURNABLE_TRIGGER) : null
    }
    // A key press means the pointer summoned nothing: fall through to whatever
    // holds focus, which is the control the keyboard user is actually on.
    const onKeyDown = () => {
      pointerOrigin = null
      pointerTarget = null
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])
}

/** The point the dialog now opening was summoned from, or null for the centre. */
export function triggerOrigin(): TriggerOrigin | null {
  if (pointerOrigin && Date.now() - pointerAt < POINTER_TTL_MS) return pointerOrigin

  const active = document.activeElement
  if (!(active instanceof HTMLElement) || active === document.body) return null
  const rect = active.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

/**
 * Things focus can be handed back to.
 *
 * Deliberately narrow. Focus has to land somewhere that can hold it and that
 * the user recognises as the thing they pressed, so a press on a card, a table
 * row or a menu item — `tabindex="-1"`, all of them — falls through to whatever
 * actually had focus instead of parking focus on a container.
 */
const RETURNABLE_TRIGGER =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * The control the dialog now opening should hand focus back to when it closes.
 *
 * Same record as `triggerOrigin`, read as an element rather than a point. The
 * pointer target is preferred over `activeElement` because by the time a dialog
 * mounts, the surface it replaced may already be gone: opening a create dialog
 * from the "+ New" menu tears the menu — and the row that had focus — out of
 * the document in the same commit, so `activeElement` is `<body>` by then.
 * `isConnected` is the tiebreak: a target that did not survive is no target.
 */
export function triggerElement(): HTMLElement | null {
  if (pointerTarget?.isConnected && Date.now() - pointerAt < POINTER_TTL_MS) return pointerTarget

  const active = document.activeElement
  return active instanceof HTMLElement && active !== document.body ? active : null
}
