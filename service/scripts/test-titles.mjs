// The titles a test file declares, for `check-requests.mjs`: the first
// argument of every live it/test/describe, read past comments. Its own module
// so `test/check-requests.requests.test.ts` can hold it to the cases that
// matter without running the ledger check.

/**
 * The file's tokens that matter here: identifiers, punctuation and string
 * literals (decoded), with comments dropped. Small and heuristic — a `/` after
 * a value is division, anywhere else it opens a regex — which is enough for
 * test files, and keeps a quote inside a regex or a comment from opening a
 * string.
 */
export function tokens(text) {
  const out = []
  let i = 0
  const n = text.length
  const regexMayFollow = () => {
    const last = out[out.length - 1]
    if (last === undefined) return true
    if (last.kind === 'string') return false
    if (last.kind === 'word') return /^(return|typeof|case|do|else|in|of|new|void|throw|await|yield)$/.test(last.text)
    return !/^[)\]}]$/.test(last.text)
  }
  while (i < n) {
    const c = text[i]
    if (c === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i)
      i = end === -1 ? n : end
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      let value = ''
      let depth = 0
      while (j < n) {
        const d = text[j]
        if (d === '\\') {
          const e = text[j + 1]
          value += e === 'n' ? '\n' : e === 't' ? '\t' : e
          j += 2
          continue
        }
        if (c === '`' && d === '$' && text[j + 1] === '{') depth += 1
        else if (c === '`' && d === '}' && depth > 0) depth -= 1
        else if (d === c && depth === 0) break
        value += d
        j += 1
      }
      out.push({ kind: 'string', text: value })
      i = j + 1
      continue
    }
    if (c === '/' && regexMayFollow()) {
      let j = i + 1
      let inClass = false
      while (j < n && text[j] !== '\n') {
        const d = text[j]
        if (d === '\\') j += 1
        else if (d === '[') inClass = true
        else if (d === ']') inClass = false
        else if (d === '/' && !inClass) break
        j += 1
      }
      i = j + 1
      continue
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1
      while (j < n && /[\w$]/.test(text[j])) j += 1
      out.push({ kind: 'word', text: text.slice(i, j) })
      i = j
      continue
    }
    if (/\s/.test(c)) {
      i += 1
      continue
    }
    out.push({ kind: 'punct', text: c })
    i += 1
  }
  return out
}

const TEST_FNS = new Set(['it', 'test', 'describe'])
/** Modifiers that leave the test declared but not run. */
const DEAD = new Set(['skip', 'todo', 'skipIf', 'fails'])
const OPEN = new Set(['(', '[', '{'])
const CLOSE = new Set([')', ']', '}'])

/** The titles of the tests and suites a file declares, live ones only. */
export function testTitles(text) {
  const t = tokens(text)
  const titles = []
  for (let k = 0; k < t.length; k += 1) {
    const tok = t[k]
    if (tok.kind !== 'word' || !TEST_FNS.has(tok.text)) continue
    // `expect.it`, `foo.test(…)` (a RegExp's test) — a member, not the function.
    if (t[k - 1]?.text === '.') continue
    let at = k + 1
    let dead = false
    // `.each([...])`, `.runIf(cond)`, `.only`, `.concurrent`, …, then `(`.
    while (t[at]?.text === '.' && t[at + 1]?.kind === 'word') {
      if (DEAD.has(t[at + 1].text)) dead = true
      at += 2
      // A modifier that takes arguments of its own: skip past them, unless
      // this `(` is the call itself (its first argument is the title).
      if (t[at]?.text === '(' && t[at + 1]?.kind !== 'string') {
        let depth = 0
        for (; at < t.length; at += 1) {
          if (OPEN.has(t[at].text)) depth += 1
          else if (CLOSE.has(t[at].text)) {
            depth -= 1
            if (depth === 0) break
          }
        }
        at += 1
      }
    }
    if (dead) continue
    if (t[at]?.text === '(' && t[at + 1]?.kind === 'string') titles.push(t[at + 1].text)
  }
  return titles
}
