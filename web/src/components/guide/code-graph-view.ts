import type { CodeFile, CodeGraph } from '../../../scripts/code-graph.mjs'

/**
 * What the panel under the code flow graph says about one module and one file:
 * what it uses, and what uses it. Pure, so the drawing component only draws.
 */

export type Link = { readonly id: string; readonly count: number }

/** Modules this one imports from, and modules that import from it — busiest first. */
export function neighboursOf(graph: Pick<CodeGraph, 'edges'>, id: string): { uses: Link[]; usedBy: Link[] } {
  const byCount = (a: Link, b: Link) => b.count - a.count || a.id.localeCompare(b.id)
  return {
    uses: graph.edges.filter((e) => e.from === id).map((e) => ({ id: e.to, count: e.count })).sort(byCount),
    usedBy: graph.edges.filter((e) => e.to === id).map((e) => ({ id: e.from, count: e.count })).sort(byCount),
  }
}

/** The files in one module, largest first. */
export function filesOf(graph: Pick<CodeGraph, 'files'>, id: string): CodeFile[] {
  return graph.files.filter((f) => f.group === id).sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path))
}

/** One file's imports and importers, as paths. */
export function fileLinks(graph: Pick<CodeGraph, 'files'>, path: string): { imports: string[]; importedBy: string[] } {
  const index = graph.files.findIndex((f) => f.path === path)
  if (index === -1) return { imports: [], importedBy: [] }
  const file = graph.files[index]
  return {
    imports: (file?.imports ?? []).map((i) => graph.files[i]?.path ?? '').filter(Boolean).sort(),
    importedBy: graph.files.filter((f) => f.imports.includes(index)).map((f) => f.path).sort(),
  }
}

/** Stroke width for an edge carrying `count` imports: thicker for busier paths, but bounded. */
export const strokeFor = (count: number) => Math.min(4, 1 + Math.log2(count))

/** The module picked after choosing `id`: a second choice of the same one clears it. */
export const nextPick = (selected: string | null, id: string): string | null => (id === selected ? null : id)

/** Whether a key on a focused module picks it — the keys a button answers to. */
export const picksOnKey = (key: string): boolean => key === 'Enter' || key === ' '

/** What a module box says to a screen reader: its name, its size, and whether it is the one picked. */
export function moduleLabel(group: { readonly label: string; readonly files: number; readonly lines: number }, picked: boolean): string {
  const size = `${String(group.files)} ${group.files === 1 ? 'file' : 'files'}, ${group.lines.toLocaleString('en')} lines`
  return `${group.label}: ${size}${picked ? ', picked' : ''}`
}
