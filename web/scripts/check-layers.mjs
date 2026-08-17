/**
 * Enforces the import direction inside src/kg, and around src/data.
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

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const KG = path.join(WEB, 'src', 'kg')

/**
 * What each layer may import.
 *
 * `internal` is the set of sibling layers under src/kg. `alias` is the set of
 * `@/…` prefixes outside kg. `packages: false` bans third-party imports
 * outright, which is what "core imports nothing outside core" actually means —
 * not merely "no React".
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
    // Only `repo/seed.ts`, and only to compile the fixtures into nodes and
    // edges. See DATA_READERS — the alias is not enough on its own.
    alias: ['@/data'],
    packages: true,
    react: false,
  },
  tools: {
    label: 'L3 tools',
    internal: ['core', 'tools', 'log'],
    // Only `tools/memory.ts`, which is `memory.reset`. See DATA_READERS.
    alias: ['@/data'],
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
     * `@/data` survives only for tests. See DATA_READERS.
     */
    alias: ['@/data'],
    packages: true,
    react: true,
  },
  log: { label: 'log', internal: ['log'], alias: [], packages: false, react: false },
}

/**
 * The only production modules under src/kg that may import `@/data`.
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

/** Banned everywhere under src/kg: a domain write must not reach up into the UI. */
const UPWARD = ['@/components', '@/routes', '@/kg/../']

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
/** D26: no module under src/kg may import TODAY. Time enters through ctx.now. */
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
  failures.push(`${path.relative(WEB, file)}:${line}  ${message}`)

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
      `imports TODAY from '${spec}'. D26: no module under src/kg may import TODAY — time enters through ToolContext.now.`,
    )
  }

  for (const spec of specsIn(source)) {
    const line = lineOf(source, spec)

    if (UPWARD.some((p) => spec.startsWith(p))) {
      fail(file, line, `imports '${spec}'. Nothing under src/kg may import from the UI.`)
      continue
    }

    // Resolve to a layer, whether spelled relatively or through the alias.
    let target = null
    if (spec.startsWith('.')) {
      const resolved = path.resolve(path.dirname(file), spec)
      if (!resolved.startsWith(KG)) {
        fail(file, line, `reaches outside src/kg with a relative path ('${spec}').`)
        continue
      }
      target = path.relative(KG, resolved)
    } else if (spec.startsWith('@/kg/')) {
      target = spec.slice('@/kg/'.length)
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
      if (
        (spec === '@/data' || spec.startsWith('@/data/')) &&
        !isTest(file) &&
        !DATA_READERS.has(relFromKg.split(path.sep).join('/'))
      ) {
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
 * src/data, which is inside the boundary whether or not it is inside the folder.
 *
 * This file walked `src/kg` and stopped there, and the omission was structural
 * rather than an oversight: `src/data` was described as fixtures, and fixtures
 * are leaves. They are not. `repo/seed.ts` and `tools/memory.ts` import this
 * directory, so anything it imports is reachable from the model — a `react`
 * import here would put React inside `repo`, and an `@/lib` import would put the
 * web app underneath `tools`, and until now nothing looked.
 *
 * The type system does not cover the gap either. `tsconfig.kg.json` pulls in the
 * six `src/data` modules the layer actually reaches and checks them under
 * `"lib": ["ES2023"], "types": []` like everything else — but only those six.
 * `statistics.ts` and `calendar.ts` are reached by no kg module, so they are
 * compiled solely by `tsconfig.app.json`, with DOM in the lib and `vite/client`
 * in the types. They are pure domain code that two probes have recommended
 * moving down; the day someone does, whatever they picked up in the meantime
 * comes with them.
 *
 * What is allowed: sibling `@/data` modules and `@/kg/core`. `core` is where the
 * types these fixtures are annotated with live, and where the date and profile
 * helpers they used to own now live, so the edge points down and stays there.
 * Nothing else — no packages, no React, no `@/lib`, and no `@/kg/repo`,
 * `@/kg/tools` or `@/kg/react`, which would be a fixture reaching back up into
 * the layers that read it. Tests get vitest and the whole of `@/kg`: `seed.test.ts`
 * builds a real repository to assert the fixtures compile into a valid graph,
 * which is exactly the test worth having.
 */
const DATA = path.join(WEB, 'src', 'data')
const DATA_ALIASES = ['@/data', '@/kg/core']

for (const file of walk(DATA)) {
  const source = readFileSync(file, 'utf8')
  const test = isTest(file)

  if (file.endsWith('.tsx')) {
    fail(file, 1, `is .tsx in src/data. Fixtures and domain data are not components.`)
  }

  for (const [, spec] of source.matchAll(TODAY_IMPORT)) {
    fail(
      file,
      lineOf(source, spec),
      `imports TODAY from '${spec}'. D26 applies here too — src/data is read by repo and tools.`,
    )
  }

  for (const spec of specsIn(source)) {
    const line = lineOf(source, spec)

    if (UPWARD.some((p) => spec.startsWith(p))) {
      fail(file, line, `imports '${spec}'. src/data is below the UI, not beside it.`)
      continue
    }
    if (spec.startsWith('.') || DATA_ALIASES.some((a) => spec === a || spec.startsWith(`${a}/`))) {
      continue
    }
    if (spec.startsWith('@/')) {
      if (test && spec.startsWith('@/kg/')) continue
      fail(
        file,
        line,
        `src/data imports '${spec}'. Allowed: ${DATA_ALIASES.join(', ')} (tests may also reach the rest of @/kg). ` +
          `repo/seed.ts and tools/memory.ts import this directory, so anything it imports is reachable from the model.`,
      )
      continue
    }
    if (REACT_PACKAGES.test(spec)) {
      fail(file, line, `src/data imports '${spec}'. Only kg/react may import React.`)
      continue
    }
    if (!(test && TEST_PACKAGES.test(spec))) {
      fail(
        file,
        line,
        `src/data imports the package '${spec}'. It is reachable from repo and tools, which ship on three platforms.`,
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

console.log('check-layers: src/kg and src/data import direction is clean')
