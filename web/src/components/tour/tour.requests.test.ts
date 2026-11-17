import { describe, expect, it } from 'vitest'
import { STEPS } from '@/components/tour/steps'
import {
  isDone,
  mark,
  needsRoute,
  onRoute,
  placeCard,
  samePath,
  type TourWorld,
} from '@/components/tour/tour-logic'
import shell from '@/components/layout/AppShell.tsx?raw'
import onboarding from '@/components/common/Onboarding.tsx?raw'
import launcher from '@/components/guide/GuidedTour.tsx?raw'
import overlay from '@/components/tour/TourOverlay.tsx?raw'
import tourCatalog from '@/i18n/locales/en/tour.json?raw'

/**
 * Q324 — the guided tour: a spotlight on the real pages, hands-on steps that
 * wait for the reader, and nothing written on their behalf. Pure parts are
 * tested directly; the wiring is read as source (D20: nothing mounts).
 */
const world = (over: Partial<TourWorld> = {}): TourWorld => ({
  pathname: '/',
  search: '',
  has: () => false,
  plays: 0,
  ...over,
})

/** Every source file, to check that each step's target is really marked somewhere. */
const SOURCES = Object.values(
  import.meta.glob('/src/**/*.tsx', { query: '?raw', import: 'default', eager: true }),
) as string[]

describe('a hands-on task (Q324)', () => {
  it('is done when the reader is on the page it asks for', () => {
    expect(
      isDone({ kind: 'route', path: '/applications' }, world({ pathname: '/applications/' })),
    ).toBe(true)
    expect(isDone({ kind: 'route', path: '/applications' }, world({ pathname: '/calendar' }))).toBe(
      false,
    )
  })

  it('is done when the address carries the view it asks for', () => {
    const table = { kind: 'query', param: 'view', value: 'table' } as const
    expect(isDone(table, world({ search: '?view=table&stage=all' }))).toBe(true)
    expect(isDone(table, world({ search: '?view=board' }))).toBe(false)
  })

  it('is done when a menu opens, and again when it closes', () => {
    const open = world({ has: (selector) => selector === mark('new-menu') })
    expect(isDone({ kind: 'open', target: 'new-menu' }, open)).toBe(true)
    expect(isDone({ kind: 'closed', target: 'new-menu' }, open)).toBe(false)
    expect(isDone({ kind: 'closed', target: 'new-menu' }, world())).toBe(true)
  })

  it('is done when a keyword is picked in the filter row', () => {
    const picked = world({ has: (selector) => selector === `${mark('keywords')}[data-selected]` })
    const check = { kind: 'marked', target: 'keywords', attr: 'data-selected' } as const
    expect(isDone(check, picked)).toBe(true)
    expect(isDone(check, world())).toBe(false)
  })

  it('is done on a vault tab only when that tab is the one open', () => {
    const files = { kind: 'route', path: '/vault?tool=files' } as const
    expect(isDone(files, world({ pathname: '/vault', search: '?tool=files&focus=x' }))).toBe(true)
    expect(isDone(files, world({ pathname: '/vault', search: '?tool=links' }))).toBe(false)
    expect(onRoute('/vault', '/vault', '?tool=links')).toBe(true)
  })

  it('is done once the reader has made the robot move', () => {
    expect(isDone({ kind: 'mascot' }, world({ plays: 1 }))).toBe(true)
    expect(isDone({ kind: 'mascot' }, world())).toBe(false)
  })
})

describe('the steps (Q324)', () => {
  it('only ever ask the reader for things that write nothing', () => {
    // Opening, switching and drawing on the robot. Never a save, a drag or a
    // form filled in — those are pointed at and explained.
    for (const step of STEPS) {
      if (step.task)
        expect(['route', 'query', 'open', 'closed', 'mascot', 'marked'], step.id).toContain(
          step.task.done.kind,
        )
    }
  })

  it('point only at elements the app really marks', () => {
    const marked = (name: string) =>
      SOURCES.some(
        (src) =>
          src.includes(`data-tour="${name}"`) ||
          // A mark set as a prop object, as the chat dock's is.
          src.includes(`'data-tour': '${name}'`) ||
          // A Settings card's, handed to its shell: `<Shell … tour="model">`.
          src.includes(`tour="${name}"`) ||
          // Marks built from a label: `nav:Applications`, `top:Settings`.
          (name.includes(':') && src.includes(`data-tour={\`${name.split(':')[0]}:\${label}\`}`)),
      )
    for (const step of STEPS) {
      for (const name of [
        step.target,
        step.only,
        step.task && 'target' in step.task.done ? step.task.done.target : undefined,
      ]) {
        if (name) expect(marked(name), `${step.id}: ${name}`).toBe(true)
      }
    }
  })

  it('never takes the reader to a page whose visit is the task', () => {
    for (const step of STEPS) {
      if (step.task?.done.kind === 'route') expect(step.route, step.id).toBeUndefined()
    }
  })

  it('passes over a step about a menu that is not open, and only such a step', () => {
    for (const step of STEPS) {
      if (step.only) {
        expect(step.open, step.id).toBe(true)
        expect(step.target, step.id).toBe(step.only)
      }
    }
    expect(overlay).toMatch(/if \(step\.only && !document\.querySelector/)
  })

  it('goes to a step’s page only when the reader is not already on it', () => {
    const layout = STEPS.find((s) => s.id === 'layout')!
    expect(needsRoute(layout, '/applications')).toBeNull()
    expect(needsRoute(layout, '/')).toBe('/applications')
    const files = STEPS.find((s) => s.id === 'files')!
    expect(needsRoute(files, '/vault', '?tool=links')).toBe(files.route)
    expect(needsRoute(files, '/vault', '?tool=files')).toBeNull()
    expect(samePath('/', '/')).toBe(true)
  })
})

describe('where the card sits (Q324)', () => {
  const view = { width: 1440, height: 900 }
  const card = { width: 320, height: 200 }

  it('beside the lit element, on the side the step prefers', () => {
    const p = placeCard({ left: 20, top: 100, width: 200, height: 40 }, card, view, 'right')
    expect(p.side).toBe('right')
    expect(p.left).toBeGreaterThanOrEqual(220)
  })

  it('on another side when the preferred one has no room', () => {
    const p = placeCard({ left: 1200, top: 100, width: 200, height: 40 }, card, view, 'right')
    expect(p.side).not.toBe('right')
  })

  it('always inside the window, and centred when nothing is lit', () => {
    const p = placeCard(
      { left: 1400, top: 880, width: 30, height: 15 },
      card,
      { width: 390, height: 700 },
      'bottom',
    )
    expect(p.left).toBeGreaterThanOrEqual(0)
    expect(p.left + card.width).toBeLessThanOrEqual(390)
    expect(p.top + card.height).toBeLessThanOrEqual(700)
    expect(placeCard(null, card, view).side).toBe('center')
  })
})

describe('the whole app, end to end (Q325)', () => {
  it('covers every area: models, the reader, files, chat, scout, statistics, PDF tools, the graph, storage and keywords', () => {
    const ids = STEPS.map((s) => s.id)
    for (const id of [
      'model',
      'reader',
      'files',
      'file-viewer',
      'chat',
      'pipelines',
      'stats',
      'pdf',
      'graph',
      'runtime',
      'keywords',
      'keyword-manager',
    ]) {
      expect(ids, id).toContain(id)
    }
  })

  it('names the model providers the app really offers', () => {
    // The words are the `tour` catalog's now; English is the source.
    expect(STEPS.find((s) => s.id === 'model')).toBeDefined()
    const model: string = JSON.parse(tourCatalog).steps.model.body
    for (const name of ['vLLM', 'Ollama', 'OpenAI', 'Anthropic (Claude)', 'API key'])
      expect(model).toContain(name)
  })
})

describe('the tour’s wiring (Q324)', () => {
  it('lives in the app shell, inside the router, so it can walk from page to page', () => {
    expect(shell).toMatch(/<TourProvider>/)
  })

  it('starts where the reader is, from onboarding and from the guide', () => {
    expect(onboarding).toMatch(/tour\.start\(0\)/)
    expect(launcher).toMatch(/tour\.start\(\)/)
  })
})

describe("the tour keeps out of the reader's way (review 2026-11-16)", () => {
  it('moves on by itself only for a task done while its step was showing', () => {
    expect(overlay).toMatch(/if \(!now\) seenUndone = true/)
    expect(overlay).toMatch(/if \(seenUndone\) setAdvanceFor\(step\.id\)/)
    // And not again on a later visit: the flag resets each time the step opens.
    expect(overlay).toMatch(/let seenUndone = false[\s\S]{0,200}setAdvanceFor\(null\)/)
    expect(overlay).toMatch(/const advance = advanceFor === step\.id/)
  })

  it('leaves a key alone that a menu or a radio group already handled', () => {
    expect(overlay).toMatch(/if \(event\.defaultPrevented \|\|/)
  })

  it('lets a menu opened during the tour be used above its dim', () => {
    expect(overlay).toMatch(/const shield = !step\.open && !popper &&/)
  })
})
