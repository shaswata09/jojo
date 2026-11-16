/**
 * Two transfers in a row onto one phone, through the real restore.
 *
 * Transfer audit, 2026-11-16, reproduced: a first push carried the documents,
 * a second sent records only (the default), and the second deleted every
 * document the first had brought — the folder was cleared wholesale and the
 * records lost their uris. `react-native-blob-util` is a map here; everything
 * else is the code the phone runs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildBackup } from '@jojo/service/core/backup'
import { blobPath } from '@jojo/service/core/blob-path'
import { bootInMemory } from '@jojo/service/repo/boot'
import { applyPlan, planReceived } from './restore-received'

const DIR = '/data/user/0/dev.jojo/files'
let disk = new Map<string, string>()

vi.mock('react-native-blob-util', () => ({
  default: {
    fs: {
      dirs: { DocumentDir: '/data/user/0/dev.jojo/files' },
      exists: (path: string) =>
        Promise.resolve(disk.has(path) || [...disk.keys()].some((k) => k.startsWith(`${path}/`))),
      ls: (dir: string) =>
        Promise.resolve(
          [...disk.keys()]
            .filter((k) => k.startsWith(`${dir}/`))
            .map((k) => k.slice(dir.length + 1)),
        ),
      unlink: (path: string) => {
        for (const k of disk.keys()) if (k === path || k.startsWith(`${path}/`)) disk.delete(k)
        return Promise.resolve()
      },
      mkdir: () => Promise.resolve(),
      writeFile: (path: string, data: string) => {
        disk.set(path, data)
        return Promise.resolve(1)
      },
    },
  },
}))

beforeEach(() => {
  disk = new Map()
})

const now = () => '2026-11-16T10:00:00.000Z' as never
const computer = bootInMemory({ now, dataSet: 'demo' })
const files = computer.repo.getSnapshot().ofType('file')

/** What the computer sends: every record, and the documents only when asked. */
function sent(withDocuments: boolean): Uint8Array {
  const snapshot = computer.repo.getSnapshot()
  const backup = buildBackup({
    exportedAt: '2026-11-16T10:00:00.000Z',
    nodes: snapshot.nodes(),
    edges: snapshot.edges(),
    documents: withDocuments
      ? files.map((f, i) => ({
          path: blobPath(f.id, f.props.name),
          data: new Uint8Array([i, 1, 2]),
        }))
      : [],
  })
  return new TextEncoder().encode(JSON.stringify(backup))
}

async function receive(phone: ReturnType<typeof bootInMemory>, withDocuments: boolean) {
  const read = planReceived(sent(withDocuments))
  if (!read.ok) throw new Error(read.message)
  return applyPlan(phone.repo, read.plan, '2026-11-16T10:00:00.000Z', { handover: true })
}

const uris = (phone: ReturnType<typeof bootInMemory>) =>
  phone.repo
    .getSnapshot()
    .ofType('file')
    .map((f) => (f.props as { uri?: string }).uri)
    .filter(Boolean)

describe('a phone that receives twice', () => {
  it('keeps the documents of the first transfer when the second sends records only', async () => {
    const phone = bootInMemory({ now, dataSet: 'empty' })
    expect((await receive(phone, true)).ok).toBe(true)
    expect(disk.size).toBe(files.length)
    expect(uris(phone)).toHaveLength(files.length)

    const second = await receive(phone, false)
    expect(second.ok).toBe(true)
    // Every document still on disk, and every record still pointing at it.
    expect(disk.size).toBe(files.length)
    expect(uris(phone)).toHaveLength(files.length)
    for (const uri of uris(phone)) {
      expect(disk.has(decodeURIComponent(uri!.slice('file://'.length)))).toBe(true)
    }
  })

  it('still replaces documents whose records are gone', async () => {
    const phone = bootInMemory({ now, dataSet: 'empty' })
    await receive(phone, true)
    disk.set(`${DIR}/restored/file:gone__old.pdf`, 'x')
    await receive(phone, false)
    expect(disk.has(`${DIR}/restored/file:gone__old.pdf`)).toBe(false)
  })
})
