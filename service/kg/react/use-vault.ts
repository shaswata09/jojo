/**
 * L4 — useVault(). Signature frozen; the façade that re-exported it is gone.
 *
 * Three collections that took the same three edits through one generic
 * (`useCollectionActions`, in the removed `store-context.ts`). The generic is gone: it
 * could not carry a rule that belonged to one of the three, so `savedOn`, the id
 * prefix and the name field were all passed in as parameters and the call sites
 * became the documentation. Each collection now names its own tool.
 *
 * `addFile` goes through the bulk tool with a list of one. Two files dropped in
 * a single gesture used to mint their slug from a store read that predated both
 * of them and take the same id — one row, one keyword set, one delete taking out
 * two documents — which `sortDrop` in `components/vault/files/intake.ts` works
 * around by hand. Bulk is
 * what makes `ctx.mintSlug` able to see the sibling, so the workaround has
 * nothing left to do.
 */

import { useCallback, useMemo } from 'react'
import type { Snippet, VaultFile, VaultLink } from '../core/model'
import { useGraph, useKg } from './kg-context'
import { useReadBack } from './read-back'
import { useRun } from './use-tool'
import { asNull, asText, nothingToRestore, present } from './patch'

type LinkDraft = Omit<VaultLink, 'id' | 'savedOn'> & { savedOn?: string }
type FileDraft = Omit<VaultFile, 'id' | 'savedOn'> & { savedOn?: string }
type SnippetDraft = Omit<Snippet, 'id'>

export function useVault() {
  const graph = useGraph()
  const { projections } = useKg()
  const run = useRun()

  const links = projections.links(graph)
  const files = projections.files(graph)
  const snippets = projections.snippets(graph)

  const readBack = useReadBack()

  /**
   * Everything filed under one job, in one call.
   *
   * The mirror of `useTimeline`'s selector of the same name, and it exists for
   * the same reason: the application's own page has to show what is attached to
   * it, and without this every caller writes the same three filters — which is
   * three chances to compare against the wrong field, and two apps doing it
   * twice each.
   *
   * Returns the three lists separately rather than one merged array. They are
   * different shapes with different row actions, the page renders them as three
   * sections, and a merged list would have to be re-split by every reader.
   */
  const forApplication = useCallback(
    (appId: string) => ({
      links: links.filter((l) => l.applicationId === appId),
      files: files.filter((f) => f.applicationId === appId),
      snippets: snippets.filter((n) => n.applicationId === appId),
    }),
    [links, files, snippets],
  )

  const addLink = useCallback(
    (draft: LinkDraft): VaultLink => {
      const result = run('vault.link.save', {
        title: draft.title,
        url: draft.url,
        category: draft.category,
        ...present('note', draft.note),
        ...present('savedOn', draft.savedOn),
        ...present('applicationId', draft.applicationId),
      })
      if (!result.ok) throw new Error(result.errors[0]?.message ?? 'Could not save the link.')
      return readBack(projections.links, result.output)
    },
    [run, readBack, projections],
  )

  const updateLink = useCallback(
    (id: string, patch: Partial<VaultLink>) => {
      run('vault.link.update', {
        id,
        ...present('title', patch.title),
        ...present('url', patch.url),
        ...present('category', patch.category),
        ...present('savedOn', patch.savedOn),
        ...asText('note', patch, 'note'),
        ...asNull('applicationId', patch, 'applicationId'),
      })
    },
    [run],
  )

  const removeLink = useCallback(
    (id: string) => {
      const result = run('vault.link.delete', { id })
      return { restore: (result.ok && result.undo) || nothingToRestore }
    },
    [run],
  )

  const addFile = useCallback(
    (draft: FileDraft): VaultFile => {
      const result = run('vault.file.add', {
        files: [
          {
            name: draft.name,
            kind: draft.kind,
            bucket: draft.bucket,
            size: draft.size,
            // `uri` was NOT forwarded here on the phone, and the omission is the
            // reason it is called out. `FileEditor.tsx` put the picked location
            // in the draft and `vault.file.add` declared the field, but this
            // hook — the only caller — listed the props by hand and left it out,
            // so every record written through the picker landed with no `uri`
            // and `documentExists(file.uri)` in `FileViewer.tsx` answered false
            // for all of them. A field written by nobody reads exactly like a
            // field nobody needs, which is how it nearly got dropped in the
            // extraction instead of connected.
            ...present('uri', draft.uri),
            // The two capture fields, forwarded for the reason the paragraph
            // above exists: this list is by hand, so a field the tool declares
            // and this omits is written by nobody and reads exactly like a field
            // nobody needs. `sourceUrl` is what a year-old copy is checked
            // against; losing it here would lose it silently.
            ...present('sourceUrl', draft.sourceUrl),
            ...present('capturedAt', draft.capturedAt),
            ...present('note', draft.note),
            ...present('savedOn', draft.savedOn),
            ...present('applicationId', draft.applicationId),
          },
        ],
      })
      if (!result.ok) throw new Error(result.errors[0]?.message ?? 'Could not add the file.')
      const id = result.output[0]
      if (id === undefined) throw new Error('The file was added and no id came back.')
      return readBack(projections.files, id)
    },
    [run, readBack, projections],
  )

  const updateFile = useCallback(
    (id: string, patch: Partial<VaultFile>) => {
      run('vault.file.update', {
        id,
        ...present('name', patch.name),
        ...present('kind', patch.kind),
        ...present('bucket', patch.bucket),
        ...present('size', patch.size),
        ...present('savedOn', patch.savedOn),
        ...asText('note', patch, 'note'),
        ...asNull('applicationId', patch, 'applicationId'),
      })
    },
    [run],
  )

  const removeFile = useCallback(
    (id: string) => {
      const result = run('vault.file.delete', { id })
      return { restore: (result.ok && result.undo) || nothingToRestore }
    },
    [run],
  )

  const addSnippet = useCallback(
    (draft: SnippetDraft): Snippet => {
      const result = run('vault.snippet.create', {
        title: draft.title,
        tag: draft.tag,
        body: draft.body,
        ...present('applicationId', draft.applicationId),
      })
      if (!result.ok) throw new Error(result.errors[0]?.message ?? 'Could not save the snippet.')
      return readBack(projections.snippets, result.output)
    },
    [run, readBack, projections],
  )

  const updateSnippet = useCallback(
    (id: string, patch: Partial<Snippet>) => {
      run('vault.snippet.update', {
        id,
        ...present('title', patch.title),
        ...present('tag', patch.tag),
        ...present('body', patch.body),
        ...asNull('applicationId', patch, 'applicationId'),
      })
    },
    [run],
  )

  const removeSnippet = useCallback(
    (id: string) => {
      const result = run('vault.snippet.delete', { id })
      return { restore: (result.ok && result.undo) || nothingToRestore }
    },
    [run],
  )

  return useMemo(
    () => ({
      links,
      forApplication,
      addLink,
      updateLink,
      removeLink,
      files,
      addFile,
      updateFile,
      removeFile,
      snippets,
      addSnippet,
      updateSnippet,
      removeSnippet,
    }),
    [
      links,
      forApplication,
      addLink,
      updateLink,
      removeLink,
      files,
      addFile,
      updateFile,
      removeFile,
      snippets,
      addSnippet,
      updateSnippet,
      removeSnippet,
    ],
  )
}
