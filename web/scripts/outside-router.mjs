/**
 * Whether anything drawn outside the router reaches for it — the pure half of
 * `check-outside-router.mjs`.
 *
 * No file system and no process, so the web workspace's own tests run the same
 * code the lint does, against planted trees and against this app's real
 * sources, without Node's types in an app tsconfig. `precache-guard.mjs` set
 * the precedent. The CLI's header carries the bug and the rule.
 *
 * PARSED, NOT PATTERN-MATCHED. The first version read imports with regular
 * expressions, and an adversarial review on 2026-09-11 walked four cases past
 * it: a barrel `export { useNavigate } from 'react-router'`, `export *` from it,
 * a dynamic `import('react-router')`, and an apostrophe in a comment inside an
 * import clause, which silently dropped that edge and everything behind it.
 * Worse, it failed CORRECT code: any import above a type-only router import
 * made the lazy clause span two statements and report a garbage name — the kind
 * of false alarm that gets a check switched off. TypeScript's own parser is
 * already a dependency of this workspace and has none of those failure modes.
 *
 * Paths here are relative to `src` and always '/'-separated. The CLI reads the
 * disk and translates, so nothing in this file knows what an OS path is.
 */
import ts from 'typescript'

/** The router's own packages. `react-router/dom` only provides context. */
const ROUTER = new Set(['react-router', 'react-router-dom'])

/** Joins '/'-separated parts and resolves `.` and `..`. */
function normalise(path) {
  const out = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

const dirOf = (path) => path.split('/').slice(0, -1).join('/')

const kindOf = (path) =>
  path.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : path.endsWith('.ts')
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JS

/** A specifier's name as written: `useNavigate` for `useNavigate as go`. */
const imported = (element) => (element.propertyName ?? element.name).text

/**
 * What one module reaches, and what it takes from the router as a VALUE.
 *
 * Edges are every static import, every `export … from`, and every `import()`
 * whose specifier is a literal — a lazy component renders where its importer
 * renders, a chunk later. A TYPE import is erased at build and needs no router,
 * so it is not a use; a bare `import 'react-router'` runs module code and no
 * hook, so it is not one either.
 */
export function scan(text, path = 'module.tsx') {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, kindOf(path))
  const edges = []
  const router = []
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text
      edges.push(spec)
      const clause = node.importClause
      if (ROUTER.has(spec) && clause !== undefined && !clause.isTypeOnly) {
        if (clause.name !== undefined) router.push(clause.name.text)
        const bound = clause.namedBindings
        if (bound !== undefined && ts.isNamespaceImport(bound))
          router.push(`* as ${bound.name.text}`)
        if (bound !== undefined && ts.isNamedImports(bound)) {
          for (const element of bound.elements)
            if (!element.isTypeOnly) router.push(imported(element))
        }
      }
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const spec = node.moduleSpecifier.text
      edges.push(spec)
      if (ROUTER.has(spec) && !node.isTypeOnly) {
        const clause = node.exportClause
        if (clause === undefined) router.push('*')
        else if (ts.isNamespaceExport(clause)) router.push(`* as ${clause.name.text}`)
        else
          for (const element of clause.elements)
            if (!element.isTypeOnly) router.push(imported(element))
      }
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const first = node.arguments[0]
      if (
        first !== undefined &&
        (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))
      ) {
        edges.push(first.text)
        if (ROUTER.has(first.text)) router.push(`import('${first.text}')`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { edges, router }
}

/** The names a module takes from the router as values. Empty for none, or types only. */
export const routerValues = (text, path) => scan(text, path).router

/** `@/x` and `./x` to a module that exists, or null for a package import. */
function resolveIn(spec, from, isFile) {
  const base = spec.startsWith('@/')
    ? normalise(spec.slice(2))
    : spec.startsWith('.')
      ? normalise(`${dirOf(from)}/${spec}`)
      : null
  if (base === null) return null
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]) {
    if (isFile(candidate)) return candidate
  }
  return null
}

/**
 * Walks out of every module `main.tsx` imports except `App`, and reports each
 * module it reaches that takes a value from the router, with the root it was
 * first reached from. `App` and everything only `App` reaches are inside the
 * router and are never walked.
 */
export function findOutsideRouterUse({ read, isFile, entry = 'main.tsx' }) {
  const text = read(entry)
  if (text === null) throw new Error(`${entry} is not there, so there is nothing to check from`)
  const app = resolveIn('@/App', entry, isFile)
  const roots = []
  for (const spec of scan(text, entry).edges) {
    const file = resolveIn(spec, entry, isFile)
    if (file !== null && file !== app && !roots.includes(file)) roots.push(file)
  }

  const seen = new Set()
  const offenders = []
  const walk = (file, root) => {
    if (seen.has(file) || file === app) return
    seen.add(file)
    const { edges, router } = scan(read(file) ?? '', file)
    // Keep walking past an offender: one should not hide the next.
    if (router.length > 0) offenders.push({ file, root, names: router })
    for (const spec of edges) {
      const next = resolveIn(spec, file, isFile)
      if (next !== null) walk(next, root)
    }
  }
  for (const root of roots) walk(root, root)

  return { roots, modules: seen.size, offenders }
}
