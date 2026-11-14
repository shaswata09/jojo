/** Types for `code-graph.mjs`, which the build runs from `vite.config.ts` and the test imports. */

export type CodeTier =
  | 'entry'
  | 'screens'
  | 'components'
  | 'app-lib'
  | 'react'
  | 'agent'
  | 'tools'
  | 'repo'
  | 'core'
  | 'storage'

export type CodeBand = 'web' | 'service' | 'mobile'

export type CodeGroup = {
  readonly id: string
  readonly label: string
  readonly band: CodeBand
  readonly tier: CodeTier
  readonly files: number
  readonly lines: number
}

export type CodeFile = {
  readonly path: string
  readonly group: string
  readonly lines: number
  /** Indexes into `CodeGraph.files`. */
  readonly imports: readonly number[]
}

export type CodeEdge = { readonly from: string; readonly to: string; readonly count: number }

export type CodeGraph = {
  readonly groups: readonly CodeGroup[]
  readonly files: readonly CodeFile[]
  readonly edges: readonly CodeEdge[]
}

export declare const TIERS: readonly CodeTier[]
export declare const BANDS: readonly CodeBand[]
export declare function includePath(file: string): boolean
export declare function groupOf(file: string): { id: string; band: CodeBand; tier: CodeTier }
export declare function labelOf(id: string): string
export declare function importsOf(source: string): string[]
export declare function resolveImport(spec: string, from: string, known: ReadonlySet<string>): string | null
export declare function buildCodeGraph(sources: Readonly<Record<string, string>>): CodeGraph
export declare function collectSources(root: string): Record<string, string>
