import { describe, expect, it } from 'vitest'
import viewerSource from './FileViewer.tsx?raw'
import snippetEditorSource from './snippets/SnippetEditor.tsx?raw'
import fullScreenSource from '@/components/common/FullScreen.tsx?raw'

/**
 * Q061: the full-screen PDF preview has a notes drawer on the right, written in
 * the rich text editor, with its collapse icon centred; the full-screen snippet
 * editor keeps its title and keyword fields and has exactly one close X.
 *
 * All of it is layout in JSX, so it is pinned as source (D20).
 */

const strip = (source: string) =>
  source.replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')

const viewer = strip(viewerSource)
/** From the full-screen dialog to the end of the component: the expanded view. */
const fullView = viewer.slice(viewer.indexOf('<FullScreenDialog'))

describe('the full-screen PDF notes drawer (Q061)', () => {
  it('sits beside the document, on its right', () => {
    // The document frame first, then the drawer: a row, so the aside is on the right.
    const frame = fullView.indexOf('{frame}')
    const aside = fullView.indexOf('<aside')
    expect(frame).toBeGreaterThan(-1)
    expect(aside).toBeGreaterThan(frame)
    expect(fullView).toMatch(/<aside className="[^"]*\bborder-s\b/)
  })

  it('is written in the rich text editor', () => {
    const drawer = fullView.slice(fullView.indexOf('<aside'), fullView.indexOf('</aside>'))
    expect(drawer).toMatch(/<RichTextEditor\b/)
  })

  it('collapses to a rail whose icon is centred across it', () => {
    const rail = fullView.slice(fullView.indexOf('onClick={() => setNotesOpen(true)}'))
    const cls = /className="([^"]*)"/.exec(rail)?.[1] ?? ''
    expect(cls).toContain('justify-items-center')
    // `place-items-start` pinned the icon into the top-left corner.
    expect(cls).not.toContain('place-items-start')
  })
})

describe('the full-screen snippet editor (Q061)', () => {
  const snippet = strip(snippetEditorSource)

  it('renders the same form full screen, title and keywords included', () => {
    expect(snippet).toMatch(/<FullScreenDialog[\s\S]*?>\s*\{form\}\s*<\/FullScreenDialog>/)
    const form = snippet.slice(snippet.indexOf('const form = ('), snippet.indexOf('return full ?'))
    expect(form).toMatch(/<Field\s+label=\{t\('snippets\.editor\.title\.label'\)\}/)
    expect(form).toMatch(/<KeywordPicker\b/)
  })

  it('drops its own Close button full screen, leaving the dialog’s X as the only one', () => {
    // The form's Close button exists only outside full screen…
    expect(snippet).toMatch(
      /\{full \? null : \(\s*<Button[\s\S]*?onClick=\{requestClose\}[\s\S]*?\{t\('common\.close'\)\}\s*<\/Button>\s*\)\}/,
    )
    // …and the full-screen dialog does not add a second close of its own.
    const dialog = strip(fullScreenSource)
    expect(dialog).not.toContain('showCloseButton={false}')
  })
})

describe('switching documents in the viewer (web-4)', () => {
  // The note draft is reset from the stored note, which is the same string for
  // two files with no note — so without a key, one file's unsaved note opened
  // on the next, and Save wrote it there.
  const sites = import.meta.glob(
    ['/src/components/vault/FilesTool.tsx', '/src/components/profile/DocumentsPanel.tsx'],
    { query: '?raw', import: 'default', eager: true },
  ) as Record<string, string>
  const hook = import.meta.glob('/src/components/profile/use-document-viewer.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>

  it('is keyed by the file at every call site, so a draft never carries over', () => {
    expect(sites['/src/components/vault/FilesTool.tsx']).toMatch(
      /<FileViewer\s+file=\{open\}[\s\S]*?key=\{open\.id\}/,
    )
    expect(sites['/src/components/profile/DocumentsPanel.tsx']).toMatch(
      /<FileViewer\s+file=\{viewer\.openDoc\}[\s\S]*?key=\{viewer\.openDoc\.id\}/,
    )
  })

  it('drops the last document’s bytes before reading the next one', () => {
    for (const source of [sites['/src/components/vault/FilesTool.tsx'], ...Object.values(hook)]) {
      expect(source).toMatch(
        /useEffect\(\(\) => \{[\s\S]*?setOpenBlob\(null\)\s*if \(openId === null\) return/,
      )
    }
  })
})
