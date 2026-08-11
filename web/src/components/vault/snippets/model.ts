import type { Snippet, SnippetTag } from '@/data/vault'

/** The editor's working copy. `id` is null until the snippet has been saved once. */
export type Draft = {
  id: string | null
  title: string
  tag: SnippetTag
  html: string
  /** Staged, not written on click — see `KeywordPicker`. Cancel discards them. */
  keywords: string[]
}

/** What the draft looked like when it was opened, for the dirty check. */
export type Clean = { title: string; tag: SnippetTag; body: string; keywords: string }

/** Order-insensitive, because picking A then B is the same set as B then A. */
export const keywordKey = (ids: readonly string[]) => [...ids].sort().join(',')

/** Deciding what to do after the discard warning is answered. */
export type Pending = { kind: 'close' } | { kind: 'open'; snippet?: Snippet }
