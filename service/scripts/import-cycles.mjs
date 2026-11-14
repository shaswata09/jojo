/**
 * Value-import cycles inside the package, by Tarjan's strongly-connected
 * components.
 *
 * The layer rule in `check-layers.mjs` forbids an edge UP a layer, which makes a
 * cycle across layers impossible — and says nothing about a cycle inside one.
 * `agent/queries.ts` ↔ `agent/graph-query.ts` was such a cycle: both legal,
 * both in L3.5, and an ES-module cycle means one of the two runs its top level
 * against the other's uninitialised bindings. Whether that throws depends on
 * which file the bundler happens to reach first, which differs between Vite,
 * Metro and vitest — the worst kind of bug to have to find.
 *
 * Only VALUE edges count. `import type` and `export type … from` are erased
 * before anything runs, so a cycle made of them has no initialisation order to
 * get wrong. `import { type A } from` is NOT erased: the package compiles under
 * `verbatimModuleSyntax`, which keeps it as `import {} from` — a real edge.
 * Dynamic `import()` is ignored too: it runs after both modules have finished
 * initialising, which is the usual way to break a cycle on purpose.
 *
 * Parsed with TypeScript's own parser, as `check-platform.mjs` does. This was
 * a pair of line-anchored regexes, and a missed spelling is a cycle nobody is
 * told about: an import after a `;` on the same line, or after a block
 * comment (`/* why *\/ import { x } from './y'`), was not an edge at all (R38).
 * The parser has no notion of lines, and it is also what tells `import type`
 * from `import { type A }` without a pattern having to.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

/** Relative VALUE specifiers in `source`: every top-level import and re-export not erased. */
export function valueSpecsIn(source) {
  const file = ts.createSourceFile('x.tsx', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX)
  const out = []
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      // `import type …` is erased; `import { type A } …` is not (see above).
      if (statement.importClause?.isTypeOnly === true) continue
      if (ts.isStringLiteral(statement.moduleSpecifier)) out.push(statement.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined) {
      if (statement.isTypeOnly) continue
      if (ts.isStringLiteral(statement.moduleSpecifier)) out.push(statement.moduleSpecifier.text)
    }
  }
  return out.filter((spec) => spec.startsWith('.'))
}

const resolve = (from, spec) => {
  const base = path.resolve(path.dirname(from), spec)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Every strongly-connected component of more than one file (or a file that
 * imports itself), each as a sorted list of paths.
 */
export function cyclesIn(files) {
  const known = new Set(files)
  const edges = new Map()
  for (const file of files) {
    const targets = valueSpecsIn(readFileSync(file, 'utf8'))
      .map((spec) => resolve(file, spec))
      .filter((t) => t !== null && known.has(t))
    edges.set(file, [...new Set(targets)])
  }

  // Iterative Tarjan: the recursive form is a stack overflow waiting for a
  // long import chain, and this runs on every lint.
  let next = 0
  const index = new Map()
  const low = new Map()
  const onStack = new Set()
  const stack = []
  const out = []

  for (const root of files) {
    if (index.has(root)) continue
    const work = [{ node: root, i: 0 }]
    index.set(root, next)
    low.set(root, next)
    next += 1
    stack.push(root)
    onStack.add(root)

    while (work.length > 0) {
      const frame = work[work.length - 1]
      const targets = edges.get(frame.node) ?? []
      if (frame.i < targets.length) {
        const target = targets[frame.i]
        frame.i += 1
        if (!index.has(target)) {
          index.set(target, next)
          low.set(target, next)
          next += 1
          stack.push(target)
          onStack.add(target)
          work.push({ node: target, i: 0 })
        } else if (onStack.has(target)) {
          low.set(frame.node, Math.min(low.get(frame.node), index.get(target)))
        }
        continue
      }

      work.pop()
      const parent = work[work.length - 1]
      if (parent) low.set(parent.node, Math.min(low.get(parent.node), low.get(frame.node)))

      if (low.get(frame.node) === index.get(frame.node)) {
        const component = []
        let member
        do {
          member = stack.pop()
          onStack.delete(member)
          component.push(member)
        } while (member !== frame.node)
        const selfLoop = component.length === 1 && targets.includes(frame.node)
        if (component.length > 1 || selfLoop) out.push(component.sort())
      }
    }
  }
  return out
}
