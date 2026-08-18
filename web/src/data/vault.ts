/**
 * Façade. This module has no content of its own — it forwards the demo vault records and their value unions to
 * `@jojo/service/data/vault`.
 *
 * It exists so the fixtures could move into the shared package without touching
 * 168 import lines across 102 files in this app, which would have buried the one
 * change worth reviewing (the fixtures leaving) under a mechanical diff. Every
 * name below is re-exported unchanged; there is no adaptation happening here and
 * none may be added — a shim that starts renaming things is a second copy of the
 * model wearing a different hat, which is exactly what this migration deleted.
 *
 * Marked for deletion. The successor spelling is `@jojo/service/data/vault`,
 * and this file goes the day the last `@/data/vault` import does.
 */
export * from '@jojo/service/data/vault'
