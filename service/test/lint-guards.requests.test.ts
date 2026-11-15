/**
 * The owner's architecture requests, held by the guard scripts `npm run lint`
 * runs — and run here too, so a regression is a named failing test as well as a
 * red lint step.
 *
 * Each script is run as a child process, as lint runs it: they walk the tree at
 * import time and `process.exit(1)` on a finding, so importing one into the test
 * worker would end the worker rather than fail a test.
 *
 *  - Q066 a platform-independent service layer: `check-platform.mjs` (no DOM, no
 *    React Native, no Node built-ins, no wall clock in kg/ and data/).
 *  - Q079 shared code lives once, in service/: `check-no-copies.mjs`.
 *  - Q076 modular code: `check-layers.mjs`, whose import-direction rule and
 *    value-import cycle check are the structure the split relies on.
 *  - Q136 the lint findings the owner named stay cleared: no unused identifier
 *    in any workspace, no warning of any kind under each workspace's own
 *    config, and unneeded spreads reported because every config turns the rule
 *    that finds them on. They had come back unseen once already: the configs
 *    left out the unicorn plugin, so `unicorn/no-useless-spread` never ran.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SERVICE = path.join(ROOT, 'service')

function guard(script: string): { status: number | null; output: string } {
  const run = spawnSync(process.execPath, [path.join(SERVICE, 'scripts', script)], {
    cwd: SERVICE,
    encoding: 'utf8',
  })
  return { status: run.status, output: `${run.stdout}${run.stderr}` }
}

describe('the guard scripts lint runs', () => {
  it('Q066: keeps the service layer free of web, React Native and Node APIs', () => {
    const { status, output } = guard('check-platform.mjs')
    expect(status, output).toBe(0)
  }, 60_000)

  it('Q079: finds one copy of the service layer, reached only through its exports', () => {
    const { status, output } = guard('check-no-copies.mjs')
    expect(status, output).toBe(0)
  }, 60_000)

  it('Q076: keeps imports one-directional across layers and free of value cycles', () => {
    const { status, output } = guard('check-layers.mjs')
    expect(status, output).toBe(0)
  }, 60_000)
})

/** The directories each workspace's `lint` script hands to oxlint. */
const LINTED: Record<string, string[]> = {
  service: ['kg', 'data'],
  web: ['src', 'extension'],
  mobile: ['src'],
}

describe('Q136: the lint warnings that were asked to be cleared', () => {
  it('finds no unused identifier in any workspace', () => {
    const oxlint = path.join(ROOT, 'node_modules', '.bin', 'oxlint')
    const found: string[] = []
    for (const [workspace, dirs] of Object.entries(LINTED)) {
      // Only these rules, by name, under each workspace's own config.
      const run = spawnSync(
        oxlint,
        [
          '-A',
          'all',
          '-D',
          'no-unused-vars',
          '-D',
          'typescript/no-unused-vars',
          '-f',
          'json',
          ...dirs,
        ],
        { cwd: path.join(ROOT, workspace), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
      )
      const report = JSON.parse(run.stdout) as {
        diagnostics: { code: string; filename: string; labels?: { span: { line: number } }[] }[]
        number_of_files: number
      }
      expect(report.number_of_files, workspace).toBeGreaterThan(50)
      for (const d of report.diagnostics)
        found.push(`${workspace}/${d.filename}:${String(d.labels?.[0]?.span.line)} ${d.code}`)
    }
    expect(found).toEqual([])
  }, 60_000)

  it('finds no warning or error under each workspace’s own lint config', () => {
    // A warning prints and passes unless the lint script denies it, so the
    // count is asserted here rather than read off a log.
    const oxlint = path.join(ROOT, 'node_modules', '.bin', 'oxlint')
    const found: string[] = []
    for (const [workspace, dirs] of Object.entries(LINTED)) {
      const run = spawnSync(oxlint, ['--config', '.oxlintrc.json', '-f', 'json', ...dirs], {
        cwd: path.join(ROOT, workspace),
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      })
      const report = JSON.parse(run.stdout) as {
        diagnostics: { code: string; filename: string; labels?: { span: { line: number } }[] }[]
        number_of_files: number
      }
      expect(report.number_of_files, workspace).toBeGreaterThan(50)
      for (const d of report.diagnostics)
        found.push(`${workspace}/${d.filename}:${String(d.labels?.[0]?.span.line)} ${d.code}`)
    }
    expect(found).toEqual([])
  }, 60_000)

  it('turns unicorn/no-useless-spread on in every workspace’s lint config', () => {
    // Both halves are needed: oxlint ignores a rule whose plugin is not listed,
    // which is how the rule sat unrun before.
    for (const workspace of Object.keys(LINTED)) {
      const config = JSON.parse(
        readFileSync(path.join(ROOT, workspace, '.oxlintrc.json'), 'utf8'),
      ) as {
        plugins?: string[]
        rules?: Record<string, unknown>
      }
      expect(config.plugins, workspace).toContain('unicorn')
      expect(config.rules?.['unicorn/no-useless-spread'], workspace).toBe('error')
    }
  })

  it('fails each workspace’s lint on a warning, not only on an error', () => {
    for (const workspace of Object.keys(LINTED)) {
      const pkg = JSON.parse(readFileSync(path.join(ROOT, workspace, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>
      }
      expect(pkg.scripts['lint'], workspace).toMatch(
        /oxlint --config \.oxlintrc\.json --deny-warnings /,
      )
    }
  })
})
