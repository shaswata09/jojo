import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Every key the phone's code asks for exists in the English catalog.
 *
 * `catalogs.test.ts` compares the catalogs with each other, so a key the code
 * uses and NO catalog holds passes it: i18next then renders the key itself
 * (`returnNull: false`, English fallback). That is how the Guide's "Built with"
 * page shipped reading `builtWith.intro`, `builtWith.stack.build` and so on in
 * every language, English included.
 *
 * A source scan rather than a runtime one, because the screens import React
 * Native, which this runner does not load. It reads the namespaces a file names
 * in `useTranslation(...)` (no argument means `common`), then checks each
 * literal `t('…')` key against them — `ns:key` against that namespace — and
 * each templated `t(\`a.b.${x}\`)` against the keys its fixed parts allow.
 * Plural keys count as present through any of their suffixes.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..')
const EN = path.join(HERE, 'locales', 'en')

const PLURAL = ['_zero', '_one', '_two', '_few', '_many', '_other']

const catalog = new Map<string, Set<string>>()
for (const file of readdirSync(EN)) {
  if (!file.endsWith('.json')) continue
  const keys = new Set<string>()
  const walk = (node: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(node)) {
      const key = prefix ? `${prefix}.${k}` : k
      keys.add(key)
      if (v && typeof v === 'object') walk(v as Record<string, unknown>, key)
    }
  }
  walk(JSON.parse(readFileSync(path.join(EN, file), 'utf8')) as Record<string, unknown>, '')
  catalog.set(file.slice(0, -5), keys)
}

const has = (ns: string, key: string) => {
  const keys = catalog.get(ns)
  return keys !== undefined && (keys.has(key) || PLURAL.some((s) => keys.has(key + s)))
}

const sources: string[] = []
const collect = (dir: string) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collect(full)
    else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) sources.push(full)
  }
}
collect(SRC)

/** The namespaces `useTranslation` names in a file; `common` when it names none. */
function namespacesOf(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/useTranslation\(\s*(\[[^\]]*\]|'[^']*'|"[^"]*")?/g)) {
    if (!m[1]) {
      out.add('common')
      continue
    }
    for (const x of m[1].matchAll(/['"]([^'"]+)['"]/g)) out.add(x[1]!)
  }
  return out.size > 0 ? [...out] : ['common']
}

const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length

describe('the keys the phone asks for', () => {
  it('are all in the English catalog', () => {
    const missing: string[] = []
    for (const file of sources) {
      const text = readFileSync(file, 'utf8')
      if (!text.includes('useTranslation')) continue
      const namespaces = namespacesOf(text)
      // A local `const t = (key) => i18next.t(\`ns:prefix.${key}\`)` wrapper:
      // its literal keys are relative to that prefix.
      const prefixes = [...text.matchAll(/i18next\.t\(\s*`([\w.:]+)\$\{key\}`/g)].map((p) => p[1]!)
      const resolves = (key: string) =>
        key.includes(':')
          ? has(key.split(':')[0]!, key.split(':').slice(1).join(':'))
          : namespaces.some((ns) => has(ns, key))
      for (const m of text.matchAll(/\bt\(\s*'([\w.:-]+)'/g)) {
        const raw = m[1]!
        const ok = resolves(raw) || prefixes.some((prefix) => resolves(prefix + raw))
        if (!ok) missing.push(`${path.relative(SRC, file)}:${lineOf(text, m.index)} ${raw}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('match at least one catalog key when built from a template', () => {
    const missing: string[] = []
    for (const file of sources) {
      const text = readFileSync(file, 'utf8')
      if (!text.includes('useTranslation')) continue
      const namespaces = namespacesOf(text)
      for (const m of text.matchAll(/\bt\(\s*`([^`]*)`/g)) {
        const template = m[1]!
        if (!template.includes('${')) continue
        const named = /^(\w+):/.exec(template)
        const body = named ? template.slice(named[0].length) : template
        // Wholly dynamic (`${key}`): nothing fixed to check against.
        if (body.startsWith('${')) continue
        const pattern = new RegExp(
          '^' +
            body
              .split(/\$\{[^}]*\}/)
              .map((part) => part.replace(/[.*+?^()|[\]\\]/g, '\\$&'))
              .join('[^]+?') +
            '(_(zero|one|two|few|many|other))?$',
        )
        const candidates = named ? [named[1]!] : namespaces
        const ok = candidates.some((ns) =>
          [...(catalog.get(ns) ?? [])].some((k) => pattern.test(k)),
        )
        if (!ok) missing.push(`${path.relative(SRC, file)}:${lineOf(text, m.index)} ${template}`)
      }
    }
    expect(missing).toEqual([])
  })
})
