/**
 * The documents this tab reads without a reader — a saved page above all.
 *
 * `markitdown-mcp` answered 413 to an extension capture, on the application's
 * own fit panel, the first time the chain was driven end to end in a browser.
 * A page is HTML and needs no reader; this pins that it never goes near one.
 */
import { describe, expect, it } from 'vitest'
import { readHere } from './read-here'

const CAPTURE = `<!doctype html><html><head><title>Tenure-Track Faculty in AI</title>
<style>.x{color:red}</style><script>window.__x = 1</script></head>
<body><nav>Sign in · Jobs</nav><main><h1>Tenure-Track Faculty in Artificial Intelligence</h1>
<p>Required: a PhD in Computer Science.</p><img src="data:image/png;base64,${'A'.repeat(400_000)}"></main>
<footer>© board</footer></body></html>`

describe('reading a document in this tab', () => {
  it('reads a saved page as its text, however large its inlined assets', async () => {
    const out = await readHere(
      new File([CAPTURE], 'Tenure-Track-Faculty-in-AI-2026-09-12.html', { type: 'text/html' }),
    )
    expect(out?.ok).toBe(true)
    if (out?.ok) {
      expect(out.markdown).toContain('Required: a PhD in Computer Science.')
      expect(out.markdown).not.toContain('window.__x')
      expect(out.markdown).not.toContain('AAAA')
    }
  })

  it('reads plain text and markdown as they are', async () => {
    const out = await readHere(
      new File(['# CV\n\nPhD, Computer Science'], 'CV.md', { type: 'text/markdown' }),
    )
    expect(out?.ok).toBe(true)
    if (out?.ok) expect(out.markdown).toContain('PhD, Computer Science')
  })

  it('leaves a PDF and a DOCX to the reader', async () => {
    expect(await readHere(new File(['%PDF-1.7'], 'CV.pdf', { type: 'application/pdf' }))).toBeNull()
    expect(await readHere(new File(['PK'], 'CV.docx'))).toBeNull()
  })

  it('reports an empty page rather than handing the model nothing', async () => {
    const out = await readHere(
      new File(['<html><body></body></html>'], 'blank.html', { type: 'text/html' }),
    )
    expect(out?.ok).toBe(false)
  })
})
