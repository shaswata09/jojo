# Third-party skills in this directory

Every skill in `.claude/skills/` was written by somebody else. None of it is
jojo's own work, and none of it is covered by jojo's Apache-2.0 licence: the
`LICENSE` and `NOTICE` at the repository root grant rights only in what jojo's
authors wrote, and they cannot grant rights in this.

These files are **development tooling only**. They are instructions, reference
notes, data tables and helper scripts for a coding agent (Claude Code) working
on this repository. Nothing in the web app, the browser extension, the phone
app or the shared `service/` code imports, bundles or reads them, and they do
not ship in any build.

They are kept in the repository so that everyone working on jojo gets the same
agent behaviour. That is a convenience, not a licence. If you fork jojo, these
files come with the fork under whatever terms their authors set, not under
jojo's.

Everything below is taken from the files as they sit in this repository. Where
a file does not say something, this note does not guess it.

## Symbolic links to `.agents/skills/`

`animate`, `animation-vocabulary`, `apple-design`, `emil-design-eng`,
`find-animation-opportunities`, `improve-animations`, `pick-ui-library`,
`prototype` and `review-animations` are symbolic links into `.agents/skills/`,
not copies. Their source (GitHub `emilkowalski/skills`, per
`skills-lock.json`) and their licence position are in
`.agents/skills/THIRD-PARTY.md`. In short: **no licence stated — permission to
redistribute not confirmed.**

## Skills stored here

Six of these name their author in the `SKILL.md` frontmatter as
`metadata.author: claudekit`. None of them says which repository or package
it was taken from, and there is no lock file entry for any of them.

| Skill | Author (frontmatter) | Version (frontmatter) | Licence as stated |
| --- | --- | --- | --- |
| `banner-design` | `claudekit` | `1.0.0` | frontmatter `license: MIT`; no licence file |
| `brand` | `claudekit` | `1.0.0` | none — no `license` field, no licence file |
| `design` | `claudekit` | `2.1.0` | frontmatter `license: MIT`; no licence file |
| `design-system` | `claudekit` | `1.0.0` | frontmatter `license: MIT`; no licence file |
| `slides` | `claudekit` | `1.0.0` | none — no `license` field, no licence file |
| `ui-styling` | `claudekit` | `1.0.0` | CONFLICTING: frontmatter `license: MIT`, but `LICENSE.txt` is the Apache License 2.0 |
| `ui-ux-pro-max` | not stated | not stated | none — no `license` field, no licence file |

What each of those means:

- **`banner-design`, `design`, `design-system`.** The frontmatter says
  `license: MIT`. That is a claim of a licence, not the licence: MIT requires
  its copyright notice and permission text to travel with every copy, and
  neither is anywhere in these directories, so no copyright holder is named.
  Permission to redistribute is asserted but its terms, as MIT defines them,
  are not present.
- **`brand`, `slides`.** No licence stated — permission to redistribute not
  confirmed.
- **`ui-styling`.** The frontmatter says `license: MIT`, and the directory's
  `LICENSE.txt` is the full text of the Apache License, Version 2.0 (201
  lines). Its appendix still reads `Copyright [yyyy] [name of copyright
  owner]`, unfilled, so it names no copyright holder. The two statements
  disagree and this note does not pick one. Permission to redistribute is
  asserted twice, inconsistently, and not confirmed.
- **`ui-ux-pro-max`.** No author, no version, no licence field and no licence
  file. Its `data/` tables (styles, palettes, font pairings, stack guidelines)
  and `scripts/` carry no attribution either. No licence stated — permission
  to redistribute not confirmed.

The name `claudekit` (and "ClaudeKit Marketing", which appears in the
`design-system` and `brand` examples and scripts) is the authors' own. jojo is
not affiliated with it.

## What to do before relying on them

- Find where each of these was obtained, and record the source and the date
  here. For the `claudekit` skills, check whether the upstream project
  publishes a licence file with a copyright holder, and add it beside each
  skill if it does.
- Settle `ui-styling`'s MIT-versus-Apache conflict from the upstream source,
  not by editing the copy here.
- If a skill turns out to have no licence that allows redistribution, remove it
  from the repository and install it locally instead, or ask its author.
- Do not copy any of these files, or their data tables, into the apps.
