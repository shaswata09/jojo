/**
 * Q096: the companion file server is gone, and so is its build.
 *
 * `docs/NO-SERVER.md` records what it was — a Go server, about 1,580 lines,
 * loopback HTTP on port 7423, with CI cross-compiling five binaries — and why it
 * was deleted once IndexedDB turned out to do the whole job. This pins the
 * absence, against the files the repository actually holds (tracked plus
 * untracked-but-not-ignored, which is what a commit would pick up), so a
 * revival has to delete this test to land.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const git = (...args: string[]) =>
  execFileSync('git', ['ls-files', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean)

/*
 * Less the files deleted from the working tree but not yet from the index: a
 * file moved and not yet staged is still `--cached`, and reading it threw
 * ENOENT — the gate went red over a move, not over a server.
 */
const deleted = new Set(git('--deleted'))
const files = git('--cached', '--others', '--exclude-standard').filter((f) => !deleted.has(f))

/** Comments stripped, so the history told in a comment does not count as code. */
const ci = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8')
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n')

describe('no companion file server (Q096)', () => {
  it('reads a real file list, so the checks below can fail', () => {
    expect(files).toContain('web/src/kg/storage/idb-file-store.ts')
  })

  it('holds no Go source or module anywhere in the repository', () => {
    const go = files.filter((f) => f.endsWith('.go') || /(^|\/)go\.(mod|sum)$/.test(f))
    expect(go).toEqual([])
  })

  it('builds no server binaries in CI', () => {
    expect(ci).not.toMatch(/setup-go|\bGOOS\b|\bGOARCH\b|go build/)
  })

  it('has no app code dialling the server’s loopback port', () => {
    const code = files.filter(
      (f) => /^(web|mobile|service)\//.test(f) && /\.(ts|tsx|mjs)$/.test(f) && !/\.test\./.test(f),
    )
    const dialling = code.filter((f) =>
      /(127\.0\.0\.1|localhost):7423/.test(readFileSync(path.join(ROOT, f), 'utf8')),
    )
    expect(dialling).toEqual([])
  })
})
