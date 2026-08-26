/**
 * The JSON object in a model's reply, including when the reply was cut off.
 *
 * ## Three ways a small model's reply is not JSON
 *
 * 1. **It is wrapped.** Fenced, or prefixed with "Here is the JSON:", whatever
 *    the prompt asked for. The prompt is a hint; the scanner is the parser.
 * 2. **There is prose after it**, and the prose contains a brace. Taking
 *    `indexOf('{')` to `lastIndexOf('}')` then spans the object AND the
 *    sentence after it, and parses as nothing. Three copies of this file's
 *    predecessor did exactly that.
 * 3. **It stops mid-array**, because the reply hit the token limit. There is no
 *    closing brace at all, so both of the above return null and the caller
 *    reports "the model did not return JSON" — discarding the twenty entries
 *    that DID arrive to punish the twenty-first for being cut in half.
 *
 * The third is the one that matters on the deployment this app is built for.
 * A CV is read in section passes and each pass is a round trip to somebody's
 * own GPU; losing a whole pass to a truncation costs them the section AND the
 * time to do it again, and a smaller model is exactly the one that runs out of
 * room. So a truncated reply is salvaged: everything up to the last COMPLETE
 * element is kept and the open containers are closed.
 *
 * What is deliberately not done is guessing at a half-written value. The cut is
 * made at an element boundary the scanner actually saw, never inside a string
 * or a number, so a salvaged document contains only entries the model finished
 * writing. A partial entry is worse than a missing one: it goes in front of the
 * person as a fact to approve.
 */

type Container = {
  readonly open: '{' | '['
  /** Index to cut at — just past this container's last finished child. */
  cut: number
  /**
   * A nested container inside this one opened AND closed.
   *
   * The strong signal, and the one an array of entries gives: every element
   * before the cut is a whole object the model finished writing.
   */
  closedChild: boolean
  /**
   * A comma was seen at this container's own level.
   *
   * Weaker, because it says the container finished a MEMBER rather than a
   * CHILD. Cutting here inside an entry keeps that entry with some of its
   * fields missing, which is the partial fact this file promises not to
   * produce — so it is only used when no container has the strong signal, which
   * is the flat `{"a":1,"b":<cut>}` case where a member is all there is.
   */
  sawComma: boolean
}

/**
 * The first complete JSON object in `text`, or `null`.
 *
 * Balanced-brace scanning from the first `{`, so prose either side is ignored
 * and a brace in a trailing sentence cannot extend the span.
 */
export function firstJsonObject(text: string): unknown {
  const found = scan(text)
  return found === null ? null : parseOrNull(found.complete)
}

/**
 * The first JSON object, falling back to as much of a truncated one as is
 * safely recoverable.
 *
 * Returns `{ value, truncated }` so a caller can tell the person that some of
 * the reply was lost — which is a different sentence from "the model did not
 * answer", and only one of them is true.
 */
export function salvageJsonObject(text: string): { value: unknown; truncated: boolean } {
  const found = scan(text)
  if (found === null) return { value: null, truncated: false }

  const whole = parseOrNull(found.complete)
  if (whole !== null) return { value: whole, truncated: false }
  if (found.salvaged === null) return { value: null, truncated: false }

  const value = parseOrNull(found.salvaged)
  return value === null ? { value: null, truncated: false } : { value, truncated: true }
}

const parseOrNull = (text: string | null): unknown => {
  if (text === null) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/**
 * One pass over the reply, producing both candidate strings.
 *
 * `complete` is the balanced object if the scan found one. `salvaged` is what
 * is left when it did not: the text up to the innermost container that actually
 * finished a child, with the still-open containers closed after it.
 */
function scan(text: string): { complete: string | null; salvaged: string | null } | null {
  const start = text.indexOf('{')
  if (start === -1) return null

  const stack: Container[] = []
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]

    if (escaped) {
      escaped = false
      continue
    }
    if (inString) {
      if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{' || ch === '[') {
      stack.push({ open: ch, cut: i + 1, closedChild: false, sawComma: false })
      continue
    }

    if (ch === '}' || ch === ']') {
      const closed = stack.pop()
      if (closed === undefined) break
      if (stack.length === 0) {
        return { complete: text.slice(start, i + 1), salvaged: null }
      }
      // A finished child makes the PARENT worth keeping, and moves its cut.
      const parent = stack[stack.length - 1]
      if (parent) {
        parent.cut = i + 1
        parent.closedChild = true
      }
      continue
    }

    // A comma is the only place a container is provably between children.
    if (ch === ',') {
      const top = stack[stack.length - 1]
      if (top) {
        top.cut = i
        top.sawComma = true
      }
    }
  }

  return { complete: null, salvaged: close(text, start, stack) }
}

/**
 * The salvage, cut at the innermost container that CLOSED something.
 *
 * Two passes over the stack, innermost outwards, and the order is the whole
 * rule. The first looks for a container with a closed child, because everything
 * kept before that cut is a value the model finished. Only if no container has
 * one does the second pass accept a comma — the flat
 * `{"a":1,"b":<cut>}` case, where a member is the only kind of child there is.
 *
 * Preferring the comma would keep more text and be wrong: given
 * `[{"role":"A","tags":[…]},{"role":"B","tags":["z"<cut>]`, the innermost
 * comma sits inside the SECOND entry and cutting there yields a `{"role":"B"}`
 * with its tags silently missing — a fact that looks finished, goes in front of
 * the person, and gets approved. The array's closed child is one entry back and
 * loses only what was genuinely incomplete.
 *
 * Walking outwards, not just taking the innermost: a reply that stops right
 * after `{` has an innermost object with nothing in it at all, and keeping it
 * would add an empty entry.
 */
function close(text: string, start: number, stack: readonly Container[]): string | null {
  const cutAt = (depth: number): string => {
    let out = text.slice(start, stack[depth]?.cut ?? start)
    for (let up = depth; up >= 0; up -= 1) {
      const level = stack[up]
      if (level !== undefined) out += level.open === '{' ? '}' : ']'
    }
    return out
  }

  for (let depth = stack.length - 1; depth >= 0; depth -= 1) {
    if (stack[depth]?.closedChild === true) return cutAt(depth)
  }
  for (let depth = stack.length - 1; depth >= 0; depth -= 1) {
    if (stack[depth]?.sawComma === true) return cutAt(depth)
  }
  return null
}
