import { describe, expect, it } from 'vitest'
import { nextSetupStage, type OnboardingStage, type SetupGate } from '@/lib/onboarding'
import onboarding from '@/components/common/Onboarding.tsx?raw'
import setupSteps from '@/components/common/SetupSteps.tsx?raw'

/**
 * First-run onboarding (G6): Q145 — basic details first, then a tour of the
 * app, on web and on the phone; Q159 — details, connect a model, install the
 * extension, then the MarkItDown test only with a model connected, every step
 * skippable.
 */
const NONE: Record<OnboardingStage, boolean> = {
  details: false,
  model: false,
  reader: false,
  extension: false,
  crash: false,
  tour: false,
}

type GateOver = Partial<Omit<SetupGate, 'offered'>> & { offered?: Partial<Record<OnboardingStage, boolean>> }

const gate = (over: GateOver = {}): SetupGate => ({
  fresh: true,
  isBlank: true,
  modelConfigured: true,
  ...over,
  offered: { ...NONE, ...over.offered },
})

/** Every stage shown, in order, answering each as it comes. */
const walk = (start: Omit<SetupGate, 'offered'>) => {
  const offered = { ...NONE }
  const seen: OnboardingStage[] = []
  for (let stage = nextSetupStage({ ...start, offered }); stage; stage = nextSetupStage({ ...start, offered })) {
    seen.push(stage)
    offered[stage] = true
  }
  return seen
}

describe('the order of the first-run steps (Q145, Q159)', () => {
  it('asks for details first, and offers the tour last', () => {
    const steps = walk({ fresh: true, isBlank: true, modelConfigured: true })
    expect(steps[0]).toBe('details')
    expect(steps.at(-1)).toBe('tour')
  })

  it('goes details, model, extension, then the MarkItDown test', () => {
    const steps = walk({ fresh: true, isBlank: true, modelConfigured: true })
    expect(steps.slice(0, 4)).toEqual(['details', 'model', 'extension', 'reader'])
  })

  it('skips the MarkItDown test when no model is connected', () => {
    const steps = walk({ fresh: true, isBlank: false, modelConfigured: false })
    expect(steps).not.toContain('reader')
    expect(steps.indexOf('extension')).toBe(steps.indexOf('model') + 1)
  })

  it('moves on past a step once it has been skipped', () => {
    // `finish` marks a stage offered whether it was done or skipped.
    expect(nextSetupStage(gate({ offered: { details: true } }))).toBe('model')
    expect(nextSetupStage(gate({ offered: { details: true, model: true } }))).toBe('extension')
  })

  it('does not ask a returning user with a filled profile for their details', () => {
    expect(nextSetupStage(gate({ fresh: false, isBlank: false }))).toBe('model')
  })

  it('has nothing left to ask once every step was offered', () => {
    const all = Object.fromEntries(Object.keys(NONE).map((k) => [k, true])) as Record<OnboardingStage, boolean>
    expect(nextSetupStage(gate({ offered: all }))).toBeNull()
  })
})

describe('each step can be skipped (Q159)', () => {
  const code = onboarding.replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')

  it('drives the dialogs from that order', () => {
    expect(code).toMatch(/const stage = nextSetupStage\(\{/)
    for (const stage of ['details', 'model', 'extension', 'reader', 'crash', 'tour']) {
      expect(code).toContain(`if (stage === '${stage}') {`)
    }
  })

  it('wires a skip to every setup step', () => {
    for (const step of ['ConnectModelStep', 'ExtensionStep', 'DocumentReaderStep', 'CrashStep']) {
      expect(code).toMatch(new RegExp(`<${step} onSkip=\\{\\(\\) => finish\\('\\w+'\\)\\}`))
    }
    // …and the shared step frame draws the button for it.
    expect(setupSteps).toMatch(/onClick=\{onSkip\}>\s*Skip for now/)
  })
})

describe('on the phone (Q145)', () => {
  const phone = Object.values(
    import.meta.glob('../../../mobile/src/components/common/Onboarding.tsx', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>,
  )[0]

  it('also asks for details first and offers the tour after', () => {
    expect(phone).toBeDefined()
    const details = phone!.indexOf('if (!offered.details && (fresh || isBlank)) {')
    const tour = phone!.indexOf('if (!offered.tour) {')
    expect(details).toBeGreaterThan(-1)
    expect(tour).toBeGreaterThan(details)
    expect(phone).toMatch(/<WelcomeDetails\b/)
    // The tour is the coach-mark overlay now (mobile/src/components/tour),
    // started from the offer rather than drawn inside it.
    expect(phone).toMatch(/startTour\(0\)/)
  })
})
