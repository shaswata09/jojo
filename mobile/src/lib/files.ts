import type { FeatherName } from '@/lib/timeline-visuals'
import type { FileKind } from '@jojo/service/data/vault'

/**
 * How a picked file becomes a Vault record.
 *
 * Two surfaces write files into the same store — the Vault's Files tool and the
 * Profile's Documents panel — and each had grown its own extension map and its
 * own byte formatter. They had already drifted: an .odp deck filed through the
 * Vault got the slides icon and the same deck filed through the Profile got the
 * document one, for the same record in the same list. One reader, so a new
 * extension lands in both places at once.
 *
 * Nothing here reads file CONTENT. Only the name, size and reported type, which
 * is all a session-only store has anywhere to put.
 */

/** Which of the four icons a file gets, by extension. */
const KIND_BY_EXT: Record<string, FileKind> = {
  pdf: 'pdf',
  doc: 'doc',
  docx: 'doc',
  odt: 'doc',
  rtf: 'doc',
  pages: 'doc',
  ppt: 'slides',
  pptx: 'slides',
  odp: 'slides',
  key: 'slides',
  txt: 'note',
  md: 'note',
  note: 'note',
}

/**
 * Extension first, MIME type second: browsers report no type at all for plenty
 * of documents and 'application/octet-stream' for plenty more, while the name is
 * always there. Anything unrecognised is filed as a document rather than given a
 * shape the icon set cannot draw.
 *
 * `type` is optional because one caller has a real `File` and the other only
 * ever had a name — passing it can only ever rescue a PDF the extension missed.
 */
/**
 * One glyph per kind, so a deck and a scan are told apart at a glance.
 *
 * Here rather than in `FilesTool` because the viewer needs the same mapping,
 * and two copies is how a kind added later ends up drawn as a document in one
 * place and nothing in the other.
 */
export const FILE_KIND_ICON: Record<FileKind, FeatherName> = {
  pdf: 'file',
  doc: 'file-text',
  slides: 'monitor',
  note: 'edit-3',
}

export function kindOfFile(name: string, type?: string): FileKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return KIND_BY_EXT[ext] ?? (type === 'application/pdf' ? 'pdf' : 'doc')
}

/** Spelled the way the seed rows already are — '184 KB', '1.2 MB'. */
export function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}
