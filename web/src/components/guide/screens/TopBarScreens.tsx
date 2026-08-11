/**
 * The four sections for the four icons at the right of the top bar, in the
 * order the icons sit in.
 *
 * None of these four has a row in the sidebar, which is the whole reason this
 * page exists — so they are filed under the door they do have.
 */

import { GuideContents } from '@/components/guide/GuideNav'
import { Kbd } from '@/components/guide/Kbd'
import { Address, Code, Go, NotConnected, Screen } from '@/components/guide/screens/ScreenParts'
import { S } from '@/components/guide/screens/sections'
import { assistantPath, guidePath, profilePath, settingsPath, vaultPath } from '@/lib/links'

/* ------------------------------- profile ---------------------------------- */

export function ProfileScreen() {
  return (
    <Screen
      id={S.profile}
      title="My profile"
      where="the person icon, top bar"
      to={profilePath()}
      open="your profile"
    >
      <p className="text-sm text-text-2">
        Four panels: your basics, your links, your interests and targets, and your documents. It is
        written to this browser and kept, exactly like every other record —{' '}
        <Go to={guidePath('overview')}>How to use jojo</Go> says why it is still not one of the
        getting-started steps.
      </p>

      <h3 className="mt-4 text-sm font-medium">What is not obvious</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-text-2 marker:text-text-3">
        <li>
          <span className="text-text-1">Match terms</span> are not keywords, and the panel says so
          where you type them. A keyword is something you file records under and filter by; a match
          term is a phrasing the scout would score a posting against. The two lists have never had
          anything to do with each other.
        </li>
        <li>
          The documents panel is a view of the <Go to={vaultPath({ tool: 'files' })}>Vault</Go>
          &rsquo;s Applications bucket rather than a second list of its own — a CV added in either
          place shows up in both, because there is only one place. Uploading here records the name,
          size and type, on the same terms as the Vault.
        </li>
        <li>
          The whole page saves as one change, so one Undo puts all of it back. Pressing Save with
          nothing edited writes nothing and offers no Undo, rather than logging a change that did
          not happen.
        </li>
        <li>
          Every field carries a grey example. On an empty store that matters: this page used to
          render a stranger&rsquo;s name and email as real values, in boxes a reader would
          reasonably take for their own answers.
        </li>
      </ul>

      <Address>carries nothing.</Address>
    </Screen>
  )
}

/* ------------------------------ assistant --------------------------------- */

export function AssistantScreen() {
  return (
    <Screen
      id={S.assistant}
      title="Assistant"
      where="the robot icon, top bar"
      to={assistantPath()}
      open="the assistant"
    >
      <p className="text-sm text-text-2">
        Five prompts a job search actually raises — a cover letter, tailoring a CV, reading a
        posting, a follow-up email, interview preparation — each answered with a worked example
        written out in full.
      </p>

      <NotConnected title="The replies are written, not generated">
        No model is connected, so nothing here reads what you typed and improvises. The five prompts
        return their own worked example; a message matching none of them returns a reply that opens
        by saying it is canned, rather than a plausible paragraph about whatever you asked. Every
        reply on the page carries the same badge —{' '}
        <span className="text-text-1">Example response · no model connected</span> — and it is not a
        call site&rsquo;s decision to leave off.
      </NotConnected>

      <ul className="mt-3.5 list-disc space-y-1.5 pl-5 text-sm text-text-2 marker:text-text-3">
        <li>
          The conversation lives for this visit and is written nowhere.{' '}
          <span className="text-text-1">Save to snippets</span> is the one write on the page: it
          files the reply in the <Go to={vaultPath({ tool: 'snippets' })}>Vault</Go> under the tag
          that reply belongs to, and the toast offers to open it there.
        </li>
        <li>
          Copy can be refused outright by a browser, so the button reports the failure instead of
          confirming something that did not happen.
        </li>
        <li>
          Clearing the conversation offers an Undo rather than a confirmation — canned replies are
          the cheapest thing in the app to get back.
        </li>
      </ul>

      <Address>carries nothing.</Address>
    </Screen>
  )
}

/* ------------------------------- settings --------------------------------- */

export function SettingsScreen() {
  return (
    <Screen id={S.settings} title="Settings" where="the gear icon, top bar" to={settingsPath()}>
      <p className="text-sm text-text-2">
        Seven panels: the localhost bridge, a local model, appearance, your data, your keywords,
        diagnostics, and the audit log. The two runtime tiles at the foot of the sidebar both land
        here, which is what they are for.
      </p>

      <h3 className="mt-4 text-sm font-medium">What is real</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-text-2 marker:text-text-3">
        <li>
          <span className="text-text-1">Export jojo-data.json</span> writes a full versioned backup:
          applications, timeline, vault, saved postings, your keywords and their tags, and your
          profile. It is a copy taken at the moment you press it and does not keep up with what you
          do next.
        </li>
        <li>
          <span className="text-text-1">Load demo data</span>,{' '}
          <span className="text-text-1">Clear records</span> and{' '}
          <span className="text-text-1">Clear storage</span> each ask first and each say exactly
          what they reach. Clearing records keeps the keywords you named — unless the store is still
          untouched demo data, in which case the seeded keywords go with it, and the confirmation
          says which of the two it is about to do.
        </li>
        <li>
          <span className="text-text-1">Keywords</span> renames, recolours and deletes them, and
          tells you how many records each is on before you delete it.
        </li>
        <li>
          <span className="text-text-1">Diagnostics</span> is what turns &ldquo;your records are
          saved&rdquo; into something checkable: how many of each kind are in the store, which
          schema version is on disk, how much room the browser is giving jojo, and the id of
          anything it refused to read.
        </li>
        <li>
          <span className="text-text-1">Audit log</span> lists every write, newest first, up to two
          hundred. Only the newest row offers an Undo, because an entry from three hours ago
          describes records that have been edited a dozen times since. Load demo data and Clear
          records appear there like everything else and are the two the log will not undo — they
          said so before you pressed them.
        </li>
      </ul>

      <NotConnected title="Two panels and two buttons are switched off">
        The bridge&rsquo;s address, pairing code, save path and three switches accept what you type
        and reach nothing, and <span className="text-text-1">Test connection</span> is disabled
        beside them. The local-model endpoint is the same: a field, and a Test button that says why
        it cannot run. <span className="text-text-1">Export to Excel</span> and{' '}
        <span className="text-text-1">Import</span> are disabled with their reasons on hover — no
        spreadsheet writer is bundled, and reading a backup back in needs a validator that can
        refuse a file it does not understand. What each of those would give you is on{' '}
        <Go to={guidePath('overview')}>How to use jojo</Go>.
      </NotConnected>

      <Address>carries nothing.</Address>
    </Screen>
  )
}

/* -------------------------------- guide ----------------------------------- */

export function GuideScreen() {
  return (
    <Screen
      id={S.guide}
      title="This guide"
      where="the question mark, top bar"
      to={guidePath()}
      open="the first page"
    >
      <p className="text-sm text-text-2">
        Four pages under one address, with the rail above and the pager below on every one of them.
        Its only entry in the chrome is the help icon: named on hover and to a screen reader, but
        carrying no visible text and no row in the sidebar, which is a thin door for the page you go
        looking for when something is unclear. <Kbd>⌘K</Kbd> is the reliable way back, and it lists
        all four pages separately rather than one row for the section.
      </p>
      <p className="mt-2 text-sm text-text-2">
        The order is an argument rather than an accident: anyone can stop after the first page and
        use the app, and anyone can jump straight to the last one.
      </p>

      <div className="mt-4">
        <GuideContents />
      </div>

      <Address>
        is the page itself. The first page is <Code>/guide</Code> rather than{' '}
        <Code>/guide/overview</Code>, so every link and bookmark taken before there were four of
        them still lands somewhere real.
      </Address>
    </Screen>
  )
}
