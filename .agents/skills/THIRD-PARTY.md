# Third-party skills in this directory

Every skill in `.agents/skills/` was written by somebody else. None of it is
jojo's own work, and none of it is covered by jojo's Apache-2.0 licence: the
`LICENSE` and `NOTICE` at the repository root grant rights only in what jojo's
authors wrote, and they cannot grant rights in this.

These files are **development tooling only**. They are instructions for a
coding agent (Claude Code and similar) working on this repository. Nothing in
the web app, the browser extension, the phone app or the shared `service/`
code imports, bundles or reads them, and they do not ship in any build.

They are kept in the repository so that everyone working on jojo gets the same
agent behaviour. That is a convenience, not a licence. If you fork jojo, these
files come with the fork under whatever terms their authors set, not under
jojo's.

## Where they come from

`skills-lock.json` at the repository root records the source of each one. All
nine came from the same GitHub repository, installed by a skills manager that
wrote the lock file, and were first committed here on 2026-08-08.

| Skill | Source (`skills-lock.json`) | Path in the source |
| --- | --- | --- |
| `animate` | GitHub `emilkowalski/skills` | `skills/animate/SKILL.md` |
| `animation-vocabulary` | GitHub `emilkowalski/skills` | `skills/animation-vocabulary/SKILL.md` |
| `apple-design` | GitHub `emilkowalski/skills` | `skills/apple-design/SKILL.md` |
| `emil-design-eng` | GitHub `emilkowalski/skills` | `skills/emil-design-eng/SKILL.md` |
| `find-animation-opportunities` | GitHub `emilkowalski/skills` | `skills/find-animation-opportunities/SKILL.md` |
| `improve-animations` | GitHub `emilkowalski/skills` | `skills/improve-animations/SKILL.md` |
| `pick-ui-library` | GitHub `emilkowalski/skills` | `skills/pick-ui-library/SKILL.md` |
| `prototype` | GitHub `emilkowalski/skills` | `skills/prototype/SKILL.md` |
| `review-animations` | GitHub `emilkowalski/skills` | `skills/review-animations/SKILL.md` |

The `.claude/skills/` entries with the same names are symbolic links to these
directories, not separate copies. `.claude/skills/THIRD-PARTY.md` covers the
other skills that live there.

## What licence they state

**None of the nine states a licence.** No `SKILL.md` frontmatter has a
`license` field, and none of the directories holds a `LICENSE`, `NOTICE` or
`COPYING` file. The copies here carry no copyright line either.

For each of them, therefore: **no licence stated — permission to redistribute
not confirmed.**

The upstream repository may carry a licence at its root that the skills manager
did not copy. Nobody has checked that from here, and this note does not guess
at it. Until somebody does, treat these files as all rights reserved by their
author, and do not copy them out of this repository into anything else.

## What to do before relying on them

- Check the upstream repository `emilkowalski/skills` for a licence, and record
  what it says here, with the date you looked.
- If it has none, or one that does not allow redistribution, remove the
  directories from the repository and install them locally instead (the lock
  file is enough to reinstall them), or ask the author for permission.
- Keep this file in step with `skills-lock.json`: a skill added there needs a
  row here.
