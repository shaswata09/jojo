/**
 * Q249: adding an application that is already on file stops at a confirm
 * dialog that shows the ORIGINAL posting, where the person keeps or discards
 * the new one.
 *
 * The order of the check — posting ID, then URL, then title and employer, then
 * the model judge — is held by
 * `service/kg/react/use-duplicate-check.requests.test.ts`. What only exists in
 * the JSX is the confirm stage, so D20 leaves a narrow source read.
 */

import { describe, expect, it } from 'vitest'
import dialog from './ApplicationDialog.tsx?raw'

const confirmThenCreate = /async function confirmThenCreate\(\) \{[\s\S]*?\n {2}\}\n/.exec(dialog)?.[0] ?? ''
const duplicateConfirm = /function DuplicateConfirm\([\s\S]*$/.exec(dialog)?.[0] ?? ''

describe('Q249 — a duplicate stops at a dialog showing the original', () => {
  it('runs the duplicate check at Save, with the posting ID and the URL', () => {
    expect(confirmThenCreate).toMatch(/found = await checkDuplicate\(\{/)
    expect(confirmThenCreate).toMatch(/postingId: form\.postingId/)
    expect(confirmThenCreate).toMatch(/url: form\.url/)
  })

  it('holds the save on a hit and shows the confirm stage instead', () => {
    expect(confirmThenCreate).toMatch(/if \(found\) \{\s*setConfirm\(found\)\s*return\s*\}/)
    expect(dialog).toMatch(/\{confirm \? \(\s*<DuplicateConfirm\s+found=\{confirm\}/)
    expect(dialog).toContain('<form onSubmit={onSubmit} noValidate hidden={confirm !== null}>')
  })

  it('shows the original record, its posting ID and its URL', () => {
    expect(duplicateConfirm).toContain('const original = found.record')
    expect(duplicateConfirm).toContain('{displayName(original)}')
    expect(duplicateConfirm).toContain('Posting ID {original.postingId}')
    expect(duplicateConfirm).toContain('{original.url}')
  })

  it('lets the person discard the new one or keep it', () => {
    expect(duplicateConfirm).toMatch(/onClick=\{onDiscard\}>\s*Discard this one/)
    expect(duplicateConfirm).toMatch(/Add anyway/)
    expect(dialog).toContain('onDiscard={() => onOpenChange(false)}')
    expect(dialog).toContain('onAddAnyway={addAnyway}')
  })
})
