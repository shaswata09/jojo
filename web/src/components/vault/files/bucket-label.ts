import { FILE_BUCKETS } from '@/data/vault'
import type { FileBucket } from '@/data/vault'
import { i18next } from '@/i18n/i18n'

/** Catalog keys for the five built-in drawers. The stored value stays English. */
const KEY: Record<FileBucket, string> = {
  'To read': 'toRead',
  Applications: 'applications',
  'Job postings': 'jobPostings',
  Talks: 'talks',
  Admin: 'admin',
}

/**
 * A Files drawer's name in the reader's language.
 *
 * The stored bucket is data and stays English — that is what the tools, the
 * agent and a backup read. But the chips printed it raw while the catalogs
 * already named the drawers in translation ("in the Vault under Stellenanzeigen"),
 * so the guidance pointed at a chip nobody could find. Anything that is not a
 * built-in drawer is shown as stored.
 */
export function fileBucketLabel(bucket: string): string {
  const key = (KEY as Record<string, string | undefined>)[bucket]
  return key ? i18next.t(`vault:files.buckets.${key}`) : bucket
}

/** Every built-in drawer's label, keyed by its stored value — for `BucketFilter`. */
export function fileBucketLabels(): Record<string, string> {
  return Object.fromEntries(FILE_BUCKETS.map((b) => [b, fileBucketLabel(b)]))
}
