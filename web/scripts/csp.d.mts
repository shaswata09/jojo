/** Types for `csp.mjs`, which the build runs from `vite.config.ts` and the test imports. */
export declare const GTM: string
export declare function inlineScriptHashes(html: string): string[]
export declare function withScriptPolicy(html: string, options?: { analytics?: boolean }): string
export declare const EVAL_PROBE: RegExp
export declare function withoutEvalProbe(code: string): string | null
