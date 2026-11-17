/**
 * Q251: a file in the application's From the Vault list has a Preview button
 * that opens the preview dialog over the record, instead of going to the Vault.
 *
 * JSX-only wiring, so D20 leaves a narrow source read.
 */

import { describe, expect, it } from 'vitest'
import panel from './FiledPanel.tsx?raw'
import en from '@/i18n/locales/en/applications.json'

describe('Q251 — Preview on a filed document opens the dialog in place', () => {
  it('is the From the Vault list', () => {
    expect(panel).toMatch(/>\s*\{t\('filed\.title'\)\}\s*<\/PanelTitle>/)
    expect(en.filed.title).toBe('From the Vault')
  })

  it('offers a Preview button on every file row that sets the previewed file', () => {
    const button = /\{'bucket' in row \? \(\s*<Button[\s\S]*?<\/Button>/.exec(panel)?.[0] ?? ''
    expect(button).toContain('onClick={() => setPreview(row)}')
    expect(button).toMatch(/\{t\('common\.preview'\)\}\s*<\/Button>$/)
    expect(en.common.preview).toBe('Preview')
    // A button, not a link: pressing it does not navigate to the Vault.
    expect(button).not.toContain('vaultPath(')
  })

  it('opens the preview dialog on the record, and closes it there', () => {
    expect(panel).toContain('<FilePreviewDialog file={preview} onClose={() => setPreview(null)} />')
  })
})
