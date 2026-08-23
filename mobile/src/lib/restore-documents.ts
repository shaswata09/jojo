/**
 * Landing a backup's documents on a phone, and pointing the records at them.
 *
 * The graph half of a restore is portable and needs nothing from here: a node
 * is a node on both platforms, and `repo/restore.ts` puts it back the same way
 * in both apps. The documents are not, and this is the whole of the difference.
 *
 * ## Why the records have to be rewritten at all
 *
 * A file node holds a `uri` — see `FileProps.uri` — and what that string means
 * depends on the device that wrote it. The browser stores bytes in OPFS under
 * `core/blob-path.ts`'s layout and keys them by the record's own id. This app
 * stores a real file and keeps the absolute `file://` path the picker handed
 * back.
 *
 * So a backup made in a browser and restored here arrives with every file node
 * pointing at a path that exists on nobody's phone. Left alone, the Vault would
 * fill with rows that all report their document missing — and it would look
 * like the transfer had dropped them, when in fact the bytes came across
 * perfectly and only the address is wrong.
 *
 * The backup's own path carries the record id (`Documents/<id>__<name>`), which
 * is what makes the repair possible without guessing: each document already
 * says which node it belongs to.
 *
 * ## Why the destination is computed before anything is written
 *
 * `restoreBackup` writes the records first and the documents second, and its
 * comment explains why that order is the one that fails better. But the records
 * have to be written with their FINAL uris, which means knowing where the bytes
 * will land before a single one is.
 *
 * That is why `plannedUris` is pure and does no I/O. The path is derived from
 * the record id, so it can be worked out up front, written into the nodes, and
 * then honoured by `createDocumentStore` afterwards. Nothing is written twice
 * and nothing has to be patched up after the fact.
 *
 * ## What a failed write costs
 *
 * One row whose document is missing, which is a state the Vault already renders
 * correctly and says out loud. It is the same outcome as a document that never
 * came across, and re-running the transfer fixes it.
 */

import ReactNativeBlobUtil from 'react-native-blob-util'
import { BLOB_SEP, encodeName, idOfPath, nameOfPath } from '@jojo/service/core/blob-path'
import type { StoredNode } from '@jojo/service/core/model'
import type { DocumentStore } from '@jojo/service/repo/restore'

/**
 * The folder restored documents land in.
 *
 * Separate from where `pickDocuments` puts things, and deliberately so: those
 * live in per-call UUID directories that `keepLocalCopy` owns and this app does
 * not choose. This one it does choose, because the path has to be derivable
 * from the record id before the file exists.
 */
const RESTORED = 'restored'

/** The document directory, read lazily so importing this file touches nothing. */
const root = () => `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/${RESTORED}`

/**
 * Where one document will live, given the path the backup filed it under.
 *
 * Null for a path that names no record — the same refusal the browser's store
 * makes, and for the same reason: bytes belonging to no record are bytes
 * nothing in the app can ever open or delete.
 */
export function plannedPath(backupPath: string): { id: string; path: string } | null {
  const id = idOfPath(backupPath)
  if (id === null) return null
  // The same two-underscore layout the backup uses, so a file on the phone can
  // be read back to its record by eye as well as by code. `encodeName` because
  // the name is user data and is about to become a filename.
  return { id, path: `${root()}/${id}${BLOB_SEP}${encodeName(nameOfPath(backupPath))}` }
}

/** Every document's future `file://` uri, by record id. Pure; writes nothing. */
export function plannedUris(
  documents: readonly { path: string; data: Uint8Array }[],
): Map<string, string> {
  const out = new Map<string, string>()
  for (const doc of documents) {
    const planned = plannedPath(doc.path)
    if (planned === null) continue
    // Percent-encoded, because that is what a `file://` URI is and what
    // `documents.ts`'s `pathOf` decodes on the way back out. Skip it and a
    // document with a space in its name reports itself lost the moment it lands.
    out.set(planned.id, `file://${encodeURI(planned.path)}`)
  }
  return out
}

/**
 * The same nodes, with each file node pointed at where its document will be.
 *
 * A node with no document in this backup keeps the uri it arrived with, rather
 * than losing it: the backup may simply have been built without documents — the
 * sender offers that choice — and blanking the field would turn "not in this
 * file" into "this record never had one".
 */
export function withDocumentUris(
  nodes: readonly StoredNode[],
  uris: ReadonlyMap<string, string>,
): StoredNode[] {
  return nodes.map((node) => {
    if (node.type !== 'file') return node
    const uri = uris.get(node.id)
    if (uri === undefined) return node
    return { ...node, props: { ...node.props, uri } }
  })
}

/**
 * A `DocumentStore` over this app's sandbox.
 *
 * `replaceAll` rather than a merge, matching the browser: leaving the previous
 * store's documents behind would mean a restored jojo holding files belonging
 * to records that no longer exist, taking up space nothing can account for.
 *
 * Unlike the browser's, this one deletes rather than trashing. OPFS has a Trash
 * folder because a browser's storage is opaque and a person cannot go and look;
 * a phone's file is gone the moment the app is uninstalled anyway, and a hidden
 * second copy of every document a person ever replaced is a storage bill they
 * did not agree to.
 */
export function createDocumentStore(): DocumentStore {
  return {
    replaceAll: async (documents) => {
      const dir = root()
      try {
        if (await ReactNativeBlobUtil.fs.exists(dir)) await ReactNativeBlobUtil.fs.unlink(dir)
        await ReactNativeBlobUtil.fs.mkdir(dir)
      } catch {
        // Nowhere to put anything. Reported as none landed, which is exactly
        // what the Vault will show and what re-running the transfer will fix.
        return 0
      }

      let landed = 0
      for (const doc of documents) {
        const planned = plannedPath(doc.path)
        if (planned === null) continue
        try {
          await ReactNativeBlobUtil.fs.writeFile(planned.path, base64(doc.data), 'base64')
          landed += 1
        } catch {
          // One document, not the restore. A backup missing one file is worth
          // far more than a restore that refused over it.
          continue
        }
      }
      return landed
    },
  }
}

/**
 * Bytes to base64, because `writeFile` takes a string.
 *
 * Chunked for the same reason `scanner-page.ts` chunks: `String.fromCharCode`
 * applied to a whole document's worth of arguments overflows the stack, and a
 * CV is comfortably large enough to do it.
 */
function base64(data: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < data.length; i += 4096) {
    binary += String.fromCharCode(...data.subarray(i, i + 4096))
  }
  return globalThis.btoa(binary)
}
