import { describe, expect, it } from 'vitest'
import agentPanelSource from './AgentPanel.tsx?raw'
import scriptedPanelSource from './ScriptedPanel.tsx?raw'
import composerSource from './Composer.tsx?raw'
import chatWindowSource from '../chat-dock/ChatWindow.tsx?raw'

/**
 * Owner requests about the Assistant page's layout, pinned on source (D20: no
 * mounting). Each test reads one decision a refactor could quietly undo.
 *
 * Q195 — no suggestion chips over a conversation under way: openers show only
 *   while a thread is empty, in all three places a thread is drawn.
 * Q303 — the thread list and the chat panel share one height and bottom edge:
 *   the ROW is capped and both panels fill it.
 * Q163 — no page-level vertical scroll: the row is measured to the viewport.
 * Q200 — a taller input never overlaps the thread: the composer is its own
 *   fixed-size region below a transcript that only bleeds at the sides.
 */

describe('Q195 — openers only in an empty thread', () => {
  it('draws the Assistant’s openers only while there are no entries', () => {
    expect(agentPanelSource).toMatch(/\{c\.entries\.length === 0 \? \(\s*<OpenerList\b/)
    expect(agentPanelSource.match(/<OpenerList\b/g)).toHaveLength(1)
  })

  it('does the same on the worked-example panel', () => {
    expect(scriptedPanelSource).toMatch(/\{c\.messages\.length === 0 \? <OpenerList\b/)
    expect(scriptedPanelSource.match(/<OpenerList\b/g)).toHaveLength(1)
  })

  it('does the same in a chat dock window', () => {
    // The prompt chips sit in the empty-thread branch, and the transcript in the other.
    const empty = /\) : entries\.length === 0 \? \(([\s\S]*?)\) : \(\s*<DockTranscript\b/.exec(chatWindowSource)?.[1] ?? ''
    expect(empty).toContain('(subject ? ABOUT_PROMPTS : GENERAL_PROMPTS).map(')
    expect(chatWindowSource.match(/ABOUT_PROMPTS : GENERAL_PROMPTS/g)).toHaveLength(1)
  })
})

/** The row that holds the thread list and the chat panel. */
const row = /<div\s+ref=\{isDesktop \? fill\.ref : undefined\}[\s\S]*?>/.exec(agentPanelSource)?.[0] ?? ''

describe('Q303 and Q163 — one row, measured to the viewport', () => {
  it('caps the row, not one panel, on a desktop', () => {
    expect(row).toContain('style={isDesktop ? { maxHeight: fill.maxHeight } : undefined}')
    // One grid row that both columns stretch to.
    expect(row).toContain('lg:grid-rows-[minmax(0,1fr)]')
  })

  it('has the thread list fill that row', () => {
    expect(agentPanelSource).toMatch(/<ThreadList\s+fill=\{isDesktop\}/)
  })

  it('measures the row against the viewport, so the page itself does not scroll', () => {
    expect(agentPanelSource).toMatch(/const fill = useFillViewport\(/)
  })
})

describe('Q200 — the input is its own region', () => {
  it('keeps the transcript scroller from bleeding down under the composer', () => {
    expect(agentPanelSource).toMatch(/<PanelScroll axis="y" bleed="sides"/)
  })

  it('gives the composer a fixed box with no drag handle', () => {
    expect(composerSource).toContain("'field-sizing-fixed resize-none overflow-y-auto'")
  })
})
