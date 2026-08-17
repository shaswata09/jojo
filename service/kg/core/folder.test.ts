/**
 * The folder's rules, which under D20 are the only part of this feature a test
 * can reach.
 *
 * No test in this codebase mounts a component, so everything the folder feature
 * decides was pushed down into `core/folder.ts` specifically so it could be
 * pinned here. That makes this suite deliberately larger than the module's size
 * suggests: it is carrying the coverage the hook above it can never have.
 */

import { describe, expect, it } from 'vitest'
import {
  classifyFile,
  documentPath,
  pairFolder,
  planRebuild,
  sanitiseFileName,
  utf8Length,
  type FolderEntry,
} from './folder'

const entry = (path: string, bytes = 100, mtime = 1_000): FolderEntry => ({ path, bytes, mtime })

describe('sanitiseFileName', () => {
  /**
   * The property the whole flat-readable layout exists for. A first draft of the
   * character class read `[/\\:*?"<>| -]`, whose trailing ` -` is two more
   * literals, and it stripped every space in the name.
   */
  it('keeps what makes a name readable', () => {
    expect(sanitiseFileName('CV Rice Oct 2026.pdf')).toBe('CV Rice Oct 2026.pdf')
    expect(sanitiseFileName('Résumé (final) - v2.pdf')).toBe('Résumé (final) - v2.pdf')
    expect(sanitiseFileName('提出書類.pdf')).toBe('提出書類.pdf')
  })

  it('removes only what a filesystem or a path parser would choke on', () => {
    expect(sanitiseFileName('a/b\\c:d*e?f"g<h>i|j.pdf')).toBe('abcdefghij.pdf')
    expect(sanitiseFileName('tab\there.pdf')).toBe('tabhere.pdf')
    expect(sanitiseFileName('null\u0000byte.pdf')).toBe('nullbyte.pdf')
  })

  // A leading dot hides the file on POSIX, which is not what a user dropping a
  // CV meant to do.
  it('refuses to mint a hidden file', () => {
    expect(sanitiseFileName('...CV.pdf')).toBe('CV.pdf')
  })

  it('never returns an empty name', () => {
    expect(sanitiseFileName('')).toBe('Untitled')
    expect(sanitiseFileName('///')).toBe('Untitled')
    expect(sanitiseFileName('   ')).toBe('Untitled')
  })

  /** Reserved on Windows regardless of extension, and folders get synced. */
  it('sidesteps the Windows device names', () => {
    expect(sanitiseFileName('CON.pdf')).toBe('CON_.pdf')
    expect(sanitiseFileName('nul.txt')).toBe('nul_.txt')
    expect(sanitiseFileName('console.pdf')).toBe('console.pdf')
  })

  // Legal on POSIX, silently stripped by Windows — one file, two names that
  // disagree about which it is.
  it('drops a trailing dot or space', () => {
    expect(sanitiseFileName('report.')).toBe('report')
    expect(sanitiseFileName('report .pdf')).toBe('report.pdf')
  })

  describe('truncation', () => {
    it('measures bytes, not characters', () => {
      // 100 CJK characters is 300 UTF-8 bytes: a character-counted limit passes
      // every English test and then fails on the first Japanese filename.
      const long = '書'.repeat(100) + '.pdf'
      const out = sanitiseFileName(long)
      expect(utf8Length(out)).toBeLessThanOrEqual(200)
      expect(out.endsWith('.pdf')).toBe(true)
    })

    it('keeps the extension, which is what picks the icon', () => {
      const out = sanitiseFileName('a'.repeat(400) + '.pdf')
      expect(out.endsWith('.pdf')).toBe(true)
      expect(utf8Length(out)).toBeLessThanOrEqual(200)
    })

    it('never splits a surrogate pair', () => {
      const out = sanitiseFileName('😀'.repeat(80) + '.pdf')
      // A lone surrogate is unpaired; encoding it yields U+FFFD.
      expect(out).not.toMatch(/�/)
      expect([...out].every((ch) => (ch.codePointAt(0) ?? 0) !== 0xfffd)).toBe(true)
    })

    it('treats a leading dot as part of the name, not an extension', () => {
      expect(sanitiseFileName('.gitignore')).toBe('gitignore')
    })

    it('splits on the last dot', () => {
      expect(sanitiseFileName('CV.final.pdf')).toBe('CV.final.pdf')
    })
  })
})

describe('documentPath', () => {
  it('files into Documents/', () => {
    expect(documentPath('CV.pdf', new Set())).toBe('Documents/CV.pdf')
  })

  // Before the extension, the way every desktop file manager does it: a folder
  // of `CV.pdf (2)` no longer opens in a PDF viewer on double-click.
  it('suffixes before the extension on collision', () => {
    const taken = new Set(['Documents/CV.pdf'])
    expect(documentPath('CV.pdf', taken)).toBe('Documents/CV (2).pdf')
  })

  it('keeps counting past the first collision', () => {
    const taken = new Set(['Documents/CV.pdf', 'Documents/CV (2).pdf', 'Documents/CV (3).pdf'])
    expect(documentPath('CV.pdf', taken)).toBe('Documents/CV (4).pdf')
  })

  it('sanitises before it probes, so the probe matches what will be written', () => {
    const taken = new Set(['Documents/ab.pdf'])
    expect(documentPath('a/b.pdf', taken)).toBe('Documents/ab (2).pdf')
  })

  it('gives up rather than looping forever inside a cross-tab write lock', () => {
    const taken = new Set(['Documents/CV.pdf'])
    for (let n = 2; n <= 1000; n += 1) taken.add(`Documents/CV (${n}).pdf`)
    expect(() => documentPath('CV.pdf', taken)).toThrow(/1000 attempts/)
  })
})

describe('classifyFile', () => {
  const linked = { path: 'Documents/CV.pdf', bytes: 100, mtime: 1_000, hash: 'sha256:abc' }

  it('is stored when the folder confirms it', () => {
    expect(classifyFile(linked, entry('Documents/CV.pdf'), { connected: true })).toBe('stored')
  })

  /**
   * The distinction the whole type exists to protect. `undefined` means the
   * folder was listed and this path was not in it; `null` means nobody has
   * looked. Collapsing them tells a user their CV is gone when jojo simply has
   * not checked — a true-sounding lie, which is the worst kind.
   */
  it('separates "not there" from "not checked"', () => {
    expect(classifyFile(linked, undefined, { connected: true })).toBe('missing')
    expect(classifyFile(linked, null, { connected: true })).toBe('unknown')
    expect(classifyFile(linked, undefined, { connected: false })).toBe('unknown')
  })

  it('reports a size or time disagreement as changed', () => {
    expect(classifyFile(linked, entry('Documents/CV.pdf', 999), { connected: true })).toBe(
      'changed',
    )
    expect(classifyFile(linked, entry('Documents/CV.pdf', 100, 2_000), { connected: true })).toBe(
      'changed',
    )
  })

  /**
   * Every record that predates the folder, which on upgrade day is all of them.
   * Checked before connectedness on purpose — a record with no path is complete
   * and correct whether or not a folder exists, and marking it `unknown` would
   * put a "not checked" affordance on every row of a store that has no bytes.
   */
  it('calls a record with no path record-only, folder or not', () => {
    expect(classifyFile({}, null, { connected: false })).toBe('record-only')
    expect(classifyFile({}, null, { connected: true })).toBe('record-only')
  })

  it('lets pending and failed win over everything', () => {
    expect(classifyFile({}, null, { connected: true, pending: true })).toBe('pending')
    expect(classifyFile({}, null, { connected: true, failed: true })).toBe('failed')
  })

  // A legacy record has a path but no bytes/mtime to compare against; it must
  // read as stored rather than as changed against nothing.
  it('does not invent drift when there is nothing to compare', () => {
    expect(
      classifyFile({ path: 'Documents/CV.pdf' }, entry('Documents/CV.pdf'), {
        connected: true,
      }),
    ).toBe('stored')
  })
})

describe('pairFolder', () => {
  const hashes: Record<string, string> = {
    'Documents/CV_old.pdf': 'sha256:abc',
    'Documents/Random.pdf': 'sha256:zzz',
  }
  const hashOf = (p: string) => hashes[p]

  it('offers a relink only on hash equality', () => {
    const records = [{ id: 'f1', link: { path: 'Documents/CV.pdf', hash: 'sha256:abc' } }]
    const out = pairFolder(records, [entry('Documents/CV_old.pdf')], hashOf)
    expect(out.relinks).toEqual([{ nodeId: 'f1', candidatePath: 'Documents/CV_old.pdf' }])
    expect(out.orphans).toEqual([])
  })

  /**
   * The case filename matching gets wrong, and it is the common one: a user
   * renames `CV.pdf` to `CV_old.pdf` and saves a new `CV.pdf`. Matching by name
   * silently attaches this month's CV to last month's record.
   */
  it('does not relink on a name match when the bytes differ', () => {
    const records = [{ id: 'f1', link: { path: 'Documents/CV.pdf', hash: 'sha256:different' } }]
    const out = pairFolder(records, [entry('Documents/CV_old.pdf')], hashOf)
    expect(out.relinks).toEqual([])
    expect(out.orphans.map((e) => e.path)).toEqual(['Documents/CV_old.pdf'])
  })

  it('cannot relink a record that never had a hash', () => {
    const records = [{ id: 'f1', link: { path: 'Documents/CV.pdf' } }]
    const out = pairFolder(records, [entry('Documents/CV_old.pdf')], hashOf)
    expect(out.relinks).toEqual([])
  })

  it('never hands one candidate to two records', () => {
    const records = [
      { id: 'f1', link: { path: 'Documents/A.pdf', hash: 'sha256:abc' } },
      { id: 'f2', link: { path: 'Documents/B.pdf', hash: 'sha256:abc' } },
    ]
    const out = pairFolder(records, [entry('Documents/CV_old.pdf')], hashOf)
    expect(out.relinks).toHaveLength(1)
    expect(out.orphans).toEqual([])
  })

  it('leaves a file a record already points at alone', () => {
    const records = [{ id: 'f1', link: { path: 'Documents/CV.pdf', hash: 'sha256:abc' } }]
    const out = pairFolder(records, [entry('Documents/CV.pdf')], hashOf)
    expect(out.orphans).toEqual([])
    expect(out.relinks).toEqual([])
  })

  // jojo's own files are not documents the user forgot to file.
  it('ignores anything outside Documents/', () => {
    const out = pairFolder([], [entry('jojo/graph.json'), entry('Documents/Random.pdf')], hashOf)
    expect(out.orphans.map((e) => e.path)).toEqual(['Documents/Random.pdf'])
  })
})

describe('planRebuild', () => {
  it('recovers a record per document', () => {
    const out = planRebuild([entry('Documents/CV.pdf', 500, 42)])
    expect(out).toEqual([{ name: 'CV.pdf', path: 'Documents/CV.pdf', bytes: 500, mtime: 42 }])
  })

  /**
   * Chrome never reaps a `.crswap` orphaned by a hard kill, and it appears in
   * `entries()`. Rebuilding one into a record would hand the user a document
   * that is a half-written copy of another one.
   */
  it('skips Chrome write-swap leftovers', () => {
    expect(planRebuild([entry('Documents/CV.pdf.crswap')])).toEqual([])
  })

  it('ignores jojo/ and the folder root', () => {
    expect(planRebuild([entry('jojo/graph.json'), entry('Read me.txt')])).toEqual([])
  })

  it('sorts without Intl, so web and Hermes agree', () => {
    const out = planRebuild([entry('Documents/b.pdf'), entry('Documents/a.pdf')])
    expect(out.map((f) => f.name)).toEqual(['a.pdf', 'b.pdf'])
  })
})
