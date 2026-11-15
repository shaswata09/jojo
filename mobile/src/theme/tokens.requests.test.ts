/**
 * Q082, the phone half: the Today screen's Pipeline card is a coloured pie of
 * applications per stage, on Android and iOS as on the web.
 *
 * The colours are data (`PALETTES[theme].stage`), so they are tested as data:
 * six stages, six different colours, in both themes. Whether the card draws a
 * pie from them only exists in the JSX, and D20 leaves a narrow source read.
 * The web half is `web/src/components/dashboard/PipelineBreakdown.requests.test.ts`.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { STAGE_VALUES } from '@jojo/service/core/model'
import { PALETTES } from './tokens'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const today = readFileSync(path.join(HERE, '../screens/TodayScreen.tsx'), 'utf8')

describe('the phone Pipeline card', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`has six different stage colours in the ${theme} theme`, () => {
      const stage = PALETTES[theme].stage
      const colours = STAGE_VALUES.map((s) => stage[s].toLowerCase())
      expect(colours.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true)
      expect(new Set(colours).size).toBe(STAGE_VALUES.length)
    })
  }

  it('is on the Today screen', () => {
    expect(today).toMatch(/<PipelineBreakdown \/>/)
  })

  it('draws a pie of applications per stage, each slice in its stage colour', () => {
    const card = /function PipelineBreakdown\(\)[\s\S]*?\n\}/.exec(today)?.[0] ?? ''
    expect(card).toMatch(/<Pie[\s\S]*?data=\{stageCounts\.map\(\(stage\) => \(\{/)
    expect(card).toContain('value: stage.count')
    expect(card).toContain('color: c.stage[stage.id]')
  })
})
