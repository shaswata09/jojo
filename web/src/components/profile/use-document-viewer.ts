import { useEffect, useRef, useState } from 'react'
import type { VaultFile } from '@/data/vault'
import { useFileDelete } from '@/lib/use-file-delete'
import { useVaultBlobs } from '@/lib/vault-blobs'

/*
 * The document being previewed, and its bytes.
 *
 * Loaded when the viewer opens rather than held for every row: this card can
 * show a dozen documents and holding a dozen `File`s — and a dozen blob URLs —
 * to render a dozen names is a lot of memory for something nobody is looking
 * at. The same shape the Vault's files tool uses, for the same reason.
 */
export function useDocumentViewer(documents: readonly VaultFile[]) {
  const blobs = useVaultBlobs()
  const [openId, setOpenId] = useState<string | null>(null)
  const [openBlob, setOpenBlob] = useState<File | null>(null)
  const openDoc = documents.find((f) => f.id === openId) ?? null
  const viewerRef = useRef<HTMLDivElement | null>(null)

  /**
   * Bring the preview into view when it opens.
   *
   * `smooth` and `nearest`: the reader pressed a row they can see, so the page
   * should move as little as it can to show the result — `start` would yank the
   * clicked row to the top of the window, which loses the place they were in.
   */
  useEffect(() => {
    if (openId === null) return
    viewerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [openId])

  /**
   * The same delete the Vault's files tool performs.
   *
   * Through `useFileDelete` rather than `removeFile` alone: a document is the
   * record, its keywords AND its bytes, and a delete here that dropped only the
   * record would leave the file in IndexedDB for good — unreachable and still
   * counted against the quota. It carries the same Undo, which also puts the
   * bytes back.
   */
  const deleteFile = useFileDelete()
  const onDelete = (file: VaultFile) => {
    deleteFile(file, (id) => {
      // The preview is showing a record that has just stopped existing.
      if (openId === id) setOpenId(null)
    })
  }

  useEffect(() => {
    if (openId === null) {
      setOpenBlob(null)
      return
    }
    let live = true
    void blobs.get(openId).then((file) => {
      // Guarded: the viewer can be closed, or another row opened, while a large
      // document is still being read out of IndexedDB.
      if (live) setOpenBlob(file)
    })
    return () => {
      live = false
    }
  }, [openId, blobs])

  return {
    openDoc,
    openBlob,
    viewerRef,
    open: (id: string) => setOpenId(id),
    close: () => setOpenId(null),
    onDelete,
  }
}
