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
    // Segment by segment, not `encodeURI`, which leaves '#' and '?' raw — a
    // document called "CV #2.pdf" then parsed as a path ending at "CV " and a
    // fragment, and iOS shared a file that was not there (transfer audit,
    // 2026-11-16). `pathOf` and `forgetUris` decode it back exactly.
    out.set(planned.id, `file://${planned.path.split('/').map(encodeURIComponent).join('/')}`)
  }
  return out
}

/**
 * The same nodes, with each file node pointed at where its document is.
 *
 * Three cases, in order:
 *   - the backup carries the document: the uri it is about to be written to;
 *   - it does not, and this phone already holds a copy for that record (`held`,
 *     read from the store before the restore): that copy's uri. A transfer
 *     sends records only by default, and a record that arrives without its
 *     document has not said the document is gone — see `keptDocuments`;
 *   - neither: no uri. The one that arrived is dropped, because a uri is a
 *     path in ONE device's sandbox — a phone's `file:///data/user/0/…` restored
 *     onto another phone named a file that phone does not have, and
 *     `hasBytesOnRecord` then reported bytes that could not be opened.
 */
export function withDocumentUris(
  nodes: readonly StoredNode[],
  uris: ReadonlyMap<string, string>,
  held: ReadonlyMap<string, string> = new Map(),
): StoredNode[] {
  return nodes.map((node) => {
    if (node.type !== 'file') return node
    const uri = uris.get(node.id) ?? held.get(node.id)
    if (uri !== undefined) return { ...node, props: { ...node.props, uri } }
    if (!('uri' in node.props)) return node
    const { uri: _foreign, ...props } = node.props as Record<string, unknown>
    return { ...node, props } as StoredNode
  })
}

/**
 * The documents this phone holds now, by record id — read before a restore
 * replaces the records, so `withDocumentUris` can keep them.
 */
export async function heldDocuments(
  nodes: readonly StoredNode[],
  exists: (path: string) => Promise<boolean> = (path) => ReactNativeBlobUtil.fs.exists(path),
): Promise<Map<string, string>> {
  const held = new Map<string, string>()
  for (const node of nodes) {
    if (node.type !== 'file') continue
    const uri = (node.props as { uri?: unknown }).uri
    if (typeof uri !== 'string' || !uri.startsWith('file://')) continue
    try {
      if (await exists(decodeURIComponent(uri.slice('file://'.length)))) held.set(node.id, uri)
    } catch {
      // Unreadable: treated as not held, so the record says its document is missing.
    }
  }
  return held
}

/**
 * Deletes the files behind these uris, quietly — what `forgetDocuments` in
 * `documents.ts` does, kept here so the restore path does not import the
 * picker and React Native, which a node test cannot load.
 */
export async function forgetUris(uris: readonly string[]): Promise<void> {
  for (const uri of new Set(uris)) {
    const path = uri.startsWith('file://') ? decodeURIComponent(uri.slice('file://'.length)) : uri
    try {
      await ReactNativeBlobUtil.fs.unlink(path)
    } catch {
      // Already gone, or not ours to delete: a few kilobytes that go with the app.
    }
  }
}

/**
 * The uris a restore left nothing pointing at: documents of records that are
 * gone. Deleted after the restore succeeds, because the confirmation told the
 * person that what was on this phone goes — and the bytes used to stay,
 * unreachable, in the per-pick folders nothing walks.
 */
export function orphanedUris(
  before: ReadonlyMap<string, string>,
  after: readonly StoredNode[],
): string[] {
  const still = new Set(
    after
      .filter((n) => n.type === 'file')
      .map((n) => (n.props as { uri?: unknown }).uri)
      .filter((u): u is string => typeof u === 'string'),
  )
  return [...new Set(before.values())].filter((uri) => !still.has(uri))
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
    replaceAll: async (documents, keep) => {
      const dir = root()
      try {
        if (await ReactNativeBlobUtil.fs.exists(dir)) {
          // Everything here except a document whose record came back without
          // one (`keep`, see `keptDocuments`). Clearing the whole folder used
          // to delete every document a records-only push brought back.
          for (const name of await ReactNativeBlobUtil.fs.ls(dir)) {
            const id = name.split(BLOB_SEP)[0] ?? ''
            if (!keep.has(id)) await ReactNativeBlobUtil.fs.unlink(`${dir}/${name}`)
          }
        } else {
          await ReactNativeBlobUtil.fs.mkdir(dir)
        }
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
