/**
 * The backup file, written and read in pieces.
 *
 * ## Why `backup.ts` alone cannot do this
 *
 * `buildBackup` makes the whole backup as one object, and its callers turn it
 * into one string (`JSON.stringify`) and then one byte array. Every document
 * is in that string as base64, a third larger than the document. Measured
 * against a 500 MB store, that is a string of ~667 million characters, built
 * one four-character append at a time, on the page's only thread, and then
 * copied twice more. V8 refuses any string over 2^29 − 24 characters
 * (~536 million), so past roughly 400 MB of documents the backup cannot be
 * written at all — and the tab stops answering long before it finds that out.
 * `readBackup` has the same wall on the way back: `file.text()` then
 * `JSON.parse`, one string the size of the file.
 *
 * ## The same file, in pieces
 *
 * The format does not change. What these functions write is a `jojo.backup`
 * file that `readBackup` reads, byte for byte the shape it always was — the
 * documents are just written last, one at a time, with each one's base64
 * produced as ASCII BYTES in fixed-size slices, never as a string. A caller
 * hands the pieces to something that does not join them in memory (a file on
 * disk, or a Blob made of Blobs) and lets the page breathe between them.
 *
 * Reading is the mirror: `createBackupReader` takes the file as text in
 * chunks, parses the JSON incrementally, and decodes `documents[*].data` as it
 * streams past, so no string larger than one chunk ever exists. Everything else
 * in the file — the graph, the readable half — is small and is built as values
 * the ordinary way.
 *
 * Pure, like the rest of `core`: no clock, no Blob, no TextDecoder. Pausing,
 * file handles and decoding bytes to text belong to the caller.
 */

import { BACKUP_FORMAT, BACKUP_VERSION, validateBackup } from './backup'
import type { BackupInput, BackupRead } from './backup'

/* --- base64, as bytes ------------------------------------------------------ */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const CODES = /* @__PURE__ */ Uint8Array.from(ALPHABET, (c) => c.charCodeAt(0))
const PAD = 61 // '='

/**
 * Base64 as ASCII bytes rather than a string.
 *
 * A typed array in and a typed array out, so a slice of a document is encoded
 * without a single string being made — which is the whole of the difference
 * between this and `toBase64` for a document of hundreds of megabytes.
 */
export function base64Bytes(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(bytes.length / 3) * 4)
  let i = 0
  let o = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!
    out[o++] = CODES[(n >> 18) & 63]!
    out[o++] = CODES[(n >> 12) & 63]!
    out[o++] = CODES[(n >> 6) & 63]!
    out[o++] = CODES[n & 63]!
  }
  const left = bytes.length - i
  if (left > 0) {
    const n = (bytes[i]! << 16) | (left === 2 ? bytes[i + 1]! << 8 : 0)
    out[o++] = CODES[(n >> 18) & 63]!
    out[o++] = CODES[(n >> 12) & 63]!
    out[o++] = left === 2 ? CODES[(n >> 6) & 63]! : PAD
    out[o++] = PAD
  }
  return out
}

/* --- writing --------------------------------------------------------------- */

/** One piece of the file: JSON text, or base64 ASCII bytes. Both are UTF-8 as they stand. */
export type BackupPart = string | Uint8Array

/**
 * How much of a document is encoded per piece: 3 MiB in, 4 MiB out.
 *
 * A multiple of three, so no slice but the last ends in padding and the
 * slices concatenate into exactly the base64 of the whole document.
 */
export const DOCUMENT_SLICE = 3 * 1024 * 1024

/**
 * Everything before the first document: `{…, "graph": {…}, "documents":[`.
 *
 * The graph is records and edges — kilobytes to a few megabytes even for a
 * long search — so it is stringified whole. Only documents need streaming.
 */
export function backupHead(input: Omit<BackupInput, 'documents'>): string {
  const head = JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: input.exportedAt,
    graph: { nodes: input.nodes, edges: input.edges },
    ...(input.readable === undefined ? {} : { readable: input.readable }),
  })
  return `${head.slice(0, -1)},"documents":[`
}

/**
 * One document entry, in pieces: `{"path":…,"bytes":…,"data":"` + base64 + `"}`.
 *
 * `bytes` is written BEFORE `data`, so a reader knows the size before the
 * bytes arrive. `first` decides the separator, so the caller need not.
 */
export function* documentParts(
  doc: { path: string; data: Uint8Array },
  first: boolean,
  slice = DOCUMENT_SLICE,
): Generator<BackupPart> {
  const step = Math.max(3, slice - (slice % 3))
  yield documentOpen(doc.path, doc.data.byteLength, first)
  for (let at = 0; at < doc.data.length; at += step) {
    yield base64Bytes(doc.data.subarray(at, at + step))
  }
  yield DOCUMENT_CLOSE
}

/**
 * The opening of one entry, up to where its base64 starts.
 *
 * Exported with `DOCUMENT_CLOSE` for a writer that reads a document in slices
 * itself — a stored file of hundreds of megabytes should not be read whole to
 * be written in slices — so the entry's spelling still has one author.
 */
export const documentOpen = (path: string, bytes: number, first: boolean): string =>
  `${first ? '' : ','}{"path":${JSON.stringify(path)},"bytes":${String(bytes)},"data":"`

/** What closes one entry after its base64. */
export const DOCUMENT_CLOSE = '"}'

/** What closes the file after the last document. */
export const BACKUP_TAIL = ']}'

/* --- reading --------------------------------------------------------------- */

/**
 * The `data` of a document whose base64 would not decode.
 *
 * A marker rather than a null, so the validator can say WHICH document was
 * damaged — the same sentence `readBackup` gives for the same file.
 */
export const UNDECODABLE: unique symbol = Symbol('undecodable base64')

const REVERSE = /* @__PURE__ */ (() => {
  const table = new Int8Array(128).fill(-1)
  for (let i = 0; i < ALPHABET.length; i += 1) table[ALPHABET.charCodeAt(i)] = i
  return table
})()

/** The most a document's declared size may reserve before a byte has arrived. */
const PREALLOCATE_MAX = 256 * 1024 * 1024

/**
 * Base64 decoded as it streams past, under exactly `fromBase64`'s rules:
 * whitespace skipped, padding only as the last one or two characters, and a
 * length that is a whole number of quads. Anything else is refused, never
 * guessed at.
 */
class Base64Stream {
  #chunks: Uint8Array[] = []
  #buf: Uint8Array
  #at = 0
  #total = 0
  #quad = [0, 0, 0, 0]
  #inQuad = 0
  #pads = 0
  #finished = false
  bad = false

  constructor(expected: number | undefined) {
    // Sized from the entry's own `bytes` when it came first, so a large
    // document is written into one buffer rather than collected and joined.
    // Capped, because `bytes` is a number in a file and a damaged one must not
    // be able to ask for gigabytes; past the cap the buffer simply grows.
    const size =
      expected !== undefined && Number.isInteger(expected) && expected >= 0 ? Math.min(expected, PREALLOCATE_MAX) : 1 << 20
    this.#buf = new Uint8Array(Math.max(1, size))
  }

  #byte(b: number): void {
    if (this.#at === this.#buf.length) {
      this.#chunks.push(this.#buf)
      this.#buf = new Uint8Array(Math.max(1 << 20, this.#buf.length))
      this.#at = 0
    }
    this.#buf[this.#at++] = b
    this.#total += 1
  }

  push(text: string, from: number, to: number): void {
    if (this.bad) return
    for (let i = from; i < to; i += 1) {
      const c = text.charCodeAt(i)
      if (c === 10 || c === 13 || c === 9 || c === 32) continue
      if (this.#finished) {
        this.bad = true
        return
      }
      if (c === PAD) {
        // `=` only in the last two places of a quad, and only padding after it.
        if (this.#inQuad < 2) {
          this.bad = true
          return
        }
        this.#pads += 1
        this.#quad[this.#inQuad++] = 0
      } else {
        const v = c < 128 ? REVERSE[c]! : -1
        if (v < 0 || this.#pads > 0) {
          this.bad = true
          return
        }
        this.#quad[this.#inQuad++] = v
      }
      if (this.#inQuad === 4) {
        const [a, b, cc, d] = this.#quad as [number, number, number, number]
        const n = (a << 18) | (b << 12) | (cc << 6) | d
        this.#byte((n >> 16) & 255)
        if (this.#pads < 2) this.#byte((n >> 8) & 255)
        if (this.#pads < 1) this.#byte(n & 255)
        this.#inQuad = 0
        if (this.#pads > 0) this.#finished = true
      }
    }
  }

  end(): Uint8Array | typeof UNDECODABLE {
    if (this.bad || this.#inQuad !== 0) return UNDECODABLE
    if (this.#chunks.length === 0) return this.#at === this.#buf.length ? this.#buf : this.#buf.slice(0, this.#at)
    const out = new Uint8Array(this.#total)
    let o = 0
    for (const c of this.#chunks) {
      out.set(c, o)
      o += c.length
    }
    out.set(this.#buf.subarray(0, this.#at), o)
    return out
  }
}

type Frame =
  | { kind: 'object'; value: Record<string, unknown>; key: string | null }
  | { kind: 'array'; value: unknown[] }

type Mode =
  | 'value' // a value is expected
  | 'value-or-close' // just after `[`
  | 'key-or-close' // just after `{`
  | 'key' // after `,` in an object
  | 'colon'
  | 'after' // after a value: `,` or a close
  | 'string'
  | 'base64'
  | 'number'
  | 'literal'
  | 'done'

const WS = (c: number) => c === 32 || c === 10 || c === 13 || c === 9

/** Sets a key the way `JSON.parse` does — as an own property, `__proto__` included. */
function setKey(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
  } else {
    target[key] = value
  }
}

/**
 * A JSON parser that takes its input in chunks.
 *
 * General JSON, not a format-shaped scanner, so a backup whose keys arrive in
 * any order — the phone's writer, an older build, a file someone pretty-printed
 * — reads exactly as `JSON.parse` would read it. The one special case is a
 * string at `documents[i].data`, which is decoded as base64 while it streams
 * rather than collected: that is the only value in the file that can be large.
 */
class ChunkedJson {
  #stack: Frame[] = []
  #mode: Mode = 'value'
  #root: unknown = undefined
  #error: string | null = null
  #isKey = false
  #str: string[] = []
  #escape: string | null = null // null, '' (after `\`), or the hex of `\u` so far
  #token = ''
  #b64: Base64Stream | null = null
  #offset = 0

  get error(): string | null {
    return this.#error
  }

  #fail(message: string): void {
    if (this.#error === null) this.#error = `${message} at character ${String(this.#offset)}`
  }

  /** Whether a string starting now is `documents[i].data` of the top-level object. */
  #isDocumentData(): boolean {
    const s = this.#stack
    if (s.length !== 3) return false
    const [root, list, doc] = s as [Frame, Frame, Frame]
    return (
      root.kind === 'object' &&
      root.key === 'documents' &&
      list.kind === 'array' &&
      doc.kind === 'object' &&
      doc.key === 'data'
    )
  }

  #emit(value: unknown): void {
    const top = this.#stack[this.#stack.length - 1]
    if (top === undefined) {
      this.#root = value
      this.#mode = 'done'
      return
    }
    if (top.kind === 'array') top.value.push(value)
    else if (top.key !== null) {
      setKey(top.value, top.key, value)
      top.key = null
    }
    this.#mode = 'after'
  }

  #finishToken(): boolean {
    const t = this.#token
    this.#token = ''
    if (this.#mode === 'literal') {
      if (t === 'true') this.#emit(true)
      else if (t === 'false') this.#emit(false)
      else if (t === 'null') this.#emit(null)
      else {
        this.#fail(`Unexpected token "${t.slice(0, 12)}"`)
        return false
      }
      return true
    }
    if (!/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(t)) {
      this.#fail(`Bad number "${t.slice(0, 24)}"`)
      return false
    }
    this.#emit(Number(t))
    return true
  }

  push(text: string): void {
    let i = 0
    const n = text.length
    while (i < n && this.#error === null) {
      const mode = this.#mode

      if (mode === 'base64') {
        const b64 = this.#b64!
        if (this.#escape === '') {
          // The second half of a `\/` split across two chunks.
          this.#escape = null
          if (text[i] !== '/') b64.bad = true
          else b64.push('/', 0, 1)
          this.#offset += 1
          i += 1
          continue
        }
        const close = text.indexOf('"', i)
        const end = close === -1 ? n : close
        // A JSON writer may escape `/` as `\/`; nothing else is legal in base64.
        const slash = text.indexOf('\\', i)
        if (slash !== -1 && slash < end) {
          b64.push(text, i, slash)
          if (slash + 1 >= n) {
            // The escape straddles chunks; very rare, and only `\/` is valid.
            this.#escape = ''
            this.#offset += n - i
            return
          }
          if (text[slash + 1] !== '/') b64.bad = true
          else b64.push('/', 0, 1)
          this.#offset += slash + 2 - i
          i = slash + 2
          continue
        }
        b64.push(text, i, end)
        this.#offset += end - i
        if (close === -1) return
        this.#b64 = null
        const decoded = b64.end()
        this.#emit(decoded)
        this.#offset += 1
        i = close + 1
        continue
      }

      if (mode === 'string') {
        if (this.#escape !== null) {
          const c = text[i]!
          if (this.#escape === '') {
            const simple: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }
            if (c === 'u') this.#escape = 'u'
            else if (c in simple) {
              this.#str.push(simple[c]!)
              this.#escape = null
            } else {
              this.#fail('Bad escape')
              return
            }
          } else {
            this.#escape += c
            if (!/^u[0-9a-fA-F]*$/.test(this.#escape)) {
              this.#fail('Bad unicode escape')
              return
            }
            if (this.#escape.length === 5) {
              this.#str.push(String.fromCharCode(parseInt(this.#escape.slice(1), 16)))
              this.#escape = null
            }
          }
          this.#offset += 1
          i += 1
          continue
        }
        // Copy the run up to the next quote or backslash in one slice.
        let j = i
        while (j < n) {
          const c = text.charCodeAt(j)
          if (c === 34 || c === 92) break
          if (c < 32) {
            this.#offset += j - i
            this.#fail('Control character in string')
            return
          }
          j += 1
        }
        if (j > i) this.#str.push(text.slice(i, j))
        this.#offset += j - i
        if (j === n) return
        if (text.charCodeAt(j) === 92) {
          this.#escape = ''
          this.#offset += 1
          i = j + 1
          continue
        }
        const value = this.#str.join('')
        this.#str = []
        this.#offset += 1
        i = j + 1
        if (this.#isKey) {
          const top = this.#stack[this.#stack.length - 1] as Extract<Frame, { kind: 'object' }>
          top.key = value
          this.#mode = 'colon'
        } else {
          this.#emit(value)
        }
        continue
      }

      if (mode === 'number' || mode === 'literal') {
        const c = text[i]!
        const part = mode === 'number' ? /[0-9eE+\-.]/ : /[a-z]/
        if (part.test(c)) {
          this.#token += c
          if (this.#token.length > 400) {
            this.#fail('Token too long')
            return
          }
          this.#offset += 1
          i += 1
          continue
        }
        if (!this.#finishToken()) return
        continue // re-read this character in the new mode
      }

      const code = text.charCodeAt(i)
      if (WS(code)) {
        this.#offset += 1
        i += 1
        continue
      }
      const c = text[i]!

      if (mode === 'done') {
        this.#fail('Unexpected data after the end')
        return
      }

      if (mode === 'colon') {
        if (c !== ':') {
          this.#fail('Expected ":"')
          return
        }
        this.#mode = 'value'
      } else if (mode === 'key' || mode === 'key-or-close') {
        if (c === '}' && mode === 'key-or-close') {
          this.#close('object')
        } else if (c === '"') {
          this.#isKey = true
          this.#mode = 'string'
        } else {
          this.#fail('Expected a key')
          return
        }
      } else if (mode === 'after') {
        const top = this.#stack[this.#stack.length - 1]!
        if (c === ',') this.#mode = top.kind === 'object' ? 'key' : 'value'
        else if (c === '}' || c === ']') {
          if (!this.#close(c === '}' ? 'object' : 'array')) return
        } else {
          this.#fail('Expected "," or a closing bracket')
          return
        }
      } else {
        // 'value' or 'value-or-close'
        if (c === ']' && mode === 'value-or-close') {
          this.#close('array')
        } else if (c === '{') {
          this.#stack.push({ kind: 'object', value: {}, key: null })
          this.#mode = 'key-or-close'
        } else if (c === '[') {
          this.#stack.push({ kind: 'array', value: [] })
          this.#mode = 'value-or-close'
        } else if (c === '"') {
          this.#isKey = false
          if (this.#isDocumentData()) {
            const doc = this.#stack[2] as Extract<Frame, { kind: 'object' }>
            const bytes = doc.value['bytes']
            this.#b64 = new Base64Stream(typeof bytes === 'number' ? bytes : undefined)
            this.#mode = 'base64'
          } else {
            this.#mode = 'string'
          }
        } else if (c === '-' || (c >= '0' && c <= '9')) {
          this.#mode = 'number'
          continue
        } else if (c >= 'a' && c <= 'z') {
          this.#mode = 'literal'
          continue
        } else {
          this.#fail(`Unexpected "${c}"`)
          return
        }
      }
      this.#offset += 1
      i += 1
    }
  }

  #close(kind: Frame['kind']): boolean {
    const top = this.#stack.pop()
    if (top === undefined || top.kind !== kind) {
      this.#fail('Mismatched bracket')
      return false
    }
    this.#emit(top.value)
    return true
  }

  end(): { ok: true; value: unknown } | { ok: false; message: string } {
    if (this.#error === null && (this.#mode === 'number' || this.#mode === 'literal')) this.#finishToken()
    if (this.#error !== null) return { ok: false, message: this.#error }
    if (this.#mode !== 'done') return { ok: false, message: 'Unexpected end of JSON input' }
    return { ok: true, value: this.#root }
  }
}

/**
 * Reads a backup handed over in text chunks, and gives the same verdict
 * `readBackup` gives for the same file — through the same validator, so the
 * two cannot drift into accepting different things.
 */
export function createBackupReader(): { push: (text: string) => void; end: () => BackupRead } {
  const json = new ChunkedJson()
  return {
    push: (text) => {
      if (json.error === null) json.push(text)
    },
    end: () => {
      const parsed = json.end()
      if (!parsed.ok) return { ok: false, error: { code: 'backup/unreadable', message: parsed.message } }
      return validateBackup(parsed.value, (data) =>
        data instanceof Uint8Array ? data : data === UNDECODABLE ? 'bad' : 'missing',
      )
    },
  }
}
