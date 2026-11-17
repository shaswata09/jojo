/**
 * Going to a tab from a stack screen, and opening a link on a cold start
 * (review 2, mobile-1 and mobile-2).
 *
 * Both are run against React Navigation's own router and path parser, the
 * versions this app ships, rather than against a description of them: the bug
 * in mobile-1 was a change of router semantics between major versions, which
 * only the router can show.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CommonActions, StackActions, StackRouter } from '@react-navigation/routers'
import { getStateFromPath } from '@react-navigation/core'
import { tabAction } from '@/navigation/to-tab'
import { linking } from '@/navigation/linking'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

function sources(dir: string): [string, string][] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sources(full)
    return /\.tsx?$/.test(name) && !name.includes('.test.')
      ? [[path.relative(ROOT, full), readFileSync(full, 'utf8')] as [string, string]]
      : []
  })
}

const NAMES = ['Tabs', 'Search', 'Settings', 'ApplicationDetail', 'Graph']
const OPTS = { routeNames: NAMES, routeParamList: {}, routeGetIdList: {} }
const router = StackRouter({})
// The router's action and state types are wider than this test needs.
type S = ReturnType<typeof router.getInitialState>
const step = (state: S, action: unknown): S =>
  router.getStateForAction(state, action as never, OPTS as never) as S
const names = (state: S) => state.routes.map((r) => r.name).join(' > ')

describe('going to a tab from a stack screen (mobile-1)', () => {
  it('builds the same action as StackActions.popTo', () => {
    expect(tabAction('Vault', { tool: 'links' })).toEqual(
      JSON.parse(
        JSON.stringify(StackActions.popTo('Tabs', { screen: 'Vault', params: { tool: 'links' } })),
      ),
    )
    expect(tabAction('Applications')).toEqual(
      JSON.parse(JSON.stringify(StackActions.popTo('Tabs', { screen: 'Applications' }))),
    )
  })

  it('returns to the one tab navigator instead of stacking another', () => {
    let state = router.getInitialState(OPTS as never) as S
    for (let k = 0; k < 3; k++) {
      state = step(state, CommonActions.navigate('Search'))
      state = step(state, tabAction('Vault', { tool: 'links' }))
    }
    expect(names(state)).toBe('Tabs')
    expect(state.routes[0].params).toEqual({ screen: 'Vault', params: { tool: 'links' } })
  })

  it('is what plain navigate got wrong, so the test can tell them apart', () => {
    let state = router.getInitialState(OPTS as never) as S
    state = step(state, CommonActions.navigate('Search'))
    state = step(state, CommonActions.navigate('Tabs', { screen: 'Vault' }))
    expect(names(state)).toBe('Tabs > Search > Tabs')
  })

  it('no source calls navigate on Tabs directly', () => {
    const offenders = sources(path.join(ROOT, 'src'))
      .filter(([, src]) => /\.navigate\(\s*['"]Tabs['"]/.test(strip(src)))
      .map(([file]) => file)
    expect(offenders).toEqual([])
  })
})

describe('a link opened on a cold start (mobile-2)', () => {
  const config = linking.config as Parameters<typeof getStateFromPath>[1]

  it('puts the tabs under a linked stack screen', () => {
    for (const address of ['application/rice-statistics', 'settings', 'scout', 'employer/rice']) {
      const state = getStateFromPath(address, config)
      expect(state?.routes[0].name, address).toBe('Tabs')
      expect(state?.routes.length, address).toBe(2)
    }
  })

  it('still opens a tab address on the tabs alone', () => {
    const state = getStateFromPath('applications?shared=x', config)
    expect(state?.routes.map((r) => r.name)).toEqual(['Tabs'])
  })
})
