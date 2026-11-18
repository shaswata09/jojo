import ReactNativeBlobUtil from 'react-native-blob-util'

/**
 * Which paths a file record may name on this phone (review 2026-11-18,
 * security-2).
 *
 * A file record's `uri` is an absolute path, and it is not only the picker that
 * writes it: the assistant's `vault.file.add` / `vault.file.update` take it as a
 * free string, and a backup or Transfer carries whatever the sending device
 * wrote. Every place that then ACTS on the path — the trash's move aside, a
 * wipe's unlink, Open's FileProvider intent, the saved-page viewer, a document
 * read for the model or sent across a Transfer — used to take it as given. A
 * record pointed at `…/databases/RKStorage` was one commit away from the store
 * itself being renamed aside.
 *
 * So the bytes the app touches are the bytes the app put there: every copy it
 * makes lives under its own document directory (`keepLocalCopy`'s UUID folders,
 * `restored/`, `jojo-captures/`), and a path anywhere else is refused — the
 * caller treats it as a document that is not on this device.
 */

/** `file:///a/My%20CV.pdf` → `/a/My CV.pdf`; a bare path is returned as is. */
export const pathOfUri = (uri: string): string =>
  uri.startsWith('file://') ? decodeURIComponent(uri.slice('file://'.length)) : uri

/**
 * The spellings one directory goes by: iOS reaches `/var/…` through
 * `/private/var/…`, and Android's `/data/user/0/<pkg>` is `/data/data/<pkg>`.
 */
function aliasesOf(root: string): string[] {
  const out = [root]
  if (root.startsWith('/private/var/')) out.push(root.slice('/private'.length))
  else if (root.startsWith('/var/')) out.push(`/private${root}`)
  if (root.startsWith('/data/user/0/')) out.push(`/data/data/${root.slice('/data/user/0/'.length)}`)
  else if (root.startsWith('/data/data/'))
    out.push(`/data/user/0/${root.slice('/data/data/'.length)}`)
  return out
}

/**
 * Whether `path` is a file strictly inside `root`. Pure.
 *
 * No `.` or `..` segment anywhere, rather than resolving them: a path the app
 * wrote never has one, so one that does was written by something else. An
 * empty or relative path, an empty root, and the root itself are all refused.
 */
export function isInsideDir(path: string, root: string | undefined): boolean {
  if (!root || !path.startsWith('/')) return false
  if (path.includes('\0')) return false
  if (path.split('/').some((segment) => segment === '.' || segment === '..')) return false
  const base = root.replace(/\/+$/, '')
  if (base === '') return false
  return aliasesOf(base).some((dir) => path.startsWith(`${dir}/`) && path.length > dir.length + 1)
}

/** The app's document directory, read lazily so importing this touches nothing. */
const documentDir = (): string | undefined =>
  (ReactNativeBlobUtil.fs as { dirs?: { DocumentDir?: string } }).dirs?.DocumentDir

/**
 * The filesystem path behind a record's uri — or null when it is not one of
 * this app's own documents, and nothing may be read, moved, deleted or shared
 * through it.
 */
export function ownDocumentPath(uri: string | undefined): string | null {
  if (!uri) return null
  let path: string
  try {
    path = pathOfUri(uri)
  } catch {
    // A malformed escape: not a uri this app wrote.
    return null
  }
  return isInsideDir(path, documentDir()) ? path : null
}
