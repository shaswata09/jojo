/**
 * Fails when something drawn outside the router reaches for the router.
 *
 * ## The bug this is a mechanism for
 *
 * `main.tsx` mounts `DialogHost`, `ApprovalHost` and a stack of providers
 * BESIDE `<App />`, and the router only starts inside `App`. That is deliberate
 * — a dialog and an agent's approval have to outlive the page that raised them —
 * and its price is that every React Router API throws in all of them, at
 * render: "useNavigate() may be used only in the context of a <Router>
 * component". The root boundary catches it and replaces the whole app with
 * "Something broke". On 2026-09-11 "+ From link" opened `AddFromLinkDialog`,
 * which called `useNavigate` for a toast that linked to the Vault, and pasting a
 * posting link took the app down.
 *
 * ## Why prose failed
 *
 * `dialogs.tsx` already said so: "nothing reachable from here may call
 * `useNavigate`, `useParams` or `useSearchParams`. None of the three dialogs
 * below does today." The fourth dialog did, from the day it was written, and
 * the sentence went on saying three. The phone lost the same bet the same way
 * and answered it with `mobile/scripts/check-overlays.mjs`; this is that check
 * for the web. The hook is correct code — every route uses it — so neither `tsc`
 * nor `oxlint` has anything to say. Only the POSITION is wrong, and position is
 * what this checks.
 *
 * ## What it does
 *
 * Walks the local import graph out of every module `main.tsx` imports except
 * `App` — static imports, `export … from`, and literal `import()` — and fails
 * if any module it reaches takes a VALUE from `react-router`, by import,
 * re-export or dynamic import. Values, not hooks: a `<Link>` throws outside the
 * router too (see `hrefOutsideRouter` in `lib/links.ts`), and so does
 * `<Navigate>`. A TYPE import is erased at build and needs no context, so it
 * passes. The reading is done by TypeScript's parser, in `outside-router.mjs`,
 * which says why a regular expression was not good enough.
 *
 * Transitive on purpose, for the phone's reason: the crash does not care
 * whether the hook is called by the dialog or three components inside it. A
 * module shared with a route that trips this is not a false positive — it
 * renders in both places and crashes in one.
 *
 * ## Why the roots are derived here and listed on the phone
 *
 * The phone's overlays are drawn from two files and some of them are drawn by a
 * provider, so its roots are a hand-kept list. Here `main.tsx` IS the list:
 * everything it imports other than `App` either renders beside the router or
 * runs before it exists. Deriving them means a provider added tomorrow is
 * covered the day it lands — one was added while this file was being written.
 *
 * The fix is always the same: a dialog that needs to go somewhere closes and
 * lets the route that opened it navigate — pass it a callback, or open the next
 * dialog — or it links with `<a href={hrefOutsideRouter(path)}>` when a full page
 * load is what is wanted. Navigating from a dialog while it stays open changes
 * the page underneath a modal the person is still using.
 *
 * The walk itself is `outside-router.mjs`, pure, so the web tests run the same
 * code against planted trees and this app's own sources. This file is the part
 * that reads the disk and exits. An optional argument names a different `src`,
 * which is how a copy with an offender planted in it is checked.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findOutsideRouterUse } from './outside-router.mjs'

const SRC = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/** A '/'-separated path relative to `src`, on this machine's disk. */
const onDisk = (path) => join(SRC, ...path.split('/'))

let result
try {
  result = findOutsideRouterUse({
    read: (path) => {
      try {
        return readFileSync(onDisk(path), 'utf8')
      } catch {
        return null
      }
    },
    isFile: (path) => existsSync(onDisk(path)) && statSync(onDisk(path)).isFile(),
  })
} catch (error) {
  console.error(`check-outside-router: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

if (result.offenders.length > 0) {
  console.error('check-outside-router: the router is reachable from outside it.\n')
  console.error('These modules are drawn beside <App /> in main.tsx, where the router has not')
  console.error('started, so each of these throws at render and the root boundary replaces')
  console.error('the whole app with "Something broke".\n')
  for (const { file, root, names } of result.offenders) {
    console.error(`  ${file} imports ${names.join(', ')}`)
    if (root !== file) console.error(`    reached from ${root}`)
  }
  console.error(
    '\nClose the dialog and let the route that opened it navigate (pass it a callback),',
  )
  console.error('or link with an <a href={hrefOutsideRouter(path)}> when a page load is wanted.')
  process.exit(1)
}

console.log(
  `check-outside-router: nothing drawn outside the router uses it (${String(result.roots.length)} roots, ${String(result.modules)} modules)`,
)
