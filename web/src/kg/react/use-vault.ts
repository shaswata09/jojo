/**
 * L4 — useVault(). Signature frozen; the façade that re-exported it is gone.
 *
 * Three collections that took the same three edits through one generic
 * (`useCollectionActions`, `store-context.ts:618-660`). The generic is gone: it
 * could not carry a rule that belonged to one of the three, so `savedOn`, the id
 * prefix and the name field were all passed in as parameters and the call sites
 * became the documentation. Each collection now names its own tool.
 *
 * `addFile` goes through the bulk tool with a list of one. Two files dropped in
 * a single gesture used to mint their slug from a store read that predated both
 * of them and take the same id — one row, one keyword set, one delete taking out
 * two documents — which `FilesTool.tsx:198-221` works around by hand. Bulk is
 * what makes `ctx.mintSlug` able to see the sibling, so the workaround has
 * nothing left to do.
 */

import { useCallback, useMemo } from 'react'
import type { Snippet, VaultFile, VaultLink } from '@/kg/core/model'
import { useGraph, useKg } from './kg-context'
import { useRun } from './use-tool'
import { asNull, asText, nothingToRestore, present } from './patch'

type LinkDraft = Omit<VaultLink, 'id' | 'savedOn'> & { savedOn?: string }
type FileDraft = Omit<VaultFile, 'id' | 'savedOn'> & { savedOn?: string }
type SnippetDraft = Omit<Snippet, 'id'>

export function useVault() {
  const graph = useGraph()
  const { repo, projections } = useKg()
  const run = useRun()

  const links = projections.links(graph)
  const files = projections.files(graph)
  const snippets = projections.snippets(graph)

  /**
   * The record just written, read back off the committed snapshot.
   *
   * `graph` above is the reading this render was given, and a create inside a
   * handler commits after it — so looking the new id up there would return
   * undefined and every card that navigates to what it just made would land on
   * "this no longer exists".
   */
  const readBack = useCallback(
    <R extends { id: string }>(
      list: (g: ReturnType<typeof repo.getSnapshot>) => readonly R[],
      id: string,
    ): R => {
      const found = list(repo.getSnapshot()).find((r) => r.id === id)
      if (!found) throw new Error('The record was created and could not be read back.')
      return found
    },
    [repo],
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
