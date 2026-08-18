/**
 * The store's public surface, re-exported from the graph layer.
 *
 * Until this wave the file underneath was a 960-line reducer written against
 * the same seven collections — its own copy of the write rules, its own undo,
 * its own derived lists. It has been replaced by `@jojo/service`, the one copy
 * of the graph layer both apps import, and this file is what made that a
 * provider swap rather than a rewrite of thirty screens. (It went through an
 * intermediate step this comment used to describe as its end state: `src/kg`,
 * the web app's layer copied across. That copy had drifted by 813 lines when it
 * was deleted, which is the argument the package exists on.)
 *
 * It could be: the hook surface here and the hook surface there were already the
 * same, name for name and field for field, because the reducer was written
 * against the façade the web app had before its own migration. So every screen
 * kept its imports, and the diff for the swap is this file plus the composition
 * root in `store.tsx`.
 *
 * It is a shim and should not grow. The web app deleted its equivalent once the
 * migration settled and its screens moved to importing the hooks directly; this
 * should follow, once there has been a release to be sure of. Anything that
 * wants a capability the graph has and the old reducer did not — the tool
 * runtime, the journal, `useRun` — must import it from `@jojo/service/react/*`
 * rather than be added here, or the shim becomes the API and the layer below it
 * stops being replaceable.
 */

export { useApplications } from '@jojo/service/react/use-applications'
export type { ApplicationDraft } from '@jojo/service/react/use-applications'
export { useTimeline } from '@jojo/service/react/use-timeline'
export type { TimelineDraft } from '@jojo/service/react/use-timeline'
export { useVault } from '@jojo/service/react/use-vault'
export { useScout } from '@jojo/service/react/use-scout'
export { useProfile } from '@jojo/service/react/use-profile'
export { useStoreAdmin } from '@jojo/service/react/use-admin'
