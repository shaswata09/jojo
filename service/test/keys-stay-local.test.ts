/**
 * The promise that a model API key never reaches the graph — checked across
 * ALL THREE workspaces.
 *
 * `web/src/lib/keys-stay-local.test.ts` has made this check since it was
 * written and it globs `/src/**` — the web app and nothing else. The layer it
 * most needs to cover is `service/kg`, which is where backup, the tools and the
 * agent live and which BOTH apps import; and `mobile/src` was unscanned
 * entirely. The structure holds in all three today, so this is not a bug
 * report — it is the guard catching up with the claim it makes.
 *
 * Read off disk with `node:fs` rather than `import.meta.glob`, because the glob
 * is a bundler feature scoped to one Vite root and the point here is to leave
 * that root. `test/` is where the vitest config already looks for a harness
 * that touches the filesystem; `check-platform` scans `kg/` and would rightly
 * refuse this file there.
 *
 * ## Why it searches source text
 *
 * The realistic way this breaks is somebody adding "remember my key" as a tool
 * so the agent can set it — at which point the key is a node, and a node is
 * serialised by `core/backup.ts` into a file the user shares and by Transfer
 * onto another device. That mistake has a shape, and the shape is greppable.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Every TypeScript source in the three workspaces, excluding this file. */
function sources(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = []
  const skip = new Set(['node_modules', 'dist', 'build', 'ios', 'android', '.git'])

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue
      const full = path.join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.tsx?$/.test(entry)) continue
      // This file names the very patterns it forbids.
      if (full.endsWith('keys-stay-local.test.ts')) continue
      out.push({ path: path.relative(ROOT, full), text: readFileSync(full, 'utf8') })
    }
  }

  for (const workspace of ['service/kg', 'service/data', 'web/src', 'mobile/src']) {
    walk(path.join(ROOT, workspace))
  }
  return out
}

const FILES = sources()

describe('a key never reaches the graph, in any workspace', () => {
  it('scans all three, so the guard covers what the promise covers', () => {
    // Guards the guard: a walk that found nothing would make every assertion
    // below vacuously true, which is exactly how this kind of test rots.
    expect(FILES.length).toBeGreaterThan(300)
    for (const workspace of ['service/kg', 'web/src', 'mobile/src']) {
      expect(
        FILES.some((f) => f.path.startsWith(workspace)),
        `nothing scanned under ${workspace}`,
      ).toBe(true)
    }
  })

  it('is never written into a node, an edge or a tool call', () => {
    const offenders: string[] = []
    for (const { path: at, text } of FILES) {
      if (/props:\s*\{[^}]*apiKey/.test(text)) offenders.push(`${at} — apiKey in node props`)
      if (/ctx\.call\([^)]*apiKey/.test(text)) offenders.push(`${at} — apiKey passed to a tool`)
      if (/tx\.put\([^)]*apiKey/.test(text)) offenders.push(`${at} — apiKey written to the store`)
    }
    expect(
      offenders,
      `A key must not reach the graph: backups serialise it and Transfer sends it.\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('is only ever sent as a header, never in a request body', () => {
    // `api_key` in a JSON body is how some SDKs do it, and is how a key ends up
    // in a request log somebody later pastes into an issue.
    const offenders = FILES.filter(({ text }) => /JSON\.stringify\([^)]*api_key/.test(text)).map(
      (f) => f.path,
    )
    expect(offenders).toEqual([])
  })

  it('is not part of anything the backup serialises', () => {
    /*
     * The structural half. `core/backup.ts` writes every node, so the promise
     * holds only while no node type is credential-shaped — which is also why
     * the background node type is called `background` and not `credential`.
     */
    const backup = FILES.find((f) => f.path === path.join('service', 'kg', 'core', 'backup.ts'))
    expect(backup, 'backup.ts was not scanned').toBeDefined()
    expect(/apiKey|api_key/.test(backup?.text ?? '')).toBe(false)
  })
})
