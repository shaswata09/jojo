import { describe, expect, it } from 'vitest'
import { VAULT_DEFAULTS } from '@/lib/links'
import appSource from './App.tsx?raw'

/**
 * Q046: the Reminders page became the Vault, and an old link still lands.
 *
 * Read as source because D20 rules out mounting `<App />`. The redirect is the
 * whole of the promise to a bookmark, and nothing else in the suite reads the
 * route table, so deleting it would fail nothing.
 */

/** Comments stripped, so prose describing a route cannot stand in for one. */
const code = appSource.replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')

describe('the reminders page, now the Vault (Q046)', () => {
  it('routes /vault to the Vault page', () => {
    expect(code).toMatch(/<Route\s+path="vault"\s+element=\{<Vault\s*\/>\}/)
  })

  it('redirects /reminders to /vault, replacing the history entry', () => {
    expect(code).toMatch(
      /<Route\s+path="reminders"\s+element=\{<Navigate\s+to="\/vault"\s+replace\s*\/>\}/,
    )
  })

  it('lands a redirected bookmark on the reminders tool', () => {
    // `/vault` with no `tool` opens the default tab, so the redirect above only
    // keeps its promise while that default is still reminders.
    expect(VAULT_DEFAULTS.tool).toBe('reminders')
  })
})
