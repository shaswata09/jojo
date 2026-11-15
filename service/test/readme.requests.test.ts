/**
 * The owner's requests about the READMEs and the docs check, pinned.
 *
 * Prose cannot be tested for being good, and nothing here tries. What can be
 * tested is the part a reader acts on: the README still has the layout and the
 * run instructions it was asked for, every `npm run …` a README tells somebody to
 * type is a script that exists in the package it names, and the docs check that
 * CI runs passes on a checkout that has only the committed files — which is the
 * situation it failed in (Q210) while passing on every machine that had
 * gitignored files lying around.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

/** A `## heading` section of a Markdown file, up to the next heading of the same depth. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}\n`)
  if (start < 0) return ''
  const next = text.indexOf('\n## ', start + 4)
  return text.slice(start, next < 0 ? undefined : next)
}

describe('Q002 — the root README: code structure and how to run it', () => {
  const readme = read('README.md')

  it('lays out the three workspaces, and names the extension and the bridge', () => {
    const layout = section(readme, 'Repository layout')
    for (const dir of ['service/', 'web/', 'mobile/']) expect(layout, dir).toMatch(new RegExp(`^[├└]── ${dir}`, 'm'))
    expect(readme).toContain('`web/extension/')
    expect(readme).toContain('jojo-bridge.mjs')
  })

  it('says how to run the web app and the mobile app', () => {
    expect(section(readme, 'Running the web app')).toContain('npm run dev -w web')
    expect(section(readme, 'Running the mobile app')).toContain('./gradlew assembleRelease')
  })
})

/*
 * Which scripts a bare `npm run x` in a README can mean. A workspace's README is
 * read from inside that workspace; the root README covers the root scripts and
 * has a section per app.
 */
const WORKSPACE_DIR: Record<string, string> = { web: 'web', 'jojo-mobile': 'mobile', '@jojo/service': 'service' }
const scripts = (dir: string): Set<string> =>
  new Set(Object.keys((JSON.parse(read(`${dir}/package.json`)) as { scripts?: object }).scripts ?? {}))

const READMES: { file: string; bare: string[] }[] = [
  { file: 'README.md', bare: ['.', 'web', 'mobile'] },
  { file: 'CONTRIBUTING.md', bare: ['.'] },
  { file: 'mobile/README.md', bare: ['mobile'] },
  { file: 'service/README.md', bare: ['service'] },
  { file: 'service/bench/README.md', bare: ['service'] },
  { file: 'web/extension/README.md', bare: ['web'] },
]

/** Every `npm run x`, with the workspace it names (either side of `run`) or null. */
function npmRuns(text: string): { script: string; workspace: string | null }[] {
  const re = /npm(?:\s+-w\s+(\S+))?\s+run\s+([a-z][\w:-]*)(?:\s+-w\s+(\S+))?/g
  return [...text.matchAll(re)].map((m) => ({ script: m[2] ?? '', workspace: m[1] ?? m[3] ?? null }))
}

describe('Q144 — each README’s commands are the current ones', () => {
  it('names only npm scripts that exist, in every README', () => {
    const missing: string[] = []
    let seen = 0
    for (const { file, bare } of READMES) {
      for (const { script, workspace } of npmRuns(read(file))) {
        seen++
        const dirs = workspace ? [WORKSPACE_DIR[workspace] ?? `unknown workspace ${workspace}`] : bare
        const ok = dirs.some((dir) => existsSync(path.join(ROOT, dir, 'package.json')) && scripts(dir).has(script))
        if (!ok) missing.push(`${file}: npm run ${script}${workspace ? ` -w ${workspace}` : ''}`)
      }
    }
    expect(seen).toBeGreaterThan(20)
    expect(missing).toEqual([])
  })

  it('reads the npm-run pattern on both sides of the workspace flag', () => {
    expect(npmRuns('npm run dev -w web')).toEqual([{ script: 'dev', workspace: 'web' }])
    expect(npmRuns('npm -w @jojo/service run test:coverage')).toEqual([
      { script: 'test:coverage', workspace: '@jojo/service' },
    ])
    expect(npmRuns('npm run gate')).toEqual([{ script: 'gate', workspace: null }])
  })
})

describe('Q158 — jojo is described as agentic, not only a tracker', () => {
  it('says so in the README’s opening line, the root manifest and the guide', () => {
    expect(read('README.md')).toMatch(/^\*\*J\*\*arvis .* — an agentic assistant that tracks/m)
    expect((JSON.parse(read('package.json')) as { description: string }).description).toMatch(/^Agentic /)
    expect(read('web/src/components/guide/overview/Ladder.tsx')).toMatch(/The agentic half: a threaded assistant/)
  })
})

/*
 * Q210. `check-docs.mjs` asks `existsSync`, and on a developer's machine a
 * gitignored file (a build output, a Firebase config) exists — so the check
 * passed locally and failed in CI, on a fresh checkout. This runs the same script
 * against a copy of the tree that holds only what git would check out: tracked
 * files, plus untracked ones that are not ignored (they are about to be
 * committed). Document sources keep their text; every other file is an empty
 * placeholder, because the script only asks whether a path exists.
 *
 * CI runs the check after `npm ci`, so the installed `node_modules` folders are
 * linked in as they are here: what is being modelled is a checkout, not a
 * checkout nobody has installed.
 */
describe('Q210 — the docs check passes on a clean checkout', () => {
  it('names no path that only exists because a file is gitignored', () => {
    const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\0')
      .filter((f) => f && existsSync(path.join(ROOT, f)) && statSync(path.join(ROOT, f)).isFile())
    expect(listed).toContain('service/scripts/check-docs.mjs')

    const keepText = (f: string) =>
      f.endsWith('.md') || f.startsWith('web/src/components/guide/') || f === 'service/scripts/check-docs.mjs'
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'jojo-docs-'))
    try {
      for (const f of listed) {
        const to = path.join(tmp, f)
        mkdirSync(path.dirname(to), { recursive: true })
        writeFileSync(to, keepText(f) ? readFileSync(path.join(ROOT, f)) : '')
      }
      for (const ws of ['.', 'service', 'web', 'mobile']) {
        const modules = path.join(ROOT, ws, 'node_modules')
        if (existsSync(modules)) symlinkSync(modules, path.join(tmp, ws, 'node_modules'), 'dir')
      }
      const run = spawnSync(process.execPath, [path.join(tmp, 'service/scripts/check-docs.mjs')], { encoding: 'utf8' })
      expect(run.status, `${run.stdout}${run.stderr}`).toBe(0)
      expect(run.stdout).toContain('resolves')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }, 30_000)
})
