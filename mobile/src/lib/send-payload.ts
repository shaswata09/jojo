/**
 * What this phone hands a computer that pulls from it: a whole backup, as bytes.
 *
 * The same format a backup file has (`core/backup.ts`), because the computer
 * runs what arrives through the same reader and the same restore as a file
 * opened under Settings. A third shape would be a third thing to keep in step.
 *
 * ## Why the documents travel, unlike the Settings export
 *
 * The clipboard export leaves document bytes out because one PDF overflows
 * Android's Binder buffer (`phone-backup.ts`). A transfer has no such cap. And
 * leaving them out here would not be a smaller transfer but a destructive one:
 * the computer's restore REPLACES every document it holds with the ones in the
 * backup, so an empty list would clear the computer's documents and land this
 * phone's file records pointing at nothing. Every document that can be read
 * goes; one that cannot is counted, so the screen can say so.
 *
 * ## Why the bytes are ASCII
 *
 * Hermes has no `TextEncoder` this app can rely on. `asciiJsonBytes` escapes
 * every non-ASCII character as JSON's own `\uXXXX`, so the string is one byte
 * per character and parses back to the same records — see `core/handoff-pull.ts`.
 *
 * Pure: the document reader is passed in, so a test hands it a map and the
 * phone hands it the file system.
 */

import { buildBackup } from '@jojo/service/core/backup'
import { blobPath } from '@jojo/service/core/blob-path'
import { asciiJsonBytes } from '@jojo/service/core/handoff-pull'
import type { StoredEdge, StoredNode } from '@jojo/service/core/model'

export type SendPayloadInput = {
  /** From the injected clock. */
  exportedAt: string
  nodes: readonly StoredNode[]
  edges: readonly StoredEdge[]
  /** The readable half, as the Settings export carries it. */
  readable?: unknown
  /** A document's bytes by its stored uri, or null if it will not read. */
  readDocument: (uri: string) => Promise<Uint8Array | null>
}

export type SendPayload = {
  bytes: Uint8Array
  /** Documents that went in. */
  documents: number
  /** File records with a copy on this phone that could not be read. */
  unreadable: number
}

export async function buildSendPayload(input: SendPayloadInput): Promise<SendPayload> {
  const documents: { path: string; data: Uint8Array }[] = []
  let unreadable = 0

  for (const node of input.nodes) {
    if (node.type !== 'file') continue
    const props = node.props as { uri?: unknown; name?: unknown }
    // A file record with no copy on this phone — a link to a document kept
    // elsewhere — has nothing to send, and is not a failure.
    if (typeof props.uri !== 'string' || props.uri.length === 0) continue
    let data: Uint8Array | null
    try {
      data = await input.readDocument(props.uri)
    } catch {
      data = null
    }
    if (data === null) {
      unreadable += 1
      continue
    }
    // `blobPath`, keyed by the record's id, which is what the computer's
    // document store files it under — the same path a computer's own backup
    // writes, so the restore cannot tell where the file came from.
    const name = typeof props.name === 'string' && props.name.length > 0 ? props.name : 'document'
    documents.push({ path: blobPath(node.id, name), data })
  }

  const backup = buildBackup({
    exportedAt: input.exportedAt,
    nodes: input.nodes,
    edges: input.edges,
    documents,
    ...(input.readable === undefined ? {} : { readable: input.readable }),
  })
  return { bytes: asciiJsonBytes(JSON.stringify(backup)), documents: documents.length, unreadable }
}
