/**
 * Types for `precache-guard.mjs`, which is JavaScript because the build runs it
 * with bare `node` and the test imports the same file the build does.
 *
 * Without this sidecar the import fails `tsc -b` under `noImplicitAny` — so the
 * guard would be untestable in the only place the web workspace runs tests.
 */
export declare const localPath: (raw: string, base: string) => string | null

export declare function entryAssets(
  html: string,
  base: string,
): { script: string[]; stylesheet: string[] }

export declare function auditPrecache(input: {
  html: string
  base: string
  boot: ReadonlySet<string>
  emittedCss: boolean
}): string[]
