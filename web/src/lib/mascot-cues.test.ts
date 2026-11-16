import { describe, expect, it } from 'vitest'
import { CUES, isAdvance, stageGesture } from './mascot-cues'
import { POSE_MS } from './mascot-context'
import rowActions from '@/components/applications/use-row-actions.tsx?raw'
import detail from '@/routes/ApplicationDetail.tsx?raw'
import writes from '@/components/applications/dialog/use-application-writes.ts?raw'
import proposals from '@/components/scout/use-proposal-actions.ts?raw'
import postings from '@/components/scout/use-posting-actions.ts?raw'
import alreadyHave from '@/components/scout/use-already-have.ts?raw'
import fillDraft from '@/components/scout/use-fill-draft.ts?raw'
import pipelines from '@/components/scout/use-pipeline-actions.ts?raw'
import priority from '@/components/dashboard/PriorityActions.tsx?raw'
import owed from '@/components/dashboard/OwedThisWeek.tsx?raw'
import reminders from '@/components/vault/RemindersTool.tsx?raw'
import backup from '@/lib/backup.ts?raw'
import conversation from '@/components/assistant/use-conversation-panel.ts?raw'

describe('what counts as moving forward', () => {
  it('is a later column, one step or several', () => {
    expect(isAdvance('draft', 'submitted')).toBe(true)
    expect(isAdvance('submitted', 'screen')).toBe(true)
    expect(isAdvance('screen', 'interview')).toBe(true)
    expect(isAdvance('interview', 'offer')).toBe(true)
    // A drag can cross two columns at once; that is still forward.
    expect(isAdvance('draft', 'offer')).toBe(true)
  })

  it('is not a correction back down the board', () => {
    expect(isAdvance('offer', 'interview')).toBe(false)
    expect(isAdvance('interview', 'screen')).toBe(false)
    expect(isAdvance('submitted', 'draft')).toBe(false)
  })

  it('is not the same column twice', () => {
    expect(isAdvance('screen', 'screen')).toBe(false)
  })

  it('is never a move into Closed, from anywhere', () => {
    /*
     * Closed is the last column, so by index every drag into it advances. But
     * the stage does not say whether the application was accepted or rejected,
     * and rejection is the common case — celebrating one would be worse than
     * staying still.
     */
    expect(isAdvance('offer', 'closed')).toBe(false)
    expect(isAdvance('draft', 'closed')).toBe(false)
    expect(isAdvance('closed', 'closed')).toBe(false)
  })
})

describe('the gesture a stage move draws (Q323)', () => {
  it("dances when a draft is sent off, the owner's own example", () => {
    expect(stageGesture('draft', 'submitted')).toBe('dance')
  })

  it('gives each forward stage its own gesture', () => {
    expect(stageGesture('submitted', 'screen')).toBe('bounce')
    expect(stageGesture('screen', 'interview')).toBe('powerUp')
    expect(stageGesture('interview', 'offer')).toBe('hopSpin')
    // Crossing columns plays the one it lands in.
    expect(stageGesture('draft', 'offer')).toBe('hopSpin')
  })

  it('plays nothing for a move back down the board, or nowhere', () => {
    expect(stageGesture('offer', 'interview')).toBeNull()
    expect(stageGesture('submitted', 'draft')).toBeNull()
    expect(stageGesture('screen', 'screen')).toBeNull()
  })

  it('closes by the outcome: love for an acceptance, a nod for your own call, nothing over bad news', () => {
    expect(stageGesture('offer', 'closed', 'accepted')).toBe('love')
    expect(stageGesture('offer', 'closed', 'declined')).toBe('nod')
    expect(stageGesture('interview', 'closed', 'withdrawn')).toBe('nod')
    expect(stageGesture('interview', 'closed', 'rejected')).toBeNull()
    expect(stageGesture('submitted', 'closed', 'ghosted')).toBeNull()
    expect(stageGesture('submitted', 'closed')).toBeNull()
    expect(stageGesture('closed', 'closed', 'accepted')).toBeNull()
  })
})

describe('the gestures other actions draw (Q323)', () => {
  it('uses only gestures the mascot knows', () => {
    for (const pose of Object.values(CUES)) expect(POSE_MS[pose]).toBeGreaterThan(0)
  })

  it('never celebrates a refusal', () => {
    expect(['dance', 'spin', 'hopSpin', 'bounce', 'love', 'jazz']).not.toContain(CUES.alreadyHave)
  })
})

/**
 * Q323 — the table only matters if the actions reach it. Read as source
 * (D20), comments stripped so a paragraph about the wiring cannot stand in
 * for it.
 */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('the actions wired to the mascot (Q323)', () => {
  it('plays the stage gesture wherever a stage changes: the board, the table and the detail page', () => {
    expect(code(rowActions)).toMatch(
      /const gesture = stageGesture\(from, stage, a\.outcome\)\s*if \(gesture\) play\(gesture\)/,
    )
    const page = code(detail)
    expect(page).toMatch(/stageGesture\(a\.stage, to, patch\.outcome \?\? a\.outcome\)/)
    expect(page).toMatch(/stageGesture\(a\.stage, 'closed', decision\)/)
  })

  it('bounces for a new application, by hand or from the scout', () => {
    for (const src of [writes, proposals, postings]) {
      expect(code(src)).toMatch(/mascot\.play\(CUES\.applicationAdded\)/)
    }
  })

  it('shakes its head at a job already in the applications', () => {
    for (const src of [alreadyHave, fillDraft, proposals]) {
      expect(code(src)).toMatch(/mascot\.play\(CUES\.alreadyHave\)/)
    }
  })

  it('nods when a task is ticked off, and not when one is reopened', () => {
    expect(code(priority)).toMatch(/mascot\.play\(CUES\.taskDone\)/)
    expect(code(owed)).toMatch(/mascot\.play\(CUES\.taskDone\)/)
    expect(code(reminders)).toMatch(/if \(!done\) mascot\.play\(CUES\.taskDone\)/)
  })

  it('flexes for a saved backup, scans for a scout run, types while the assistant works', () => {
    expect(code(backup).match(/mascot\.play\(CUES\.backupSaved\)/g)?.length).toBe(2)
    expect(code(pipelines)).toMatch(/engine\.runNow\(id\)\s*mascot\.play\(CUES\.scoutStarted\)/)
    expect(code(conversation)).toMatch(/mascot\.play\(CUES\.assistantWorking\)\s*void send\(text\)/)
  })
})
