/**
 * A backup file or a pasted backup, becoming a question the phone can ask.
 *
 * The backups here are built by `core/backup.ts`'s own `buildBackup`, the
 * writer the web app and the phone's Export both use, so a format change on
 * either side reaches these assertions. They go in the way a picked file does —
 * UTF-8 bytes, then base64, which is what `fs.readFile(path, 'base64')` returns.
 */

import { describe, expect, it } from 'vitest'
import { blobPath } from '@jojo/service/core/blob-path'
import { buildBackup, describeBackup, toBase64 } from '@jojo/service/core/backup'
import type { Instant } from '@jojo/service/core/model'
import { seedToGraph } from '@jojo/service/repo/seed'
import {
  importOutcomeToast,
  pathOfUri,
  pickFailure,
  planImport,
  planImportBase64,
  stripBom,
} from './import-backup'

/**
 * The shipped demo store, so every row is one the validator accepts — a backup
 * of made-up rows plans fine and then reports them all as unreadable.
 */
const SEED = seedToGraph('2026-11-16T09:00:00.000Z' as Instant)
const FILE = SEED.nodes.find((n) => n.type === 'file')!
/** A PDF header, a 0xff and a NUL: bytes a text round trip would mangle. */
const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xff, 0x00])

const backupText = (empty = false) =>
  JSON.stringify(
    buildBackup({
      exportedAt: '2026-11-16T09:00:00.000Z',
      nodes: empty ? [] : SEED.nodes,
      edges: empty ? [] : SEED.edges,
      documents: empty ? [] : [{ path: blobPath(FILE.id, 'CV.pdf'), data: PDF }],
      readable: { jojo: 3, applications: [{ org: 'Rice — ünïcödé' }] },
    }),
    null,
    2,
  )

/** A string as the file a picker would hand over: UTF-8, then base64. */
const asPickedFile = (text: string) => toBase64(new TextEncoder().encode(text))

describe('importing a backup file', () => {
  it('turns a real backup into the plan the confirmation describes', () => {
    const planned = planImportBase64(asPickedFile(backupText()))

    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.plan.nodes.map((n) => n.id)).toEqual(SEED.nodes.map((n) => n.id))
    expect(planned.plan.edges).toHaveLength(SEED.edges.length)
    expect(planned.plan.exportedAt).toBe('2026-11-16T09:00:00.000Z')
    // The document's bytes survive two encodings, the 0xff and the NUL included.
    expect([...planned.plan.documents[0]!.data]).toEqual([...PDF])
    // Whole: no salvage clause, so the confirmation promises every row.
    expect(describeBackup(planned.plan)).toBe(
      `${SEED.nodes.length} records, ${SEED.edges.length} links, 1 document`,
    )
  })

  /**
   * The audit's case: a note app saved the pasted export with a byte-order
   * mark, `decodeUtf8` kept it, and `JSON.parse` refused the file on its first
   * character.
   */
  it('reads a backup saved with a UTF-8 byte-order mark', () => {
    const withBom = Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(backupText())])

    const planned = planImportBase64(toBase64(withBom))

    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.plan.nodes).toHaveLength(SEED.nodes.length)
  })

  it('says a file that is not a backup is not one, and that nothing changed', () => {
    const planned = planImportBase64(asPickedFile('Shopping: eggs, milk, {bread'))

    expect(planned).toEqual({
      ok: false,
      message:
        'That file cannot be restored: it is not a jojo backup. Nothing on this phone has changed.',
    })
  })

  it("passes on the reader's reason for JSON that is not a backup", () => {
    const planned = planImportBase64(asPickedFile('{"jojo":3,"applications":[]}'))

    expect(planned.ok).toBe(false)
    if (planned.ok) return
    expect(planned.message).toContain('older export')
    expect(planned.message).toContain('Nothing on this phone has changed.')
  })

  /**
   * Refused before the sheet rather than after it. `restoreBackup` would refuse
   * too, but only once "Replace everything on this phone?" had been asked and
   * answered yes.
   */
  it('refuses a backup with no records before anybody is asked to replace anything', () => {
    const planned = planImportBase64(asPickedFile(backupText(true)))

    expect(planned.ok).toBe(false)
    if (planned.ok) return
    expect(planned.message).toContain('no records')
    expect(planned.message).toContain('Nothing on this phone has changed')
  })

  it('refuses bytes that are not base64 and an empty file', () => {
    expect(planImportBase64('not base64!').ok).toBe(false)
    expect(planImportBase64('')).toEqual({
      ok: false,
      message: 'That file is empty. Nothing on this phone has changed.',
    })
  })
})

describe('pasting a backup', () => {
  it("reads the phone's own export back, byte-order mark or not", () => {
    expect(planImport(backupText(), 'clipboard').ok).toBe(true)
    expect(planImport(`﻿${backupText()}`, 'clipboard').ok).toBe(true)
  })

  it('names the clipboard, not a file, when it is wrong', () => {
    expect(planImport('', 'clipboard')).toEqual({
      ok: false,
      message: 'The clipboard is empty. Copy a jojo backup first, then paste it here.',
    })
    const garbage = planImport('https://example.com/job/42', 'clipboard')
    expect(garbage.ok).toBe(false)
    if (garbage.ok) return
    expect(garbage.message).toMatch(/^What is on the clipboard cannot be restored/)
  })
})

describe('stripBom', () => {
  it('drops one leading mark and nothing else', () => {
    expect(stripBom('﻿{}')).toBe('{}')
    expect(stripBom('{}')).toBe('{}')
    expect(stripBom('{"a":"﻿"}')).toBe('{"a":"﻿"}')
  })
})

describe('which picker failures are shown', () => {
  const coded = (code: string) => Object.assign(new Error(code), { code })

  it('says nothing when the person cancelled or tapped twice', () => {
    expect(pickFailure(coded('OPERATION_CANCELED'))).toBeNull()
    expect(pickFailure(coded('ASYNC_OP_IN_PROGRESS'))).toBeNull()
    // The iOS new-architecture shape: a plain object with a code, not an Error.
    expect(pickFailure({ code: 'OPERATION_CANCELED', message: 'cancelled' })).toBeNull()
  })

  it('names a real failure', () => {
    expect(pickFailure(coded('UNABLE_TO_OPEN_FILE_TYPE'))).toBe(
      'This phone has nothing that can pick a JSON or text file.',
    )
    expect(pickFailure(new Error('Permission Denial'))).toBe(
      'The file could not be opened: Permission Denial',
    )
  })
})

describe('the outcome', () => {
  it('counts records, documents and what was skipped', () => {
    expect(
      importOutcomeToast({ ok: true, nodes: 92, edges: 115, documents: 3, skipped: 2 }),
    ).toEqual({
      title: 'Backup restored',
      description: '92 records are on this phone, 3 documents. 2 could not be read.',
    })
    expect(importOutcomeToast({ ok: true, nodes: 1, edges: 0, documents: 0, skipped: 0 })).toEqual({
      title: 'Backup restored',
      description: '1 record is on this phone.',
    })
  })

  it('passes a refused restore through as a danger toast', () => {
    expect(importOutcomeToast({ ok: false, message: 'disk full' })).toEqual({
      title: 'Nothing was imported',
      description: 'disk full',
      tone: 'danger',
    })
  })
})

describe('pathOfUri', () => {
  it('decodes the percent-encoded file uri keepLocalCopy returns', () => {
    expect(pathOfUri('file:///data/user/0/dev.jojo/cache/x/My%20Backup.json')).toBe(
      '/data/user/0/dev.jojo/cache/x/My Backup.json',
    )
    expect(pathOfUri('/already/a/path.json')).toBe('/already/a/path.json')
  })
})
