import type { FeatherName } from '@/lib/timeline-visuals'
import type { FileKind } from '@jojo/service/data/vault'

/**
 * How a picked file becomes a Vault record, on a phone.
 *
 * The two rules that are not about a phone — which of the four kinds an
 * extension names, and how a byte count reads — are `@jojo/service/core/files`
 * and are re-exported below rather than declared again. They used to be
 * declared again: this file and the service module held the same extension map
 * and the same formatter, which is the arrangement that had already produced a
 * visible bug once, when the Vault's Files tool and the Profile's Documents
 * panel each had their own map and an .odp deck got the slides icon through one
 * and the document icon through the other. A copy on the phone is that same
 * arrangement at the next size up, and it is what `check-no-copies.mjs` cannot
 * see once one side is edited.
 *
 * What stays here is the half that names something only this app has: a Feather
 * glyph per kind, and the MIME type an Android ACTION_VIEW intent needs. That is
 * the same cut `web/src/lib/timeline-visuals.ts` makes against
 * `core/timeline-view`.
 *
 * Nothing here reads file CONTENT. Only the name, size and reported type, which
 * is all `vault.file.add` has anywhere to put.
 */

/**
 * Re-exported rather than re-imported at each call site, so `FileEditor` and
 * `documents.ts` kept their import line when the implementation moved down.
 */
export { kindOfFile, sizeLabel } from '@jojo/service/core/files'

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

const extensionOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? ''

/**
 * The MIME type an ACTION_VIEW intent needs, from the name alone.
 *
 * NEW WORK, AND WORTH SAYING WHY IT EXISTS. Opening a document used to go
 * through `expo-file-system`'s `getContentUriAsync`, and Android's own content
 * resolver worked the type out from the provider. `actionViewIntent` takes the
 * MIME as an argument instead, and the record has nowhere to keep one — a
 * VaultFile is a name, a kind, a size and a path, and adding a field to it
 * would change a type the web app shares.
 *
 * So it comes back off the extension, which is the same source `kindOfFile`
 * already trusts and the one thing a stored copy is guaranteed to keep.
 *
 * The fallback is the any-type wildcard rather than
 * `application/octet-stream`. Octet-stream is a claim — "these are bytes and
 * nothing can read them" — and Android honours it by offering nothing. The
 * wildcard is the honest shrug: we do not know, so let the phone offer
 * whatever it has.
 */
export function mimeOfFile(name: string): string {
  return MIME_BY_EXT[extensionOf(name)] ?? '*/*'
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odp: 'application/vnd.oasis.opendocument.presentation',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
}
