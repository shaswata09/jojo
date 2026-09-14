import type { FileBucket, VaultFile } from '@/data/vault'

/**
 * Which files the list shows, given every control that can hide one.
 *
 * Four filters now sit above this list — bucket, keywords, search, and whether
 * a file is filed under an application — and they are ANDed. Each is obviously
 * right on its own, which is exactly the shape of thing that goes wrong when
 * they are combined: the failure is not a broken filter, it is two correct
 * filters that between them hide a row neither meant to.
 *
 * So the composition is one function with its own tests, rather than a chain of
 * `&&` inside a component nothing can reach.
 */

/**
 * A file nobody has filed under an application.
 *
 * `applicationIds` is a list and empty rather than absent — see the field's own
 * note in the model — so this is the whole of the question. The app's word for
 * it is "unfiled": `filedUnderLabel` has returned that since before this filter
 * existed, and the chip says the same thing.
 */
export const isUnfiled = (file: Pick<VaultFile, 'applicationIds'>): boolean =>
  file.applicationIds.length === 0

export const unfiledCount = (files: readonly VaultFile[]): number => files.filter(isUnfiled).length

export type FileFilters = {
  /** 'all' means the bucket chips are off. */
  readonly bucket: FileBucket | 'all'
  /** The unfiled chip. When off, filed and unfiled files both show. */
  readonly unfiledOnly: boolean
  /** Whether the page's keyword row lets this file through, by id. */
  readonly keywords: (id: string) => boolean
  /** Whether the search box lets this file through. */
  readonly search: (file: VaultFile) => boolean
}

export function visibleFiles(
  files: readonly VaultFile[],
  filters: FileFilters,
): readonly VaultFile[] {
  return files.filter(
    (file) =>
      (filters.bucket === 'all' || file.bucket === filters.bucket) &&
      (!filters.unfiledOnly || isUnfiled(file)) &&
      filters.keywords(file.id) &&
      filters.search(file),
  )
}

/**
 * How many filters are hiding something, for the empty state to describe.
 *
 * The search box is not counted: it has its own branch above every other, and
 * a person who has typed something knows why the list is short.
 */
export const activeFilterCount = (
  filters: Pick<FileFilters, 'bucket' | 'unfiledOnly'>,
  keywords: number,
): number =>
  (filters.bucket === 'all' ? 0 : 1) + (filters.unfiledOnly ? 1 : 0) + (keywords > 0 ? 1 : 0)
