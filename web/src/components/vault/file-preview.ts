/**
 * What the Vault's viewer can show for a row — kept out of `FileViewer.tsx` so
 * the rule is a plain module a test can run without rendering anything.
 */
import type { VaultFile } from '@/data/vault'

/** Extensions a browser draws in an `<img>`. `svg` included: as an image it runs no script and fetches nothing. */
const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i

/** How much of a text file is put on screen. A `<pre>` of fifty megabytes is a frozen tab. */
export const TEXT_PREVIEW_BYTES = 1024 * 1024

/**
 * Which preview a row gets, from its kind and whether its bytes are here.
 *
 * Only PDFs had one, so a stored .txt, .md or picture fell through to the
 * sentence for a row with NO document behind it — said about a file the person
 * had just dropped and could Save from the same header (round-2 review, R37).
 */
export function previewKind(
  file: Pick<VaultFile, 'kind' | 'name'>,
  blob: Pick<Blob, 'type'> | undefined,
): 'pdf' | 'page' | 'text' | 'image' | 'none' {
  if (file.kind === 'pdf') return 'pdf'
  if (file.kind === 'page') return 'page'
  if (!blob) return 'none'
  if (file.kind === 'note') return 'text'
  if (blob.type.startsWith('image/') || IMAGE_FILE.test(file.name)) return 'image'
  return 'none'
}

/** The sentence under "No preview for this type", which depends on whether the bytes are here. */
export function noPreviewText(file: Pick<VaultFile, 'kind'>, stored: boolean): string {
  if (file.kind === 'page') {
    // A page with no bytes is a different failure from a .docx, and saying
    // "browsers cannot render page files" would be nonsense — a browser is the
    // one thing that certainly can. What is missing here is the capture, not
    // the capability.
    return 'This posting has no saved copy on this device. Captures are kept where they were taken, so one made on your phone is not here \u2014 and a row restored from a backup carries the record without the page.'
  }
  return stored
    ? `Browsers render PDFs natively but not ${file.kind} files. The document is stored \u2014 Save hands it to your own application.`
    : `Browsers render PDFs natively but not ${file.kind} files \u2014 and there is no stored document behind this row to hand to anything else.`
}
