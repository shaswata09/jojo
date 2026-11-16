/**
 * The phone's guided tour (Q327): a spotlight on the real screens, hands-on
 * steps that wait for the reader, nothing written on their behalf — the web
 * tour's shape (Q324, Q325), on the platform's own screens.
 *
 * The pure parts are tested directly. The components import React Native,
 * which this runner does not load (see vitest.config.mts), so the wiring is
 * read as text with comments removed.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TOUR_STEPS } from '@/components/tour/steps'
import {
  TAB_ORDER,
  isDone,
  needsRoute,
  placeCard,
  scrollNeeded,
  tabSlot,
  type TourWorld,
} from '@/components/tour/tour-logic'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const read = (rel: string) => strip(readFileSync(path.join(ROOT, rel), 'utf8'))

/** Every .tsx under src, to check that each step's target is really marked. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sources(full)
    return name.endsWith('.tsx') ? [readFileSync(full, 'utf8')] : []
  })
}
const ALL = sources(path.join(ROOT, 'src'))

const world = (over: Partial<TourWorld> = {}): TourWorld => ({
  route: undefined,
  state: () => undefined,
  ...over,
})

describe('a hands-on task on the phone (Q327)', () => {
  it('is done when the reader is on the screen it asks for', () => {
    expect(isDone({ kind: 'route', route: 'Applications' }, world({ route: 'Applications' }))).toBe(
      true,
    )
    expect(isDone({ kind: 'route', route: 'Applications' }, world({ route: 'Today' }))).toBe(false)
  })

  it('is done when a marked control reports the value it asks for', () => {
    const board = { kind: 'state', target: 'layout', value: 'board' } as const
    expect(isDone(board, world({ state: (t) => (t === 'layout' ? 'board' : undefined) }))).toBe(
      true,
    )
    expect(isDone(board, world({ state: () => 'list' }))).toBe(false)
  })
})

describe('the steps (Q327)', () => {
  it('only ever ask the reader for things that write nothing', () => {
    for (const step of TOUR_STEPS) {
      if (step.task) expect(['route', 'state'], step.id).toContain(step.task.done.kind)
    }
  })

  it('point only at controls the app really marks', () => {
    const more = read('src/screens/MoreScreen.tsx')
    const marked = (id: string) => {
      if (id.startsWith('tab:')) {
        return (
          (TAB_ORDER as readonly string[]).includes(id.slice(4)) &&
          ALL.some((s) => s.includes('id="tabbar"'))
        )
      }
      if (id.startsWith('more:')) {
        return (
          more.includes('id={`more:${entry.label}`}') && more.includes(`label: '${id.slice(5)}'`)
        )
      }
      return ALL.some((s) => s.includes(`id="${id}"`))
    }
    for (const step of TOUR_STEPS) {
      const done = step.task?.done
      const checked = done?.kind === 'state' ? done.target : undefined
      for (const id of [step.target, checked])
        if (id) expect(marked(id), `${step.id}: ${id}`).toBe(true)
    }
  })

  it('never opens the screen whose opening is the task', () => {
    for (const step of TOUR_STEPS) {
      if (step.task?.done.kind === 'route')
        expect(step.route, step.id).not.toBe(step.task.done.route)
      expect(needsRoute(step, step.route)).toBe(false)
    }
  })

  it('covers the whole app, end to end', () => {
    const ids = TOUR_STEPS.map((s) => s.id)
    for (const id of [
      'applications',
      'layout',
      'search',
      'new',
      'calendar',
      'vault',
      'files',
      'scout',
      'statistics',
      'graph',
      'assistant',
      'transfer',
      'settings',
      'device',
      'model',
      'reader',
    ]) {
      expect(ids, id).toContain(id)
    }
  })

  it('says what the phone does where it differs from the browser', () => {
    const reader = TOUR_STEPS.find((s) => s.id === 'reader')!.body
    expect(reader).toMatch(/PDFs need MarkItDown/)
    const model = TOUR_STEPS.find((s) => s.id === 'model')!.body
    for (const name of ['vLLM', 'Ollama', 'OpenAI', 'Anthropic (Claude)', 'API key'])
      expect(model).toContain(name)
    // The phone's tools are a calculator: no PDF editor to point at.
    expect(TOUR_STEPS.some((s) => /PDF editor|merge/i.test(s.body))).toBe(false)
  })
})

describe('where things sit on a phone (Q327)', () => {
  const view = { width: 400, height: 800, top: 30, bottom: 20 }
  const card = { width: 376, height: 220 }

  it('takes one tab as its fifth of the tab bar', () => {
    const bar = { x: 0, y: 740, width: 400, height: 60 }
    expect(tabSlot(bar, 'Today')).toEqual({ x: 0, y: 740, width: 80, height: 60 })
    expect(tabSlot(bar, 'More')!.x).toBe(320)
    expect(tabSlot(bar, 'Nope')).toBeNull()
  })

  it('puts the card below a control near the top, above one near the bottom, centred with none', () => {
    const top = placeCard({ x: 10, y: 100, width: 100, height: 40 }, card, view)
    expect(top.top).toBeGreaterThan(140)
    const bottom = placeCard({ x: 10, y: 740, width: 80, height: 60 }, card, view)
    expect(bottom.top + card.height).toBeLessThanOrEqual(740)
    const none = placeCard(null, card, view)
    expect(none.top).toBeGreaterThan(view.top)
    expect(none.top + card.height).toBeLessThanOrEqual(view.height - view.bottom)
  })

  it('scrolls a control below the fold up into view, and leaves one in view alone', () => {
    expect(scrollNeeded({ x: 0, y: 200, width: 10, height: 10 }, view)).toBe(0)
    expect(scrollNeeded({ x: 0, y: 1500, width: 10, height: 10 }, view)).toBeGreaterThan(1000)
  })
})

describe('the wiring (Q327)', () => {
  it('draws the tour beside the navigator, where it outlives every screen', () => {
    expect(read('App.tsx')).toMatch(/<RootNavigator \/>[\s\S]*<TourOverlay \/>/)
  })

  it('reaches the navigator only through its ref, never the hook that throws out there', () => {
    const overlay = read('src/components/tour/TourOverlay.tsx')
    expect(overlay).toMatch(/navigationRef\.navigate/)
    expect(overlay).not.toMatch(/useNavigation\b/)
  })

  it('starts from the first-run offer and from How to use', () => {
    expect(read('src/components/common/Onboarding.tsx')).toMatch(/startTour\(0\)/)
    expect(read('src/screens/guide/GuideScreen.tsx')).toMatch(/startTour\(\)/)
  })

  it('lets Android’s back button leave the tour, keeping the place', () => {
    expect(read('src/components/tour/TourOverlay.tsx')).toMatch(
      /hardwareBackPress', \(\) => \{\s*leaveTour\(\)\s*return true/,
    )
  })
})

describe('Back does not bounce (review 2026-11-16)', () => {
  it('moves on by itself only for a task done while its step was showing', () => {
    const overlay = read('src/components/tour/TourOverlay.tsx')
    expect(overlay).toMatch(/if \(!now\) seenUndone = true/)
    expect(overlay).toMatch(/if \(seenUndone\) setAdvanceFor\(step\.id\)/)
    // And not again on a later visit: the flag resets each time the step opens.
    expect(overlay).toMatch(/let seenUndone = false[\s\S]{0,200}setAdvanceFor\(null\)/)
  })
})
