/**
 * Owner requests about the Profile's Documents card — the Vault's Applications
 * bucket shown on the profile:
 * - Q118: its documents preview in the app, and the card takes a dropped file;
 * - Q121: a file can be removed from the card.
 *
 * The behaviour under each is held elsewhere (`use-file-intake.test.ts`,
 * `use-file-delete.test.ts`, `file-preview.test.ts`); what only exists in the
 * JSX is that THIS card is wired to them, so D20 leaves a narrow source read.
 */

import { describe, expect, it } from 'vitest'
import { DOCUMENTS_BUCKET } from './profile-lists'
import panel from './DocumentsPanel.tsx?raw'
import tile from './DocumentTile.tsx?raw'
import viewer from './use-document-viewer.ts?raw'

describe('the card is the Applications bucket', () => {
  it('lists the files filed in that bucket', () => {
    expect(DOCUMENTS_BUCKET).toBe('Applications')
    expect(panel).toContain('files.filter((f) => f.bucket === DOCUMENTS_BUCKET)')
  })
})

describe('Q118 — profile documents preview in the app and accept a drop', () => {
  it('makes the whole list the drop target, filing into the bucket', () => {
    expect(panel).toMatch(/bucket: DOCUMENTS_BUCKET/)
    expect(panel).toContain('const drop = useFileDrop(takeFiles)')
    expect(panel).toMatch(/onDragOver=\{drop\.onDragOver\}[\s\S]*?onDrop=\{drop\.onDrop\}/)
  })

  it('opens a tile in the inline viewer with the document’s bytes', () => {
    expect(tile).toContain('onClick={() => onOpen(f.id)}')
    expect(panel).toContain('onOpen={viewer.open}')
    expect(panel).toMatch(/<FileViewer\s+file=\{viewer\.openDoc\}\s+blob=\{viewer\.openBlob \?\? undefined\}/)
    expect(viewer).toContain('void blobs.get(openId).then((file) => {')
  })
})

describe('Q121 — a file can be removed from the card', () => {
  it('has a delete button on every tile', () => {
    expect(tile).toMatch(
      /aria-label=\{t\('documentTile\.delete', \{ name: f\.name \}\)\}[\s\S]*?onDelete\(f\)/,
    )
  })

  it('deletes through the shared file delete, closing the viewer if it was open', () => {
    expect(panel).toContain('onDelete={viewer.onDelete}')
    expect(viewer).toContain('const deleteFile = useFileDelete()')
    expect(viewer).toMatch(/deleteFile\(file, \(id\) => \{[\s\S]*?if \(openId === id\) setOpenId\(null\)/)
  })
})
