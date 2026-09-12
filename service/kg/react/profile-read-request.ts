import { useSyncExternalStore } from 'react'

/**
 * "Read this document into my profile, now" — asked from anywhere, answered by
 * the offer banner.
 *
 * ## Why it exists
 *
 * The banner (`ProfileUpdateOffer` in each app) is the only thing that reads a
 * document into the profile, and it decides for itself what to ask about:
 * documents it has not asked about before. That is the right rule for an
 * interruption and the wrong one for a person who has just been told, on an
 * application's fit panel, that jojo has read nothing about them. They have a
 * CV in the Vault. They declined the offer once, or it never fired, and there
 * was nowhere to say "that one — read it".
 *
 * ## Why a store and not a prop
 *
 * The banner is mounted above the router, on purpose (see its header), and the
 * places that want to ask — the Profile page's background panel, a Vault row's
 * menu — are routes underneath it with no shared parent but the app. A request
 * has to cross that gap, and a module-level cell with a subscription is the
 * smallest thing that does. It is not the graph: which document somebody is
 * about to be asked about is UI state, and the graph would make it a write
 * they did not make, in a backup they did not want it in.
 *
 * ## What it promises
 *
 * Nothing about consent. Asking to read a document opens the same banner with
 * the same review list, and nothing is written until the person presses Add.
 * The request only decides WHICH document the question is about.
 *
 * Here rather than in either app because the phone has the same banner, the
 * same panel and the same gap between them.
 */

export type ProfileReadRequest = {
  readonly fileId: string
  /** The document's name, for the sentence. */
  readonly name: string
}

let current: ProfileReadRequest | null = null
const listeners = new Set<() => void>()

const notify = (): void => {
  for (const listener of [...listeners]) listener()
}

/** The request standing, if any. A snapshot: stable until it changes. */
export const profileReadRequest = (): ProfileReadRequest | null => current

/**
 * Asks for this document to be offered next.
 *
 * Replaces any standing request: a person who picks a second document before
 * answering about the first has changed their mind, not queued two.
 */
export function requestProfileRead(request: ProfileReadRequest): void {
  if (current?.fileId === request.fileId && current.name === request.name) return
  current = request
  notify()
}

/** The banner has answered it, one way or the other. */
export function clearProfileRead(): void {
  if (current === null) return
  current = null
  notify()
}

export function subscribeProfileRead(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The standing request, live. */
export function useProfileReadRequest(): ProfileReadRequest | null {
  return useSyncExternalStore(subscribeProfileRead, profileReadRequest, profileReadRequest)
}
