/**
 * Types for `licence-notices.mjs`, which is JavaScript because the web build
 * (`vite.config.ts`) and the phone's generator (`mobile/scripts/
 * third-party-notices.mjs`) run it with bare `node`, and the tests import the
 * same file they do.
 */

export type SharedKind = 'Apache-2.0' | 'MIT' | 'ISC'

export type NoticeText = { file: string; text: string }

export type PackageNotice = {
  name: string
  version: string
  licence: string | null
  texts: NoticeText[]
  notices: NoticeText[]
  missing: string | null
  shared: SharedKind[]
}

export type TreePackage = { name: string; version: string; dir: string }

export declare const APACHE_2_TEXT: string
export declare const MIT_BODY: string
export declare const ISC_BODY: string
export declare const SHARED_TEXTS: Record<SharedKind, string>
export declare const SHARED_LABEL: Record<SharedKind, string>

export declare function cutShared(
  text: string,
  kinds: readonly SharedKind[],
): { text: string; shared: SharedKind[] }
export declare function licenceFiles(dir: string): { licence: NoticeText[]; notice: NoticeText[] }
export declare function statedLicence(manifest: Record<string, unknown>): string | null
export declare function noticeFor(dir: string, share?: readonly SharedKind[]): PackageNotice
export declare function byNameAndVersion(
  a: { name: string; version: string },
  b: { name: string; version: string },
): number
export declare function resolvePackage(name: string, from: string, top?: string): string | null
export declare function productionTree(root: string, top?: string): TreePackage[]
export declare function uniqueNotices(notices: readonly PackageNotice[]): PackageNotice[]
export declare function renderNotices(input: {
  title: string
  preface: string
  notices: readonly PackageNotice[]
  extra?: readonly { heading: string; text: string }[]
}): string
