import { describe, expect, it } from 'vitest'
import { contentModal } from '@/components/ui/dialog-width'
import css from '@/index.css?raw'

/**
 * Q132 — modals are wide: about three quarters of the content column, the
 * new-application form and the event editor included.
 */
const sheet = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

const dialogs = import.meta.glob(
  ['/src/components/applications/ApplicationDialog.tsx', '/src/components/timeline/TimelineItemDialog.tsx'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

describe('how wide a modal is (Q132)', () => {
  it('is three quarters of the content column', () => {
    expect(sheet).toMatch(/--modal-width: calc\(var\(--page-content\) \* 0\.75\);/)
  })

  it('is what the shared width class applies, past the dialog’s narrow default', () => {
    expect(contentModal).toBe('sm:max-w-[var(--modal-width)]')
  })

  it.each(Object.keys(dialogs))('%s uses it', (file) => {
    expect(Object.keys(dialogs)).toHaveLength(2)
    expect(dialogs[file]).toMatch(/<DialogContent\b[^>]*\bcontentModal\b/)
  })
})
