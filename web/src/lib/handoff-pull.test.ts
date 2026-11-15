/**
 * Q129: the computer receives from the phone by pulling — the order, and every
 * refusal, without mounting anything (D20).
 *
 * The phone here is the REAL phone-side code (`createPullServer`,
 * `acceptPairing`, `pathToken`) with a function call standing in for the
 * socket, and the computer is the real `pullFromPhone` with the real pairing
 * check (`completePairing`). What is fake is only the wire, so a test can lose
 * a request, swap a token, or answer with too much.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildBackup } from '@jojo/service/core/backup'
import { encodeAddress, groupCode, type DialAddress } from '@jojo/service/core/dial'
import { pathToken } from '@jojo/service/core/handoff'
import { asciiJsonBytes, createPullServer } from '@jojo/service/core/handoff-pull'
import {
  acceptPairing,
  beginPairing,
  completePairing,
  encodeOffer,
  type PairingState,
} from '@jojo/service/core/pairing'
import { createSecrets } from '@jojo/service/crypto/noble-secrets'
import type { RestorePlan } from '@jojo/service/core/backup'
import type { DocumentStore } from '@jojo/service/repo/restore'
import type { Repository } from '@jojo/service/repo/repository'
import type { StoreMeta } from '@jojo/service/repo/meta'
import { HANDOFF_ADVICE, type HandoffResult } from '@/lib/handoff-client'
import { DIAL_ADVICE } from '@/lib/handoff-send'
import {
  PULL_ADVICE,
  UNPROVEN_ADVICE,
  createDecision,
  pullConfirmCopy,
  pullFromPhone,
  readPulled,
  restoreFromPhone,
} from '@/lib/handoff-pull'

const secrets = createSecrets()
const PHONE: DialAddress = { host: [192, 168, 1, 40], port: 8787 }

const node = (id: string) => ({
  id: `app:${id}`,
  type: 'application' as const,
  props: {
    slug: id,
    role: 'Research Engineer',
    note: 'Zoë — 東京',
    roleTag: 'Researcher',
    stage: 'submitted',
    lastAction: 'Submitted',
    lastActionAt: '2026-01-01T00:00:00.000Z',
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

/** What the phone serves: a real backup, as the phone writes it (ASCII JSON). */
const phoneBackup = () =>
  asciiJsonBytes(
    JSON.stringify(
      buildBackup({
        exportedAt: '2026-11-15T10:00:00.000Z',
        nodes: [node('01a02b14-31db-7278-a6d7-c03d325832ba')] as never,
        edges: [],
        documents: [],
      }),
    ),
  )

/**
 * This computer's offer, and a phone that read it.
 *
 * `unproven`: the device answering at the right address, under the right path,
 * holds keys from SOME OTHER screen — something on the network that saw the
 * URL go by but never saw this animation. `elsewhere`: a phone listening under
 * a different session's token altogether.
 */
async function scene({
  unproven = false,
  elsewhere = false,
  serve = phoneBackup,
}: { unproven?: boolean; elsewhere?: boolean; serve?: () => Uint8Array } = {}) {
  const state: PairingState = await beginPairing(secrets, Date.now())
  const token = await pathToken(secrets, state.offer)
  const other = (await beginPairing(secrets, Date.now())).offer
  const accepted = await acceptPairing(secrets, encodeOffer(unproven ? other : state.offer))
  if (!accepted.ok) throw new Error(accepted.error)
  const phoneToken = elsewhere ? await pathToken(secrets, other) : token
  const server = createPullServer(secrets, accepted.value.keys, async () => serve())
  const log: string[] = []

  /** The phone's socket: refuses any token but its own, as `readRequest` does. */
  const fetchPairing = async (address: DialAddress, t: string): Promise<HandoffResult<Uint8Array>> => {
    log.push(`pair ${t === phoneToken ? 'token-ok' : 'TOKEN-WRONG'}`)
    if (address.port !== PHONE.port) return { ok: false, error: 'handoff/unreachable' }
    if (t !== phoneToken) return { ok: false, error: 'handoff/refused' }
    return { ok: true, value: accepted.value.response }
  }
  const fetchChunk = async (
    _address: DialAddress,
    t: string,
    request: Uint8Array,
  ): Promise<HandoffResult<Uint8Array>> => {
    log.push('pull')
    if (t !== phoneToken) return { ok: false, error: 'handoff/refused' }
    const answer = await server.answer(request)
    return answer.status === 200
      ? { ok: true, value: answer.body ?? new Uint8Array(0) }
      : { ok: false, error: 'handoff/refused' }
  }
  const complete = async (response: Uint8Array) => {
    const done = await completePairing(secrets, state, response, Date.now())
    return done.ok ? done.value : null
  }
  return { token, code: groupCode(encodeAddress(PHONE)), fetchPairing, fetchChunk, complete, log, server }
}

describe('receiving from the phone (Q129)', () => {
  it('dials the typed code, checks the proof, pulls, and hands back a plan', async () => {
    const s = await scene()
    const stages: string[] = []
    const run = await pullFromPhone({ ...s, secrets, onStage: (x) => stages.push(x) })
    expect(run).not.toBeNull()
    expect(run?.ok).toBe(true)
    if (!run?.ok) return
    expect(run.plan.nodes).toHaveLength(1)
    // Non-ASCII survived the phone's escaping.
    expect((run.plan.nodes[0]!.props as { note: string }).note).toBe('Zoë — 東京')
    expect(stages).toEqual(['connecting', 'receiving'])
    expect(s.log[0]).toBe('pair token-ok')
    expect(s.server.progress().finished).toBe(true)
  })

  it('refuses a mistyped code before dialling anything', async () => {
    const s = await scene()
    const wrong = s.code.slice(0, 5) + (s.code[5] === 'K' ? 'M' : 'K') + s.code.slice(6)
    const run = await pullFromPhone({ ...s, code: wrong, secrets })
    expect(run).toEqual({ ok: false, problem: DIAL_ADVICE['dial/mistyped'], answered: false })
    expect(s.log).toEqual([])
  })

  it('asks for nothing from a device that cannot prove it read this screen', async () => {
    const s = await scene({ unproven: true })
    const run = await pullFromPhone({ ...s, secrets })
    expect(run).toEqual({ ok: false, problem: UNPROVEN_ADVICE, answered: true })
    expect(s.log).toEqual(['pair token-ok'])
  })

  it("is refused by a phone listening under a different session's token", async () => {
    const s = await scene({ elsewhere: true })
    const run = await pullFromPhone({ ...s, secrets })
    expect(run).toEqual({ ok: false, problem: HANDOFF_ADVICE['handoff/refused'], answered: false })
    expect(s.log).toEqual(['pair TOKEN-WRONG'])
  })

  it('stops on a chunk that did not come from the paired phone', async () => {
    const s = await scene()
    const run = await pullFromPhone({
      ...s,
      secrets,
      fetchChunk: async (a, t, r) => {
        const got = await s.fetchChunk(a, t, r)
        if (got.ok) got.value[0]! ^= 1
        return got
      },
    })
    expect(run).toEqual({ ok: false, problem: PULL_ADVICE['pull/forged'], answered: true })
  })

  it('stops on an answer bigger than any chunk, and changes nothing', async () => {
    const s = await scene()
    const run = await pullFromPhone({
      ...s,
      secrets,
      fetchChunk: async () => ({ ok: true, value: new Uint8Array(70_000) }),
    })
    expect(run).toEqual({ ok: false, problem: PULL_ADVICE['pull/oversized'], answered: true })
  })

  it('says so when what arrived is not a backup', async () => {
    const s = await scene({ serve: () => asciiJsonBytes('{"hello":1}') })
    const run = await pullFromPhone({ ...s, secrets })
    expect(run?.ok).toBe(false)
    if (run === null || run.ok) return
    expect(run.problem).toMatch(/^What your phone sent cannot be restored: .*Nothing on this computer has changed\.$/)
  })

  it('returns nothing to say when the person walks away mid-pull', async () => {
    const s = await scene()
    let asked = 0
    const run = await pullFromPhone({
      ...s,
      secrets,
      fetchChunk: async (a, t, r) => {
        asked += 1
        return s.fetchChunk(a, t, r)
      },
      cancelled: () => asked > 0,
    })
    expect(run).toBeNull()
  })
})

describe('what arrives is read like a backup file', () => {
  it('streams through the same reader, in slices, to the same verdict', () => {
    const bytes = phoneBackup()
    const whole = readPulled(bytes)
    const sliced = readPulled(bytes, 7)
    expect(whole.ok && sliced.ok).toBe(true)
    if (whole.ok && sliced.ok) expect(sliced.value).toEqual(whole.value)
  })

  it('asks the question the backup-file restore asks, with the same consequences', () => {
    const read = readPulled(phoneBackup())
    if (!read.ok) throw new Error('unreadable')
    const copy = pullConfirmCopy(read.value)
    expect(copy.confirm).toBe('Replace everything')
    expect(copy.description).toContain(
      'Restoring replaces every record and every document you have now, and it cannot be undone — the history goes with them. Download a backup first if you are not sure.',
    )
  })

  it('takes one answer to the confirmation, so agreeing is not then declined', () => {
    // `ConfirmDialog` calls onConfirm and then onOpenChange(false).
    const decision = createDecision()
    expect(decision.take()).toBe(true)
    expect(decision.take()).toBe(false)
  })
})

describe('restoring what the phone sent', () => {
  afterEach(() => vi.unstubAllGlobals())

  const META: StoreMeta = {
    schemaVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastOpenedAt: '2026-01-01T00:00:00.000Z',
    dataSet: 'user',
    seededAt: null,
    handoverAt: null,
  }

  const setup = (ok = true) => {
    const map = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
    })
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} })
    const repo = {
      meta: META,
      replaceAll: vi.fn(async () =>
        ok ? { ok: true as const, value: undefined } : { ok: false as const, error: { message: 'full' } },
      ),
      setMeta: vi.fn(),
    }
    const blobs: DocumentStore = { replaceAll: vi.fn(async (d) => d.length) }
    return { map, repo: repo as unknown as Repository & typeof repo, blobs }
  }

  const plan = (): RestorePlan => {
    const read = readPulled(phoneBackup())
    if (!read.ok) throw new Error('unreadable')
    return read.value
  }

  it('runs the one restore, then stamps the handover and the backup mark', async () => {
    const { map, repo, blobs } = setup()
    const at = '2026-11-15T12:00:00.000Z'
    const out = await restoreFromPhone(repo, blobs, plan(), at)
    expect(out.ok).toBe(true)
    expect(repo.replaceAll).toHaveBeenCalledOnce()
    expect(blobs.replaceAll).toHaveBeenCalledOnce()
    expect(repo.setMeta).toHaveBeenCalledWith(expect.objectContaining({ handoverAt: at }))
    // Settings does this after a file restore; without it the reloaded page
    // asks for a backup of records that just arrived from somewhere else.
    expect(map.get('jojo.lastBackupAt')).toBe(at)
  })

  it('stamps nothing when the restore failed', async () => {
    const { map, repo, blobs } = setup(false)
    const out = await restoreFromPhone(repo, blobs, plan(), '2026-11-15T12:00:00.000Z')
    expect(out.ok).toBe(false)
    expect(repo.setMeta).not.toHaveBeenCalled()
    expect(map.has('jojo.lastBackupAt')).toBe(false)
  })
})
