import { useCallback } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { STAGES, type Stage } from '@/data/seed'
import {
  APPLICATIONS_DEFAULTS,
  GUIDE_DEFAULTS,
  GUIDE_PAGES,
  SCOUT_DEFAULTS,
  VAULT_DEFAULTS,
  VAULT_TOOLS,
  calendarDate,
  calendarDefaults,
  patched,
  type ApplicationsView,
  type GuidePage,
  type ParamValue,
  type ScoutFocus,
  type SetOptions,
  type VaultTool,
} from '@/lib/links'

/**
 * The query-string and path readers — the half of `links.ts` that needs the
 * router.
 *
 * They lived in `links.ts` until 2026-09-11, and that made the whole module
 * router-bound: `ApplicationDialog` imports `appPath` and `hrefOutsideRouter`
 * from it, and a dialog is drawn OUTSIDE the router (see `lib/dialogs.tsx`),
 * so the file every dialog reaches for a path was also the file that imported
 * `useSearchParams`. Importing is not calling, so nothing crashed — but it put
 * the router one careless call away from every dialog, and it meant
 * `scripts/check-outside-router.mjs` could not tell a module that builds a path
 * from one that reads the URL. Split, the rule is exact: `links.ts` builds
 * paths anywhere, and this file only works inside the router, where every
 * caller of it is.
 */

/** The row a link is pointing at, if any. Cleared once the highlight fades. */
export function useSettingsParams() {
  const [params, setParams] = useSearchParams()
  const focus = params.get('focus') ?? undefined

  const clearFocus = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('focus')
        return next
      },
      // Replace, so an expired highlight does not become a Back entry — the
      // same reason `useVaultParams` replaces.
      { replace: true },
    )
  }, [setParams])

  return { focus, clearFocus }
}

/**
 * Which of the six is open.
 *
 * A path reader rather than a param one, because the guide's pages are routes:
 * they each want their own title, their own h1 and their own history entry, and
 * a query string gives none of those. Anything unrecognised reads as the
 * landing page rather than throwing — the router has already decided this URL
 * matches the section, so the only question left is which pill to light.
 */
export function useGuidePage(): GuidePage {
  const { pathname } = useLocation()
  const segment = pathname.replace(/^\/guide\/?/, '').replace(/\/+$/, '')
  return GUIDE_PAGES.includes(segment as GuidePage) ? (segment as GuidePage) : GUIDE_DEFAULTS.page
}

export function useApplicationsParams() {
  const [params, setParams] = useSearchParams()

  const rawView = params.get('view')
  const view: ApplicationsView =
    rawView === 'board' || rawView === 'table' ? rawView : APPLICATIONS_DEFAULTS.view

  // Validated against the stage list itself, so a stage added to the data is
  // linkable without touching this file, and a hand-typed '?stage=hired' shows
  // everything rather than an empty table.
  const rawStage = params.get('stage')
  const stage: Stage | 'all' =
    rawStage !== null && STAGES.some((s) => s.id === rawStage)
      ? (rawStage as Stage)
      : APPLICATIONS_DEFAULTS.stage

  const set = useCallback(
    (
      patch: {
        view?: ApplicationsView
        stage?: Stage | 'all'
        q?: string
        sort?: string
      },
      opts?: SetOptions,
    ) => {
      const wire: Record<string, ParamValue> = {}
      if ('view' in patch) wire.view = patch.view
      if ('stage' in patch) wire.stage = patch.stage
      if ('q' in patch) wire.q = patch.q
      if ('sort' in patch) wire.sort = patch.sort

      setParams((prev) => patched(prev, wire, APPLICATIONS_DEFAULTS), {
        replace: opts?.replace ?? true,
      })
    },
    [setParams],
  )

  return {
    view,
    stage,
    q: params.get('q') ?? APPLICATIONS_DEFAULTS.q,
    /** Wire form; run it through `parseSort` for the key and direction. */
    sort: params.get('sort') ?? APPLICATIONS_DEFAULTS.sort,
    set,
  }
}

export function useVaultParams() {
  const [params, setParams] = useSearchParams()

  const rawTool = params.get('tool')
  const tool: VaultTool = VAULT_TOOLS.includes(rawTool as VaultTool)
    ? (rawTool as VaultTool)
    : VAULT_DEFAULTS.tool

  const set = useCallback(
    (patch: { tool?: VaultTool; focus?: string }, opts?: SetOptions) => {
      const wire: Record<string, ParamValue> = {}
      if ('tool' in patch) wire.tool = patch.tool
      if ('focus' in patch) wire.focus = patch.focus

      setParams((prev) => patched(prev, wire, VAULT_DEFAULTS), { replace: opts?.replace ?? true })
    },
    [setParams],
  )

  return { tool, focus: params.get('focus') ?? undefined, set }
}

export function useScoutParams() {
  const [params, setParams] = useSearchParams()

  const raw = params.get('focus') ?? ''
  const cut = raw.indexOf(':')
  const kind = cut > 0 ? raw.slice(0, cut) : null
  // A hand-typed or stale '?focus=' naming no list is dropped whole rather than
  // half-read: lighting up the wrong list is worse than lighting up nothing.
  const focus: ScoutFocus | undefined =
    kind === 'match' || kind === 'posting' ? { kind, id: raw.slice(cut + 1) } : undefined

  const set = useCallback(
    (patch: { focus?: ScoutFocus }, opts?: SetOptions) => {
      const wire: Record<string, ParamValue> = {}
      if ('focus' in patch) wire.focus = patch.focus ? `${patch.focus.kind}:${patch.focus.id}` : ''

      setParams((prev) => patched(prev, wire, SCOUT_DEFAULTS), { replace: opts?.replace ?? true })
    },
    [setParams],
  )

  /** The validated parameter as it stands in the URL — what drives the fade timer. */
  const token = focus ? raw : undefined

  return { focus, token, set }
}

export function useCalendarParams() {
  const [params, setParams] = useSearchParams()

  const { y, m, d } = calendarDate(params)

  const set = useCallback(
    (patch: { y?: number; m?: number; d?: number; focus?: string }, opts?: SetOptions) => {
      const wire: Record<string, ParamValue> = {}
      if ('y' in patch) wire.y = patch.y
      if ('m' in patch) wire.m = patch.m
      if ('d' in patch) wire.d = patch.d
      if ('focus' in patch) wire.focus = patch.focus

      // Sampled inside the callback rather than closed over, so a tab left open
      // across midnight writes the URL against today and not against the day it
      // was opened on.
      setParams((prev) => patched(prev, wire, calendarDefaults()), {
        replace: opts?.replace ?? true,
      })
    },
    [setParams],
  )

  return { y, m, d, focus: params.get('focus') ?? undefined, set }
}
