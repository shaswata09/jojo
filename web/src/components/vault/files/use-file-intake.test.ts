/**
 * A web page dropped on the Vault is scanned the way a capture is.
 *
 * Round-2 review, R2: a capture from the extension or the phone passes
 * `readCapture`, and a .html file dropped by hand passed nothing — filed as if
 * self-contained whatever it named. It is still filed (refusing every "Save page
 * as" file would make the Vault useless for them), but the person is told.
 */
import { describe, expect, it } from 'vitest'
import { CAPTURE_MAX_BYTES } from '@jojo/service/core/capture'
import { droppedPageNote } from './use-file-intake'

const page = (name: string, html: string) => new File([html], name, { type: 'text/html' })

describe('droppedPageNote', () => {
  it('says how many web addresses a dropped page names', async () => {
    const note = await droppedPageNote(
      page('posting.html', '<!doctype html><img src="https://t.example/b.gif"><link rel=preconnect href="https://t.example/">'),
    )
    expect(note?.title).toBe('posting.html names 2 web addresses')
    expect(note?.description).toMatch(/blocked/)
  })

  it('reads .htm and the singular too', async () => {
    const note = await droppedPageNote(page('A.HTM', '<div style="background:url(http://t.example/x)">x</div>'))
    expect(note?.title).toBe('A.HTM names 1 web address')
  })

  it('says nothing about a self-contained page', async () => {
    await expect(droppedPageNote(page('kept.html', '<!doctype html><img src="data:image/gif;base64,R0lG"><p>x</p>'))).resolves.toBeNull()
  })

  it('leaves an .mhtml archive and every other kind alone', async () => {
    await expect(droppedPageNote(page('saved.mhtml', 'Content-Location: https://t.example/'))).resolves.toBeNull()
    await expect(droppedPageNote(page('cv.txt', 'https://t.example/'))).resolves.toBeNull()
  })

  it('does not hand a huge page to the scan, and says it was not checked', async () => {
    const big = page('huge.html', 'x'.repeat(CAPTURE_MAX_BYTES + 1))
    const note = await droppedPageNote(big)
    expect(note?.title).toMatch(/too large to check/)
  })
})

describe('the intake', () => {
  it('runs the note for every new page row and shows what it says', async () => {
    const source = (await import('./use-file-intake.ts?raw')).default
    const loop = source.slice(source.indexOf('for (const file of fresh)'))
    expect(loop).toMatch(/if \(record\.kind === 'page'\) \{\s*void droppedPageNote\(file\)\.then\(\(note\) => \{\s*if \(note\) toast\(note\)/)
  })
})
