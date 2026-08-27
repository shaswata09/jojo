/**
 * The toolbar popup opened against a service worker that did not answer.
 *
 * MV3 stops an idle service worker, and waking it is racy — `bridge.js` says so
 * on its own send and treats a `lastError` as a normal state rather than a
 * fault. The popup's opening sequence did not: three awaits ran before the
 * first `addEventListener`, and `void start()` threw the rejection away. One
 * missed reply therefore produced a popup that looked completely finished and
 * did nothing at all — 'Keep this page' enabled by `drawTab` and wired to
 * nothing, 'Nothing kept yet' sitting over a queue nobody had managed to read,
 * and no error anywhere to explain it. Every symptom was silent, which is why
 * it needs a test rather than a look.
 *
 * Run out of the file the browser loads, for the reason `reader-relay.test.ts`
 * and `capture-assets.test.ts` give: a transcription of a guard is not the
 * guard. `?raw` and `new Function` are their precedent — the extension is plain
 * JS with no exports and cannot be imported. `document` and `chrome` are
 * injected as parameters, so the real `start` runs against the stubs below.
 *
 * The DOM here is hand-built and deliberately tiny (D20: no jsdom). It is not a
 * browser and does not try to be one; it records what `popup.js` asks for and
 * what it sets, and it refuses an id that `popup.html` does not define — a
 * fourth way this file used to be able to break in silence.
 */
import { describe, expect, it } from 'vitest'
import popupSource from '../../extension/popup.js?raw'
import popupHtml from '../../extension/popup.html?raw'

/** One element. Only the handful of properties `popup.js` actually touches. */
class Stub {
  tag: string
  own = ''
  kids: Stub[] = []
  hidden = false
  disabled = false
  checked = false
  value = ''
  className = ''
  title = ''
  type = ''
  style: Record<string, string> = {}
  attributes: Record<string, string> = {}
  handlers = new Map<string, Array<(event?: unknown) => unknown>>()

  constructor(tag: string) {
    this.tag = tag
  }

  /** Concatenated like the real one, so `readerDot`'s appended text is read. */
  get textContent(): string {
    return this.own + this.kids.map((kid) => kid.textContent).join('')
  }

  /** Setting it drops the children, which is how `drawKept` empties the list. */
  set textContent(next: string) {
    this.own = String(next)
    this.kids = []
  }

  append(...kids: Stub[]) {
    this.kids.push(...kids)
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value
  }

  addEventListener(name: string, fn: (event?: unknown) => unknown) {
    const bucket = this.handlers.get(name) ?? []
    bucket.push(fn)
    this.handlers.set(name, bucket)
  }

  wired(name: string) {
    return (this.handlers.get(name) ?? []).length > 0
  }

  /** Every listener for `name`, awaited — the handlers are all async. */
  fire(name: string) {
    const bucket = this.handlers.get(name) ?? []
    if (bucket.length === 0) throw new Error(`nothing is listening for '${name}'`)
    return Promise.all(bucket.map((fn) => fn()))
  }
}

/** The element `popup.html` declares for an id, as it is before any script. */
const declared = (id: string) => {
  const tag = popupHtml.match(new RegExp(`<[a-z0-9]+[^>]*\\bid="${id}"[^>]*>`, 'i'))
  if (tag === null) return null
  const inner = popupHtml.match(
    new RegExp(`<([a-z0-9]+)[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</\\1>`, 'i'),
  )
  const node = new Stub(tag[0].slice(1).split(/[\s>/]/)[0] ?? 'div')
  // Read from the markup rather than assumed: the button really does ship
  // disabled and 'Nothing kept yet' really does ship visible, and both of those
  // facts are what the assertions below turn on.
  node.disabled = /\sdisabled[\s>/]/.test(tag[0])
  node.hidden = /\shidden[\s>/]/.test(tag[0])
  node.own = (inner?.[2] ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return node
}

type Reply = { error?: string; response?: unknown }
type Message = { type: string } & Record<string, unknown>

const HOSTS = ['api.anthropic.com', 'api.openai.com']

/** A worker that is awake and answers everything plausibly. */
const awake = (message: Message): Reply => {
  if (message.type === 'jojo:list-captures') return { response: { captures: [] } }
  if (message.type === 'jojo:get-routing') {
    return {
      response: {
        routing: { reader: { enabled: false, endpoint: 'http://127.0.0.1:3001' }, models: {} },
        hosts: HOSTS,
      },
    }
  }
  return { response: { ok: true } }
}

/** The race this file exists for: the send fails instead of arriving. */
const ASLEEP = 'Could not establish connection. Receiving end does not exist.'

function mount(options: {
  tab?: { id: number; url: string; title: string }
  /** Holds the tab lookup open, to inspect the popup mid-draw. */
  until?: Promise<void>
  reply: (message: Message) => Reply
}) {
  const nodes = new Map<string, Stub>()
  const sent: Message[] = []

  const document = {
    getElementById(id: string) {
      const already = nodes.get(id)
      if (already) return already
      const node = declared(id)
      if (node === null) throw new Error(`popup.js wants #${id}; popup.html has no such element`)
      nodes.set(id, node)
      return node
    },
    createElement: (tag: string) => new Stub(tag),
    createTextNode: (text: string) => {
      const node = new Stub('#text')
      node.own = text
      return node
    },
  }

  const chrome = {
    runtime: {
      lastError: undefined as { message: string } | undefined,
      getManifest: () => ({ version: '9.9.9' }),
      sendMessage(message: Message, cb: (response: unknown) => void) {
        sent.push(message)
        const answer = options.reply(message)
        // Asynchronous, and `lastError` only readable from inside the callback,
        // which is exactly the shape `ask()` is written against.
        queueMicrotask(() => {
          chrome.runtime.lastError =
            answer.error === undefined ? undefined : { message: answer.error }
          cb(answer.response)
          chrome.runtime.lastError = undefined
        })
      },
    },
    tabs: {
      query: async () => {
        if (options.until !== undefined) await options.until
        return options.tab === undefined ? [] : [options.tab]
      },
    },
  }

  const body = popupSource.replace(/void start\(\)\.catch\([\s\S]*$/, '')
  if (body === popupSource) throw new Error('popup.js no longer ends by starting itself')
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const start = new Function('document', 'chrome', `${body}; return start`)(
    document,
    chrome,
  ) as () => Promise<void>

  return { start, sent, at: (id: string) => document.getElementById(id) }
}

const page = { id: 7, url: 'https://example.com/jobs/1', title: 'A job' }

describe('the popup, when waking the worker loses the first message', () => {
  it('leaves every control wired', async () => {
    const popup = mount({ tab: page, reply: () => ({ error: ASLEEP }) })
    await popup.start()

    // Not one of these was attached before: `start()` rejected at the first
    // `ask`, and every `addEventListener` in the file sat after it.
    expect(popup.at('capture').wired('click')).toBe(true)
    expect(popup.at('clear').wired('click')).toBe(true)
    expect(popup.at('reader-on').wired('change')).toBe(true)
    expect(popup.at('reader-endpoint').wired('change')).toBe(true)
    expect(popup.at('reader-test').wired('click')).toBe(true)
  })

  it('does not leave "Keep this page" enabled and inert', async () => {
    const popup = mount({ tab: page, reply: () => ({ error: ASLEEP }) })
    await popup.start()

    // `drawTab` reads the tab through `chrome.tabs`, not through the worker, so
    // it succeeds and enables the button even when every message is lost. An
    // enabled button that answers a click is the whole difference here.
    expect(popup.at('capture').disabled).toBe(false)
    // Swallowed on purpose: the click reaches the worker, which is what being
    // wired means and is all this asserts. The handler does not then finish,
    // because its closing `drawKept()` rejects for the same sleeping-worker
    // reason and nothing catches it — a separate defect, reported rather than
    // fixed here, and this `catch` is written so that fixing it later does not
    // turn this test red.
    await popup
      .at('capture')
      .fire('click')
      .catch(() => {})
    expect(popup.sent.some((m) => m.type === 'jojo:capture-tab')).toBe(true)
  })

  it('says the kept list could not be read, rather than that it is empty', async () => {
    const popup = mount({ tab: page, reply: () => ({ error: ASLEEP }) })
    expect(declared('kept-empty')?.own).toContain('Nothing kept yet')
    await popup.start()

    const empty = popup.at('kept-empty')
    expect(empty.hidden).toBe(false)
    // 'Nothing kept yet' over a queue the popup never managed to read is the one
    // actively wrong answer available: it reads as "your capture did not save".
    expect(empty.textContent).not.toContain('Nothing kept yet')
    expect(empty.textContent).toContain('Could not read the kept pages')
    expect(empty.textContent).toContain('Receiving end does not exist')
  })

  it('says the routing settings were not read, rather than showing them off', async () => {
    const popup = mount({ tab: page, reply: () => ({ error: ASLEEP }) })
    await popup.start()

    // An unread setting must not be drawn as a setting that is switched off.
    expect(popup.at('reader-status').textContent).toContain('Could not read the settings')
    expect(popup.at('reader-status').textContent).not.toContain('Switched off')
  })
})

describe('the popup, while it is still drawing', () => {
  it('is wired before the first answer comes back', async () => {
    let open = () => {}
    const until = new Promise<void>((resolve) => {
      open = resolve
    })
    const popup = mount({ tab: page, until, reply: awake })

    // Deliberately not awaited yet. The popup paints the moment it opens and
    // the round trip to the worker is not instant, so there is a real window in
    // which a person can click a button that is already on screen. Wiring after
    // the draws put every control in that window; wiring first closes it,
    // because the listeners are attached before `start` ever suspends.
    const running = popup.start()
    expect(popup.at('capture').wired('click')).toBe(true)
    expect(popup.at('clear').wired('click')).toBe(true)
    expect(popup.at('reader-on').wired('change')).toBe(true)

    open()
    await running
    expect(popup.at('capture').disabled).toBe(false)
  })
})

describe('the popup, when only one of the three answers is lost', () => {
  it('still draws the regions that did answer', async () => {
    const popup = mount({
      tab: page,
      reply: (message) =>
        message.type === 'jojo:list-captures' ? { error: ASLEEP } : awake(message),
    })
    await popup.start()

    // The kept list and the model switches are separate questions on separate
    // messages. One `try` around all three awaits would have blanked the
    // switches because the capture queue was the thing that failed.
    expect(popup.at('models').kids).toHaveLength(HOSTS.length)
    expect(popup.at('models').textContent).toContain('Anthropic')
    expect(popup.at('kept-empty').textContent).toContain('Could not read the kept pages')
  })
})

describe('the popup, when the worker is awake', () => {
  it('keeps the tab it was opened over, though the button was wired before it was known', async () => {
    const popup = mount({ tab: page, reply: awake })
    await popup.start()
    await popup.at('capture').fire('click')

    // Wiring first means the handler cannot close over a tab that has not been
    // looked up yet; it reads `openTab` at click time instead. A handler that
    // captured the value too early would send `undefined` here, and the worker
    // would answer 'No page to capture.' on a perfectly capturable page.
    const capture = popup.sent.find((m) => m.type === 'jojo:capture-tab')
    expect(capture?.tabId).toBe(page.id)
    expect(popup.at('capture-note').textContent).toBe('Kept.')
  })

  it('draws the queue and the switches as before', async () => {
    const popup = mount({ tab: page, reply: awake })
    await popup.start()

    expect(popup.at('kept-empty').hidden).toBe(false)
    expect(popup.at('kept-empty').textContent).toContain('Nothing kept yet')
    expect(popup.at('clear').hidden).toBe(true)
    expect(popup.at('reader-status').textContent).toContain('Switched off')
    expect(popup.at('version').textContent).toBe('extension 9.9.9')
  })
})
