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
