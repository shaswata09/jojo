/**
 * The outside-the-router check, run on this app and on planted trees.
 *
 * A guard is only worth its line in `lint` if it demonstrably fails on the bug
 * it names. So the walk — `scripts/outside-router.mjs`, the same file the lint
 * runs — is exercised here against this app's own sources, then against those
 * sources with the 2026-09-11 line planted back in, then against small trees
 * built for one rule each. Everything is held in memory: nothing on disk is
 * touched, which matters in a tree another session may be editing.
 */
import { describe, expect, it } from 'vitest'
import { findOutsideRouterUse } from '../../scripts/outside-router.mjs'

type Files = Record<string, string>

const walk = (files: Files) =>
  findOutsideRouterUse({ read: (path) => files[path] ?? null, isFile: (path) => path in files })

/** This app's sources as the build sees them, keyed relative to `src`. */
const APP_SOURCES: Files = Object.fromEntries(
  Object.entries(
    import.meta.glob('/src/**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>,
  ).map(([key, text]) => [key.replace(/^\/src\//, ''), text]),
)

const DIALOG = 'components/applications/AddFromLinkDialog.tsx'

describe('the check, on this app', () => {
  it('passes: nothing drawn outside the router uses it', () => {
    const out = walk(APP_SOURCES)
    expect(out.offenders).toEqual([])
    // Derived from main.tsx, not listed: the dialog host and the approval host
    // are among the roots, and App — where the router starts — is not.
    expect(out.roots).toContain('lib/dialogs.tsx')
    expect(out.roots).toContain('components/assistant/ApprovalHost.tsx')
    expect(out.roots).not.toContain('App.tsx')
  })

  it('would have caught the 2026-09-11 crash: HEAD’s line, planted back in', () => {
    const planted = {
      ...APP_SOURCES,
      [DIALOG]: `import { useNavigate } from 'react-router'\n${APP_SOURCES[DIALOG] ?? ''}`,
    }
    expect(walk(planted).offenders).toEqual([
      { file: DIALOG, root: 'lib/dialogs.tsx', names: ['useNavigate'] },
    ])
  })

  it('would catch the router coming back into links.ts, which the dialogs import for paths', () => {
    const planted = {
      ...APP_SOURCES,
      'lib/links.ts': `import { useSearchParams } from 'react-router'\n${APP_SOURCES['lib/links.ts'] ?? ''}`,
    }
    expect(walk(planted).offenders.map((o) => o.file)).toEqual(['lib/links.ts'])
  })
})

/** The shape of the real `main.tsx`: hosts beside `App`, the router inside `App`. */
const main = (...hosts: string[]) =>
  [
    "import App from '@/App'",
    ...hosts.map((h, i) => `import { host${String(i)} } from '@/${h}'`),
  ].join('\n')

const APP =
  "import { BrowserRouter, useNavigate } from 'react-router'\nexport default function App() {}\n"

describe('the check, on planted trees', () => {
  it('fails on a <Link>, which throws outside the router just as a hook does', () => {
    const out = walk({
      'main.tsx': main('lib/toast'),
      'App.tsx': APP,
      'lib/toast.tsx': "import { Link } from 'react-router'\n",
    })
    expect(out.offenders).toEqual([
      { file: 'lib/toast.tsx', root: 'lib/toast.tsx', names: ['Link'] },
    ])
  })

  it('follows the import graph through a re-export, however deep the hook is', () => {
    const out = walk({
      'main.tsx': main('lib/host'),
      'App.tsx': APP,
      'lib/host.tsx': "import { a } from './a'\n",
      'lib/a.ts': "export { b } from '../shared/b'\n",
      'shared/b.ts': "import {\n  useLocation,\n  useSearchParams,\n} from 'react-router'\n",
    })
    expect(out.offenders).toEqual([
      { file: 'shared/b.ts', root: 'lib/host.tsx', names: ['useLocation', 'useSearchParams'] },
    ])
  })

  it('follows a lazy import() — the component renders in the same place, a chunk later', () => {
    const out = walk({
      'main.tsx': main('lib/host'),
      'App.tsx': APP,
      'lib/host.tsx': "import { lazy } from 'react'\nconst Later = lazy(() => import('./Later'))\n",
      'lib/Later.tsx': "import { useParams } from 'react-router'\n",
    })
    expect(out.offenders.map((o) => o.file)).toEqual(['lib/Later.tsx'])
  })

  it('lets a type through — it is erased at build and needs no router', () => {
    const out = walk({
      'main.tsx': main('lib/host'),
      'App.tsx': APP,
      'lib/host.tsx':
        "import type { NavigateFunction } from 'react-router'\nimport { type Location } from 'react-router'\n",
    })
    expect(out.offenders).toEqual([])
  })

  it('does not let a value ride in beside a type', () => {
    const out = walk({
      'main.tsx': main('lib/host'),
      'App.tsx': APP,
      'lib/host.tsx': "import { type Location, useNavigate } from 'react-router'\n",
    })
    expect(out.offenders[0]?.names).toEqual(['useNavigate'])
  })

  it('counts a namespace import as a value', () => {
    const out = walk({
      'main.tsx': main('lib/host'),
      'App.tsx': APP,
      'lib/host.tsx': "import * as Router from 'react-router'\n",
    })
    expect(out.offenders[0]?.names).toEqual(['* as Router'])
  })

  it('leaves App and everything only App reaches alone — that is inside the router', () => {
    const out = walk({
      'main.tsx': main('lib/host'),
      'App.tsx': "import { Route } from './route'\nexport default function App() {}\n",
      'route.tsx': "import { useParams } from 'react-router'\n",
      'lib/host.tsx': '',
    })
    expect(out.offenders).toEqual([])
  })

  it('covers a provider the day it is added to main.tsx, with no list to update', () => {
    const out = walk({
      'main.tsx': main('lib/host', 'lib/brandNewProvider'),
      'App.tsx': APP,
      'lib/host.tsx': '',
      'lib/brandNewProvider.tsx': "import { useNavigate } from 'react-router'\n",
    })
    expect(out.offenders.map((o) => o.file)).toEqual(['lib/brandNewProvider.tsx'])
  })

  /*
   * The five that walked past the first, regex-based version — found by an
   * adversarial review on 2026-09-11 and reproduced before this was rewritten
   * on TypeScript's parser. Each is pinned so it cannot come back.
   */
  it('catches a barrel that re-exports a router value, by the name it was imported as', () => {
    const out = walk({
      'main.tsx': main('lib/host'),
      'App.tsx': APP,
      'lib/host.tsx': "import { go } from './nav'\n",
      'lib/nav.ts': "export { useNavigate as go } from 'react-router'\n",
    })
    expect(out.offenders).toEqual([
      { file: 'lib/nav.ts', root: 'lib/host.tsx', names: ['useNavigate'] },
    ])
  })

  it('catches export * from the router, and lets export type through', () => {
    const star = walk({
      'main.tsx': main('lib/nav'),
      'App.tsx': APP,
      'lib/nav.ts': "export * from 'react-router'\n",
    })
    expect(star.offenders[0]?.names).toEqual(['*'])
    const types = walk({
      'main.tsx': main('lib/nav'),
      'App.tsx': APP,
      'lib/nav.ts': "export type { NavigateFunction } from 'react-router'\n",
    })
    expect(types.offenders).toEqual([])
  })

  it('catches the router loaded with import()', () => {
    const out = walk({
      'main.tsx': main('lib/host'),
      'App.tsx': APP,
      'lib/host.tsx': "const { useNavigate } = await import('react-router')\n",
    })
    expect(out.offenders[0]?.names).toEqual(["import('react-router')"])
  })

  it('is not thrown by an apostrophe in a comment inside an import clause', () => {
    const out = walk({
      'main.tsx': main('lib/host'),
      'App.tsx': APP,
      'lib/host.tsx': "import {\n  // the dialog's own wrapper\n  Wrapped,\n} from './wrapped'\n",
      'lib/wrapped.tsx': "import { Link } from 'react-router'\n",
    })
    expect(out.offenders.map((o) => o.file)).toEqual(['lib/wrapped.tsx'])
  })

  it('follows an import() written as a template literal', () => {
    const out = walk({
      'main.tsx': main('lib/host'),
      'App.tsx': APP,
      'lib/host.tsx': 'const later = import(`./late`)\n',
      'lib/late.tsx': "import { Link } from 'react-router'\n",
    })
    expect(out.offenders.map((o) => o.file)).toEqual(['lib/late.tsx'])
  })

  it('passes correct code: an import above a type-only router import is not a use', () => {
    // The regex version reported "foo } from './foo'\nimport type { NavigateFunction"
    // here, and failed lint on code that was right.
    const out = walk({
      'main.tsx': main('lib/host'),
      'App.tsx': APP,
      'lib/host.tsx':
        "import { foo } from './foo'\nimport type { NavigateFunction } from 'react-router'\n",
      'lib/foo.ts': 'export const foo = 1\n',
    })
    expect(out.offenders).toEqual([])
  })

  it('reads a URL in a string as a string, not a comment', () => {
    const out = walk({
      'main.tsx': main('lib/host'),
      'App.tsx': APP,
      'lib/host.tsx':
        "const board = 'https://job-boards.greenhouse.io/x'\nimport { Link } from 'react-router'\n",
    })
    expect(out.offenders[0]?.names).toEqual(['Link'])
  })

  it('refuses to pass when there is no main.tsx to walk from', () => {
    expect(() => walk({ 'App.tsx': APP })).toThrow(/main\.tsx/)
  })
})
