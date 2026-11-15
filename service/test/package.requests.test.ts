/**
 * The owner's requests about the manifests: one version, one licence, one shared
 * package that both apps depend on rather than copy.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

type Manifest = { name?: string; version?: string; license?: string; dependencies?: Record<string, string> }
const manifest = (rel: string) => JSON.parse(read(rel)) as Manifest

const PACKAGES = ['package.json', 'web/package.json', 'service/package.json', 'mobile/package.json']

describe('Q143 — every package carries the release version', () => {
  it('gives the root, web, service, mobile and the extension the same version, 0.1.0', () => {
    const versions = Object.fromEntries(
      [...PACKAGES, 'web/extension/manifest.json'].map((rel) => [rel, manifest(rel).version]),
    )
    // A release bump changes this line on purpose; the rest is that they agree.
    for (const [rel, version] of Object.entries(versions)) expect(version, rel).toBe('0.1.0')
  })
})

describe('Q227 — the licence is Apache-2.0', () => {
  it('ships the Apache License 2.0 text as LICENSE', () => {
    const text = read('LICENSE')
    expect(text.trimStart()).toMatch(/^Apache License\s+Version 2\.0, January 2004/)
    expect(text).toContain('TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION')
    expect(text).toContain('7. Disclaimer of Warranty.')
    expect(text).toContain('8. Limitation of Liability.')
  })

  it('declares Apache-2.0 in every package manifest', () => {
    for (const rel of PACKAGES) expect(manifest(rel).license, rel).toBe('Apache-2.0')
  })
})

describe('Q079 — shared code is one package both apps import', () => {
  it('has web and mobile depend on the service workspace rather than carry it', () => {
    const service = manifest('service/package.json').name
    expect(service).toBe('@jojo/service')
    for (const rel of ['web/package.json', 'mobile/package.json']) {
      expect(Object.keys(manifest(rel).dependencies ?? {}), rel).toContain(service)
    }
    expect((JSON.parse(read('package.json')) as { workspaces: string[] }).workspaces).toEqual(
      expect.arrayContaining(['service', 'web', 'mobile']),
    )
  })
})
