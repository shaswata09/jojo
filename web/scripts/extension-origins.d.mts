/** Types for `extension-origins.mjs`, which `pack-extension.mjs` runs and the manifest test imports. */
export declare const isDevMatch: (pattern: string) => boolean
export declare function shippedMatches(
  matches: readonly string[],
  options?: { dev?: boolean; origin?: string },
): string[]
export declare const isDevPack: (
  argv: readonly string[],
  env: Record<string, string | undefined>,
) => boolean
