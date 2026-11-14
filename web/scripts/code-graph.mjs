/**
 * The code flow graph the Guide's Control flow graph page draws: every source
 * file in the three apps and the shared service, grouped by module, with the
 * imports between them.
 *
 * Computed from the code at build time (the `jojo:code-graph` plugin in
 * `vite.config.ts` serves it as a virtual module), never written down by hand
 * and never committed — a graph somebody has to remember to regenerate is a
 * graph that is wrong by the next commit, and this one is read by whoever is
 * about to decide where code goes.
 *
 * Everything except `collectSources` is pure, so `code-graph.test.ts` can hold
 * the rules on small fixtures and then check the real graph's invariants.
 */

import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

/**
 * The service layers in order, top to bottom. An import may only point at a
 * layer at the same depth or below it — `check-layers.mjs` enforces that; the
 * test re-reads it off this graph as a second witness.
 */
export const TIERS = [
  'entry',
  'screens',
  'components',
  'app-lib',
  'react',
  'agent',
  'tools',
  'repo',
  'core',
  'storage',
]

/** Which column of the drawing a group sits in. */
export const BANDS = ['web', 'service', 'mobile']

const SOURCE = /\.(ts|tsx|js|mjs)$/
const SKIP = /(\.test\.|\.d\.ts$|\.d\.mts$)/

/** Whether a repo-relative path is a source file the graph counts. */
export function includePath(file) {
  if (!SOURCE.test(file) || SKIP.test(file)) return false
  return (
    file === 'jojo-bridge.mjs' ||
    file === 'mobile/App.tsx' ||
    file === 'mobile/index.ts' ||
    /^service\/(kg|data)\//.test(file) ||
    /^web\/src\//.test(file) ||
    /^web\/extension\/(?:worker\/)?[^/]+\.js$/.test(file) ||
    /^mobile\/src\//.test(file)
  )
}

/**
 * The module a file belongs to: a service layer, an app's feature folder, an
 * app's lib or entry. Fine enough that a feature reads as a place, coarse
 * enough that the drawing has tens of nodes rather than eight hundred.
 */
export function groupOf(file) {
  if (file === 'jojo-bridge.mjs') return { id: 'jojo-bridge', band: 'web', tier: 'entry' }
  if (file.startsWith('web/extension/')) return { id: 'web/extension', band: 'web', tier: 'entry' }
  if (file === 'service/kg/log.ts') return { id: 'service/kg/log', band: 'service', tier: 'core' }
  if (file.startsWith('service/data/')) return { id: 'service/data', band: 'service', tier: 'core' }

  const kg = /^service\/kg\/([^/]+)\//.exec(file)
  if (kg) {
    const layer = kg[1]
    const tier = layer === 'crypto' ? 'core' : TIERS.includes(layer) ? layer : 'core'
    return { id: `service/kg/${layer}`, band: 'service', tier }
  }

  const app = /^(web|mobile)\/(?:src\/)?(.*)$/.exec(file)
  if (!app) return { id: file, band: 'service', tier: 'core' }
  const band = app[1]
  const rest = app[2]
  const parts = rest.split('/')

  if (band === 'mobile' && !file.startsWith('mobile/src/')) {
    return { id: 'mobile/entry', band, tier: 'entry' }
  }
  if (parts.length === 1) return { id: `${band}/entry`, band, tier: 'entry' }

  const [top, sub] = parts
  if (top === 'navigation') return { id: `${band}/navigation`, band, tier: 'entry' }
  if (top === 'routes' || top === 'screens' || top === 'sheets') {
    return { id: `${band}/${top}`, band, tier: 'screens' }
  }
  if (top === 'components' && parts.length > 2) {
    return { id: `${band}/components/${sub}`, band, tier: 'components' }
  }
  if (top === 'kg') return { id: `${band}/kg/storage`, band, tier: 'storage' }
  if (top === 'lib' && parts.length > 2) return { id: `${band}/lib/${sub}`, band, tier: 'app-lib' }
  return { id: `${band}/${top}`, band, tier: top === 'components' ? 'components' : 'app-lib' }
}

/** Short label for a group, as the drawing shows it. */
export function labelOf(id) {
  return id
    .replace(/^service\/kg\//, '')
    .replace(/^service\/data$/, 'data')
    .replace(/^(web|mobile)\/components\//, '$1 · ')
    .replace(/^(web|mobile)\//, '$1 · ')
}

/** How TypeScript should read a file, from its extension. */
function scriptKindOf(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (file.endsWith('.ts')) return ts.ScriptKind.TS
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX
  return ts.ScriptKind.JS
}

/** True for `import { type A, type B } from …` and `export { type C } from …`: names, all of them types. */
const allTypes = (elements) => elements.length > 0 && elements.every((e) => e.isTypeOnly)

/**
 * The runtime imports in a source file: static `import … from`, `export … from`,
 * side-effect imports and dynamic `import()`. Type-only imports are left out —
 * this is a graph of what runs — and so is anything carrying a query
 * (`?raw`, `?url`), which loads a file's text or address, not its code.
 *
 * Read off TypeScript's syntax tree, not with a regular expression. The regex
 * this replaced could not tell code from text: in a file without semicolons,
 * `export type A = B` ran on to the next `export … from` and swallowed it (one
 * real edge was missing that way), and the words `import x from './y'` inside a
 * template literal or JSX text drew an arrow to a file nobody imports. The
 * parser knows where a string or a type alias ends, so neither can happen.
 *
 * `file` picks the dialect — JSX only parses as TSX — and defaults to TSX,
 * which also reads plain TypeScript.
 */
export function importsOf(source, file = 'source.tsx') {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, scriptKindOf(file))
  const found = new Set()
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const typeOnly =
        clause !== undefined &&
        (clause.isTypeOnly ||
          (clause.name === undefined &&
            clause.namedBindings !== undefined &&
            ts.isNamedImports(clause.namedBindings) &&
            allTypes(clause.namedBindings.elements)))
      if (!typeOnly) found.add(node.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.exportClause
      const typeOnly = node.isTypeOnly || (clause !== undefined && ts.isNamedExports(clause) && allTypes(clause.elements))
      if (!typeOnly) found.add(node.moduleSpecifier.text)
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      found.add(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return [...found].filter((spec) => !spec.includes('?'))
}

const SERVICE_EXPORTS = {
  core: 'service/kg/core',
  storage: 'service/kg/storage',
  repo: 'service/kg/repo',
  tools: 'service/kg/tools',
  agent: 'service/kg/agent',
  react: 'service/kg/react',
  crypto: 'service/kg/crypto',
  data: 'service/data',
}

const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx']

/**
 * The repo-relative file an import specifier names, or null for a package (or a
 * path that names nothing the graph knows). Resolves relative paths, each app's
 * `@/` alias and the service's exports map.
 */
export function resolveImport(spec, from, known) {
  let base = null
  if (spec.startsWith('.')) base = path.posix.join(path.posix.dirname(from), spec)
  else if (spec.startsWith('@/')) {
    const app = from.startsWith('mobile/') ? 'mobile/src' : 'web/src'
    base = `${app}/${spec.slice(2)}`
  } else if (spec === '@jojo/service/log') base = 'service/kg/log'
  else if (spec.startsWith('@jojo/service/')) {
    const [layer, ...rest] = spec.slice('@jojo/service/'.length).split('/')
    const dir = SERVICE_EXPORTS[layer]
    if (dir) base = `${dir}/${rest.join('/')}`
  }
  if (base === null) return null
  const bare = base.replace(/\.(js|mjs|ts|tsx)$/, '')
  for (const ext of EXTENSIONS) {
    if (known.has(base + ext)) return base + ext
    if (known.has(bare + ext)) return bare + ext
  }
  return null
}

/**
 * The whole graph from a map of repo-relative path → source text.
 *
 * Deterministic: groups, files and edges come out sorted, so two builds of the
 * same tree serve the same module.
 */
export function buildCodeGraph(sources) {
  const paths = Object.keys(sources).filter(includePath).sort()
  const known = new Set(paths)
  const index = new Map(paths.map((p, i) => [p, i]))

  const files = paths.map((p) => {
    const targets = new Set()
    for (const spec of importsOf(sources[p], p)) {
      const hit = resolveImport(spec, p, known)
      if (hit !== null && hit !== p) targets.add(index.get(hit))
    }
    const lines = (sources[p].match(/\n/g) ?? []).length
    return { path: p, group: groupOf(p).id, lines, imports: [...targets].sort((a, b) => a - b) }
  })

  const groups = new Map()
  for (const f of files) {
    const g = groupOf(f.path)
    const held = groups.get(g.id) ?? { id: g.id, label: labelOf(g.id), band: g.band, tier: g.tier, files: 0, lines: 0 }
    held.files += 1
    held.lines += f.lines
    groups.set(g.id, held)
  }

  const counts = new Map()
  for (const f of files) {
    for (const i of f.imports) {
      const to = files[i].group
      if (to === f.group) continue
      const key = `${f.group}\u0000${to}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  const edges = [...counts]
    .map(([key, count]) => {
      const [from, to] = key.split('\u0000')
      return { from, to, count }
    })
    .sort((a, b) => (a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from)))

  return {
    groups: [...groups.values()].sort((a, b) => a.id.localeCompare(b.id)),
    files,
    edges,
  }
}

/**
 * Reads every file the graph counts, from the repository root on disk.
 *
 * Symbolic links are skipped, not followed. The graph names files by their
 * place in this repository and ships those names in the bundle, so a link to a
 * folder elsewhere (`web/src/notes -> ~/notes`) would publish the names of
 * files that are not part of jojo, and a link back up the tree
 * (`web/src/loop -> ..`) made the walk recurse until it threw ELOOP and took
 * the build down with it. Nothing jojo builds lives behind a link.
 */
export function collectSources(root) {
  const sources = {}
  const walk = (rel) => {
    for (const name of readdirSync(path.join(root, rel))) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const child = rel ? `${rel}/${name}` : name
      const stat = lstatSync(path.join(root, child))
      if (stat.isSymbolicLink()) continue
      if (stat.isDirectory()) walk(child)
      else if (stat.isFile() && includePath(child)) sources[child] = readFileSync(path.join(root, child), 'utf8')
    }
  }
  for (const dir of ['service/kg', 'service/data', 'web/src', 'web/extension', 'mobile/src']) walk(dir)
  for (const file of ['jojo-bridge.mjs', 'mobile/App.tsx', 'mobile/index.ts']) {
    sources[file] = readFileSync(path.join(root, file), 'utf8')
  }
  return sources
}
