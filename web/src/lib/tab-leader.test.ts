/**
 * One tab runs the scout's schedule and reader (review 2, web-lib-3).
 *
 * Every open tab used to run both, so a due round ran once per tab. The
 * election is a Web Lock; this pins the part that is logic — who leads, and
 * that the next tab in line takes over when the leader lets go.
 */
import { describe, expect, it } from 'vitest'
import { waitToLead } from '@/lib/tab-leader'

/** A LockManager with the behaviour `waitToLead` relies on: a queue, and abort. */
function fakeLocks() {
  let held = false
  const queue: (() => void)[] = []
  const request = async (
    _name: string,
    options: { signal?: AbortSignal },
    callback: (lock: object | null) => Promise<void>,
  ) => {
    if (held) {
      await new Promise<void>((resolve, reject) => {
        queue.push(resolve)
        options.signal?.addEventListener('abort', () => {
          queue.splice(queue.indexOf(resolve), 1)
          reject(new Error('AbortError'))
        })
      })
    }
    held = true
    try {
      return await callback({})
    } finally {
      held = false
      queue.shift()?.()
    }
  }
  return { request } as unknown as LockManager
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('electing the tab that runs the scout (web-lib-3)', () => {
  it('lets one tab lead, and hands over when it closes', async () => {
    const locks = fakeLocks()
    const leading: string[] = []
    const tab = (name: string) => {
      const controller = new AbortController()
      const done = waitToLead('jojo-scout', controller.signal, () => leading.push(name), locks)
      return { close: () => controller.abort(), done }
    }
    const a = tab('A')
    const b = tab('B')
    await tick()
    expect(leading).toEqual(['A'])
    a.close()
    await a.done
    await tick()
    expect(leading).toEqual(['A', 'B'])
    b.close()
    await b.done
  })

  it('never leads once it has stopped waiting', async () => {
    const locks = fakeLocks()
    const leading: string[] = []
    const a = new AbortController()
    void waitToLead('jojo-scout', a.signal, () => leading.push('A'), locks)
    const b = new AbortController()
    const waiting = waitToLead('jojo-scout', b.signal, () => leading.push('B'), locks)
    await tick()
    b.abort()
    await waiting
    a.abort()
    await tick()
    expect(leading).toEqual(['A'])
  })

  it('leads at once where there are no Web Locks', async () => {
    const leading: string[] = []
    await waitToLead('jojo-scout', new AbortController().signal, () => leading.push('A'), undefined)
    expect(leading).toEqual(['A'])
  })
})
