/**
 * L1 — what a picked file IS, before anything decides how to draw it.
 *
 * Two rules, both pure: which of the four kinds an extension names, and how a
 * byte count reads. Neither touches file CONTENT — only the name, the size and
 * the reported type, which is all `vault.file.add` has anywhere to put.
 *
 * It lived in `src/lib/files.ts`, which is the web app, and it was on the list
 * of modules the mobile app was told to keep in step by copying the file across
 * — alongside `priority`, `ids`, `labels` and `roles`. A rule maintained by
 * copy-paste is a rule that disagrees the first time only one copy is edited,
 * and this one had already done that once WITHIN the web app: the Vault's Files
 * tool and the Profile's Documents panel each had their own extension map, so an
 * .odp deck filed through one got the slides icon and the same deck filed
 * through the other got the document one. Folding those two together is why this
 * exists; putting it below the seam is the same fix at the next size up.
 *
 * `FileKind` comes from `core/model`, so adding a fifth kind is one edit here
 * and a compile error at every map keyed on it.
 */

import type { FileKind } from './model'

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
  // A saved posting. `.mhtml`/`.mht` are here because that is what Chrome's own
  // "Webpage, Single File" produces, and a user who saved one by hand rather
  // than through the extension should get the page icon and the page viewer
  // rather than a document icon and a download prompt.
  html: 'page',
  htm: 'page',
  mhtml: 'page',
  mht: 'page',
}

/**
 * Extension first, MIME type second: browsers report no type at all for plenty
 * of documents and 'application/octet-stream' for plenty more, while the name is
 * always there. A React Native document picker is worse again — it reports the
 * content URI's type, which on Android is routinely the generic one. Anything
 * unrecognised is filed as a document rather than given a shape the icon set
 * cannot draw.
 *
 * `type` is optional because one caller has a real `File` and the other only
 * ever had a name — passing it can only ever rescue a PDF the extension missed.
 */
export function kindOfFile(name: string, type?: string): FileKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return KIND_BY_EXT[ext] ?? (type === 'application/pdf' ? 'pdf' : 'doc')
}

/** Spelled the way the seed rows already are — '184 KB', '1.2 MB'. */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

/**
 * A content type, from the extension.
 *
 * Here rather than in either app because both need it and both had it. Mobile
 * used it to pick the Android intent that opens a document; web needs it to
 * rebuild a `File` from stored bytes, where an empty type turns every restored
 * PDF into a download instead of a preview. Two maps drifted apart the moment
 * the second one was written — web's knew `webp` and `svg`, mobile's knew `odt`,
 * `rtf` and `pptx`, and neither knew what the other did.
 *
 * From the extension, not from a stored MIME string: `VaultFile` has no field
 * for one, adding it would change a type both apps share, and the extension is
 * the one thing a stored copy is guaranteed to keep.
 *
 * The FALLBACK is the caller's, because the right answer differs by platform and
 * the difference is not cosmetic. Android honours `application/octet-stream` by
 * offering no application at all, so the phone passes the any-type wildcard —
 * the honest shrug that lets it offer whatever it has. A browser building a
 * `Blob` needs a real type, so the web passes `application/octet-stream`.
 */
export function mimeOfFile(name: string, fallback = 'application/octet-stream'): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  return MIME_BY_EXT[ext] ?? fallback
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
  // A saved posting. Without this a capture rebuilt from stored bytes gets the
  // caller's fallback, which on web is `application/octet-stream` — and a
  // `srcdoc` frame fed octet-stream renders nothing at all.
  html: 'text/html',
  htm: 'text/html',
  mhtml: 'multipart/related',
  mht: 'multipart/related',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}
