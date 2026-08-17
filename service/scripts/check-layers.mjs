/**
 * Enforces the import direction inside kg, and around src/data.
 *
 * The layer rule is the whole architecture: imports point strictly downward,
 * L4 -> L3 -> L2 -> L1 -> L0, never upward. Left to good intentions it survives
 * about two weeks — a tool reaches for a driver singleton because it is right
 * there, `core` imports a React type because the editor auto-imported it, and
 * by the time anyone notices, the boundary that made the model testable without
 * a browser is gone and getting it back is a refactor rather than a revert.
 *
 * So the boundary is greppable in the import line AND checked in `npm run
 * lint`. A violation is a failed lint, not a review comment somebody has to
 * remember to make.
 *
 * Deliberately regex-based rather than AST-based: the thing being matched is a
 * module specifier, which is a string literal at a fixed position in a
 * statement, and a parser dependency to read it would be a layer violation of
 * its own kind. False negatives here are cheap (a weird import spelling goes
 * unchecked); false positives would be expensive, so the patterns are narrow.
 *
 * This file only sees imports. `window.addEventListener` is not an import, so
 * the other half of the boundary — no DOM, no Node built-ins, no wall clock in
 * the portable layers — is enforced by `check-platform.mjs`, which parses
 * because identifiers, unlike module specifiers, cannot be matched by regex
 * without firing on `props.location` and the word "document" in a tool summary.
 * Both run in `npm run lint`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * The package root, not the app root. This guard used to live in `web/scripts/`
 * and resolve to `web/`, which is why mobile's copy of `src/kg` was never
 * checked by it: 18 layer violations sat there unreported for as long as the
 * copy existed. There is one tree now, it is this one, and both apps reach the
 * guard through `npm -w @jojo/service run lint`.
 */
const SERVICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const KG = path.join(SERVICE, 'kg')
/*
 * Declared up here with KG rather than beside the data walk further down,
 * because the kg walk now has to recognise a `../../data/…` specifier as the
 * fixtures. `const` is not hoisted — left where it was, the first `repo/seed.ts`
 * import would have thrown a ReferenceError out of the temporal dead zone
 * instead of reporting a violation.
 */
const DATA = path.join(SERVICE, 'data')

/**
 * What each layer may import.
 *
 * `internal` is the set of sibling layers under kg. `alias` is the set of
 * `@/…` prefixes outside kg — empty for every layer now, and see below.
 * `packages: false` bans third-party imports outright, which is what "core
 * imports nothing outside core" actually means — not merely "no React".
 *
 * Every `alias` list read `['@/data']` for repo, tools and react until the
 * fixtures moved into this package. They are all `[]` now, and the emptiness is
 * the rule rather than a tidy-up: `@/` resolves against the CONSUMING app's
 * root, so the grant that let `repo/seed.ts` read the fixtures on web would have
 * bound the identical line to `mobile/src/data` on the phone. The grant itself
 * survives — the fixtures are `service/data` and DATA_READERS still names the
 * two modules allowed to read them — but it is spelled relatively and enforced
 * in the relative branch of the walk.
 */
const RULES = {
  core: {
    label: 'L1 core',
    internal: ['core'],
    alias: [],
    packages: false,
    react: false,
  },
  storage: {
    label: 'L0 storage',
    // Never `core`. This layer moves opaque JSON blobs plus a primary key; if
    // storage learns what an application is, the boundary has already failed.
    internal: ['storage'],
    alias: [],
    packages: true,
    react: false,
  },
  repo: {
    label: 'L2 repo',
    internal: ['core', 'storage', 'repo', 'log'],
    // `repo/seed.ts` compiles the fixtures into nodes and edges. It reads them
    // as `../../data/…` now; see DATA_READERS.
    alias: [],
    packages: true,
    react: false,
  },
  tools: {
    label: 'L3 tools',
    internal: ['core', 'tools', 'log'],
    // `tools/memory.ts` is `memory.reset`, and reads `../../data/…`. See
    // DATA_READERS.
    alias: [],
    packages: true,
    react: false,
    // A tool takes the Repository INTERFACE. Never a driver, never a
    // singleton — a tool that reaches for the live repo cannot be run inside
    // someone else's transaction, which is the one thing `ctx.call` needs.
    allow: ['repo/repository', 'repo/journal'],
  },
  react: {
    label: 'L4 react',
    internal: ['core', 'storage', 'repo', 'tools', 'react', 'log'],
    /*
     * `@/lib` is gone, and it is worth saying why rather than leaving a shorter
     * list. It was allowed here because the toast context used to live in
     * `src/lib`; the interface moved to `kg/react/toast.ts` and only the web
     * adapter stayed behind. Since then `check-platform.mjs` has banned the same
     * import as a DOM module — so the two guards disagreed, and only the second
     * one was load-bearing. A rule that another rule already contradicts is a
     * rule nobody can reason from: whichever file you read first tells you the
     * wrong thing. There are no `@/lib` imports under `kg/react` to remove.
     *
     * Nothing replaced it. `projections.test.ts` reaches the fixtures, and it
     * does so relatively like everything else in the package.
     */
    alias: [],
    packages: true,
    react: true,
  },
  log: { label: 'log', internal: ['log'], alias: [], packages: false, react: false },
}

/**
 * The only production modules under kg that may import `@/data`.
 *
 * The alias on its own was never the rule anyone meant. The comment above `repo`
 * used to read "`repo/seed.ts` … is the only reader of them in the whole layer",
 * and it was false by a factor of six: `tools/support.ts` took `daysBetween` and
 * re-exported `STAGE_LABEL`, `tools/application.ts` and two siblings took
 * `shortDate`, `tools/keyword.ts` took a colour list, and four modules under
 * `kg/react` took date selectors, `profileIsBlank` and the stage vocabulary. A
 * grant written for two files had quietly become a grant for twelve, and the
 * comment describing it stayed accurate-sounding the whole time.
 *
 * It matters beyond tidiness because `@/…` resolves against the CONSUMER's
 * project root. The Expo app in `mobile/` maps `@/*` to its own `src`, so a
 * shared `kg/tools/timeline.ts` asking for `@/data/timeline` gets
 * `mobile/src/data/timeline.ts` — a file that exists, that has drifted from this
 * one, and that fails no check. The failure mode is not a missing module; it is
 * the wrong module, silently. Everything the service layer actually needed moved
 * into `kg/core` (`dates.ts`, `profile.ts`, `STAGE_LABEL` in `model.ts`), and
 * what is left here is genuinely the demo dataset.
 *
 * Tests are exempt. A test that seeds from the same fixture the seeder reads is
 * asserting against the real input, which is the point of it; the hazard above
 * is about code that SHIPS.
 */
const DATA_READERS = new Set(['repo/seed.ts', 'tools/memory.ts'])

/** Banned everywhere under kg: a domain write must not reach up into the UI. */
const UPWARD = ['@/components', '@/routes', '@/kg/../']

/**
 * The package must never import itself by name. Measured, not theorised.
 *
 * With the fixtures relative, `tools/keyword.ts` writing `'../../data/labels'`
 * is reported by DATA_READERS below. The same file writing
 * `'@jojo/service/data/labels'` was reported by nothing at all — it is a bare
 * specifier, so it fell past the relative branch and past the `@/` branch and
 * out the far side as an ordinary package import, which `tools` is allowed to
 * make. The transcript read "check-layers: kg and data import direction is
 * clean", which is the worst possible output for an import that had just
 * side-stepped the allowlist.
 *
 * So the rule that keeps this package 100% relative internally is now a check
 * rather than a habit. Two independent reasons it has to hold anyway: the
 * exports map is a TYPE-level boundary and Metro was measured falling back to
 * file-based resolution with a warning rather than an error on an undeclared
 * subpath, and a self-import re-enters through the workspace symlink, which
 * gives the bundler a second copy of a module the graph expects to be a
 * singleton.
 */
const SELF = '@jojo/service'
const isSelfImport = (spec) => spec === SELF || spec.startsWith(`${SELF}/`)

const REACT_PACKAGES = /^(react|react-dom|react-router|@react-|radix-ui|cmdk|lucide-react)/

/**
 * The two packages a `*.test.ts` may import in a layer that bans packages.
 *
 * `core` and `log` are the layers that must import nothing, and their tests
 * still have to say `import { describe } from 'vitest'`. Exempting the whole
 * `packages` rule for test files would let `idb` into a core test and, from
 * there, into the module it is testing; naming the two runners keeps the ban
 * exactly as strict for everything that ships.
 */
const TEST_PACKAGES = /^(vitest|fake-indexeddb)(\/|$)/
const isTest = (file) => /\.test\.tsx?$/.test(file)

const IMPORT = /(?:^|\n)\s*(?:import|export)\b[^\n;]*?from\s*['"]([^'"]+)['"]/g
const BARE_IMPORT = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g
const DYNAMIC = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
/** D26: no module under kg may import TODAY. Time enters through ctx.now. */
const TODAY_IMPORT = /(?:^|\n)\s*import\b[^\n;]*?\bTODAY\b[^\n;]*?from\s*['"]([^'"]+)['"]/g

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

/** 'core/model.ts' -> 'core'; 'log.ts' -> 'log'. */
const layerOf = (relFromKg) => {
  const first = relFromKg.split(path.sep)[0]
  return first.endsWith('.ts') ? path.basename(first, '.ts') : first
}

const lineOf = (source, spec) => {
  const at =
    source.indexOf(`'${spec}'`) >= 0 ? source.indexOf(`'${spec}'`) : source.indexOf(`"${spec}"`)
  return at < 0 ? 1 : source.slice(0, at).split('\n').length
}

const specsIn = (source) =>
  [IMPORT, BARE_IMPORT, DYNAMIC].flatMap((re) => [...source.matchAll(re)].map((m) => m[1]))

const failures = []
const fail = (file, line, message) =>
  failures.push(`${path.relative(SERVICE, file)}:${line}  ${message}`)

for (const file of walk(KG)) {
  const relFromKg = path.relative(KG, file)
  const layer = layerOf(relFromKg)
  const rule = RULES[layer]
  const source = readFileSync(file, 'utf8')

  if (!rule) {
    fail(file, 1, `sits in an unknown layer '${layer}'. Add it to RULES or move the file.`)
    continue
  }

  // Only the React layer may be .tsx. A component anywhere else means a layer
  // has grown a UI and the import ban below is about to be worked around.
  if (file.endsWith('.tsx') && layer !== 'react') {
    fail(file, 1, `is .tsx in ${rule.label}. Only kg/react may contain components.`)
  }

  for (const [, spec] of source.matchAll(TODAY_IMPORT)) {
    fail(
      file,
      lineOf(source, spec),
      `imports TODAY from '${spec}'. D26: no module under kg may import TODAY — time enters through ToolContext.now.`,
    )
  }

  for (const spec of specsIn(source)) {
    const line = lineOf(source, spec)

    if (UPWARD.some((p) => spec.startsWith(p))) {
      fail(file, line, `imports '${spec}'. Nothing under kg may import from the UI.`)
      continue
    }

    if (isSelfImport(spec)) {
      fail(
        file,
        line,
        `imports this package by name ('${spec}'). Write it relative. A bare '@jojo/service/…' ` +
          `specifier is invisible to every allowlist in this file, and it re-enters through the `+
          `workspace symlink as a second copy of a module the graph expects to be a singleton.`,
      )
      continue
    }

    // Resolve to a layer, whether spelled relatively or through the alias.
    let target = null
    if (spec.startsWith('.')) {
      const resolved = path.resolve(path.dirname(file), spec)
      /*
       * `../../data/…` is the fixtures, and it is the one relative path that
       * leaves `kg/` legitimately.
       *
       * It has to be recognised HERE rather than allowed by the escape check
       * below, because the fixtures moving into this package turned the reader
       * grant inside out. DATA_READERS was written in `@/` vocabulary and the
       * `@/data/…` branch further down is what enforces it; once `repo/seed.ts`
       * and `tools/memory.ts` say `../../data/seed` instead, that branch never
       * runs and the only thing left to see the import was the escape check,
       * which reported all 22 of them as violations and knew nothing about who
       * was allowed to write them. Routing the sibling edge into the same slot
       * keeps the allowlist meaning what its comment says.
       *
       * The `@jojo/service/data/…` spelling is the trap this avoids: it is a
       * bare package specifier, so it lands in neither branch and reads as
       * clean. That is why the package is 100% relative internally.
       */
      if (resolved.startsWith(DATA + path.sep)) {
        if (!isTest(file) && !DATA_READERS.has(relFromKg.split(path.sep).join('/'))) {
          fail(
            file,
            line,
            `imports the demo fixtures ('${spec}'). Only ${[...DATA_READERS].join(' and ')} may — ` +
              `see DATA_READERS in this file. If what you want is date maths, the stage labels or an ` +
              `empty profile, they are in kg/core (dates.ts, model.ts, profile.ts) and always were the model's.`,
          )
        }
        continue
      }
      if (!resolved.startsWith(KG)) {
        fail(file, line, `reaches outside kg/ with a relative path ('${spec}').`)
        continue
      }
      target = path.relative(KG, resolved)
    } else if (spec.startsWith('@/kg/')) {
      /*
       * This package is 100% relative internally, and the reason is mechanical
       * rather than stylistic.
       *
       * `@/` resolves against the CONSUMER's project root, so a `@/kg/…` line in
       * here binds to whichever app is doing the importing — and mobile maps
       * `@/*` to its own `src`, which is where the drifted copy used to live.
       * That is the "not a missing module, the WRONG module" hazard, and it
       * predates the extraction.
       *
       * The harder reason is that on mobile the specifier cannot resolve at all.
       * Expo's tsconfig-paths resolver bails out entirely when the importing
       * module's path contains `/node_modules/`, and this package is reached
       * through a workspace symlink under the root `node_modules`, so every
       * module in it matches. The failure is at bundle time, on a device, with
       * no compile-time warning anywhere — which is why it is a lint rule and
       * not a convention.
       */
      fail(
        file,
        line,
        `imports '${spec}'. Nothing under kg/ may use the '@/' alias to reach a sibling — ` +
          `write it relative ('${path.relative(path.dirname(file), path.join(KG, spec.slice('@/kg/'.length))).replace(/^(?!\.)/, './')}'). ` +
          `'@/' resolves against the importing APP's root, and Expo's resolver ignores it entirely ` +
          `for a module reached through node_modules — which this package always is on mobile.`,
      )
      continue
    }

    if (target !== null) {
      const targetLayer = layerOf(target)
      const allowed =
        rule.internal.includes(targetLayer) ||
        (rule.allow ?? []).some((a) => target === a || target.startsWith(`${a}.`))
      if (!allowed) {
        fail(
          file,
          line,
          `${rule.label} imports ${targetLayer} ('${spec}'). Allowed: ${rule.internal.join(', ') || 'nothing'}.`,
        )
      }
      continue
    }

    if (spec.startsWith('@/')) {
      if (!rule.alias.some((a) => spec === a || spec.startsWith(`${a}/`))) {
        fail(
          file,
          line,
          `${rule.label} imports '${spec}'. Allowed aliases: ${rule.alias.join(', ') || 'none'}.`,
        )
        continue
      }
      continue
    }

    if (!rule.react && REACT_PACKAGES.test(spec)) {
      fail(file, line, `${rule.label} imports '${spec}'. Only kg/react may import React.`)
      continue
    }

    if (!rule.packages && !(isTest(file) && TEST_PACKAGES.test(spec))) {
      fail(
        file,
        line,
        `${rule.label} imports the package '${spec}'. This layer must import nothing outside itself.`,
      )
    }
  }
}

/* -------------------------------------------------------------------------- */

/**
 * `data/`, which is inside the boundary whether or not it is inside `kg/`.
 *
 * This file walked `kg` and stopped there, and the omission was structural
 * rather than an oversight: the fixtures were described as leaves. They are not.
 * `repo/seed.ts` and `tools/memory.ts` import this directory, so anything it
 * imports is reachable from the model — a `react` import here would put React
 * inside `repo`, and an `@/lib` import would have put the web app underneath
 * `tools`, and until now nothing looked.
 *
 * The type system used not to cover the gap either, and that half is now closed
 * by the move rather than by this script. `tsconfig.core.json` pulled in the six
 * fixture modules the layer actually reached and checked them under
 * `"lib": ["ES2023"], "types": []` like everything else — but only those six.
 * `statistics.ts` and `calendar.ts` were reached by no kg module, so they were
 * compiled solely by web's `tsconfig.app.json`, with DOM in the lib and
 * `vite/client` in the types. They were pure domain code that two probes had
 * recommended moving down; they are `kg/core/statistics.ts` and
 * `kg/core/calendar.ts` now, and whatever they had picked up in the meantime
 * came with them — eight `noUncheckedIndexedAccess` errors, fixed on arrival.
 *
 * What is allowed: siblings in `data/`, and `kg/core`. `core` is where the types
 * these fixtures are annotated with live, and where the date and profile helpers
 * they used to own now live, so the edge points down and stays there. Nothing
 * else — no packages, no React, no app code, and no `kg/repo`, `kg/tools` or
 * `kg/react`, which would be a fixture reaching back up into the layers that
 * read it. Tests get vitest and the whole of `kg`: `seed.test.ts` builds a real
 * repository to assert the fixtures compile into a valid graph, which is exactly
 * the test worth having.
 *
 * All of it is spelled relatively now. The `@/data` and `@/kg/core` aliases that
 * used to be the permitted list are gone with the move — `@/` resolves against
 * the consuming APP's root, so it was never a specifier this package could keep
 * once mobile started importing it.
 */
for (const file of walk(DATA)) {
  const source = readFileSync(file, 'utf8')
  const test = isTest(file)

  if (file.endsWith('.tsx')) {
    fail(file, 1, `is .tsx in data/. Fixtures and domain data are not components.`)
  }

  for (const [, spec] of source.matchAll(TODAY_IMPORT)) {
    fail(
      file,
      lineOf(source, spec),
      `imports TODAY from '${spec}'. D26 applies here too — data/ is read by repo and tools.`,
    )
  }

  for (const spec of specsIn(source)) {
    const line = lineOf(source, spec)

    if (UPWARD.some((p) => spec.startsWith(p))) {
      fail(file, line, `imports '${spec}'. data/ is below the UI, not beside it.`)
      continue
    }

    if (isSelfImport(spec)) {
      fail(
        file,
        line,
        `imports this package by name ('${spec}'). Write it relative. A bare '@jojo/service/…' ` +
          `specifier is invisible to every allowlist in this file, and it re-enters through the `+
          `workspace symlink as a second copy of a module the graph expects to be a singleton.`,
      )
      continue
    }
    if (spec.startsWith('.')) {
      /*
       * A relative path used to be waved through here, which was safe only
       * because the fixtures lived in a different package from `kg` and could
       * not reach it relatively at all — the alias list was doing the work. Now
       * that both are in `service/`, `../kg/repo/boot` is one plausible typo
       * away and would invert the whole direction, so the target is resolved and
       * classified instead of trusted.
       */
      const resolved = path.resolve(path.dirname(file), spec)
      if (resolved.startsWith(DATA + path.sep)) continue
      if (resolved.startsWith(KG + path.sep)) {
        const targetLayer = layerOf(path.relative(KG, resolved))
        if (targetLayer === 'core' || (test && RULES[targetLayer])) continue
        fail(
          file,
          line,
          `data/ imports ${targetLayer} ('${spec}'). Only kg/core — the fixtures are the input to ` +
            `repo/seed.ts and tools/memory.ts, so an edge back up into those layers is a cycle.`,
        )
        continue
      }
      fail(file, line, `data/ reaches outside the package with a relative path ('${spec}').`)
      continue
    }
    if (spec.startsWith('@/')) {
      fail(
        file,
        line,
        `data/ imports '${spec}'. This package is 100% relative internally: '@/' resolves against ` +
          `the consuming APP's root, so on mobile this binds to mobile/src — a different module, silently.`,
      )
      continue
    }
    if (REACT_PACKAGES.test(spec)) {
      fail(file, line, `data/ imports '${spec}'. Only kg/react may import React.`)
      continue
    }
    if (!(test && TEST_PACKAGES.test(spec))) {
      fail(
        file,
        line,
        `data/ imports the package '${spec}'. It is reachable from repo and tools, which ship on three platforms.`,
      )
    }
  }
}

if (failures.length > 0) {
  console.error(`\ncheck-layers: ${failures.length} layer violation(s)\n`)
  for (const f of failures) console.error(`  ${f}`)
  console.error('\nThe rule: imports point strictly downward, L4 -> L3 -> L2 -> L1 -> L0.')
  console.error('See docs/KG-ARCHITECTURE.md §2.\n')
  process.exit(1)
}

console.log('check-layers: kg and data import direction is clean')
