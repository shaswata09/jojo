/**
 * Façade. This module has no content of its own — it forwards the demo scout pipelines, matches and saved postings to
 * `@jojo/service/data/scout`.
 *
 * It exists so the fixtures could move into the shared package without touching
 * 168 import lines across 102 files in this app, which would have buried the one
 * change worth reviewing (the fixtures leaving) under a mechanical diff. Every
 * name below is re-exported unchanged; there is no adaptation happening here and
 * none may be added — a shim that starts renaming things is a second copy of the
 * model wearing a different hat, which is exactly what this migration deleted.
 *
 * Marked for deletion. The successor spelling is `@jojo/service/data/scout`,
 * and this file goes the day the last `@/data/scout` import does.
 */
export * from '@jojo/service/data/scout'
