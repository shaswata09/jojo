import { createContext, useContext } from 'react'

/**
 * Every sheet any surface can ask for by name.
 *
 * Only names the host actually mounts. The web registry used to carry 'link',
 * 'file', 'snippet' and 'posting' as well, for dialogs nobody was building — so
 * `open('link')` type-checked and did nothing, which is the same defect as a
 * button that looks live and swallows the tap. Those records are created in
 * place here too (the Vault's tools, the scout's capture panel), and the create
 * menu navigates there rather than naming a sheet that does not exist.
 *
 * Add a name back here in the same change that adds its branch to `SheetHost`.
 */
export type SheetName = 'application' | 'applicationFromLink' | 'timelineItem' | 'draft'

export type OpenSheet = {
  name: SheetName
  /**
   * Whatever the caller wants the sheet to open with. Left untyped on purpose:
   * the moment this knew each sheet's props it would have to import all of
   * them, and the registry would depend on the components that depend on it.
   */
  props: Record<string, unknown>
}

export type SheetsContextValue = {
  /** Opens a sheet, replacing whatever was open. */
  open: (name: SheetName, props?: Record<string, unknown>) => void
  close: () => void
  current: OpenSheet | null
}

export const SheetsContext = createContext<SheetsContextValue | null>(null)

export function useSheets() {
  const ctx = useContext(SheetsContext)
  if (!ctx) throw new Error('useSheets must be used inside <SheetsProvider>')
  return ctx
}
