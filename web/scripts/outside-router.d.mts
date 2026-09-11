/**
 * Types for `outside-router.mjs`, which is JavaScript because the lint runs it
 * with bare `node` and the test imports the same file the lint does — the
 * arrangement `precache-guard.d.mts` explains.
 */
export type OutsideRouterUse = {
  /** The module that imports from the router, relative to `src`. */
  file: string
  /** The `main.tsx` import it was first reached from. */
  root: string
  /** What it imports as values. */
  names: string[]
}

/** What one module reaches, and what it takes from the router as a value. */
export declare function scan(text: string, path?: string): { edges: string[]; router: string[] }

export declare function routerValues(text: string, path?: string): string[]

export declare function findOutsideRouterUse(input: {
  /** A module's text by its path relative to `src`, or null when there is none. */
  read: (path: string) => string | null
  isFile: (path: string) => boolean
  entry?: string
}): { roots: string[]; modules: number; offenders: OutsideRouterUse[] }
