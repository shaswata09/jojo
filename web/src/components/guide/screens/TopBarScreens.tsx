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
        A threaded chat with the local model you connected in{' '}
        <Go to={settingsPath()}>Settings</Go>, and a page of worked examples until you do. Which of
        the two you get is decided by whether an endpoint is saved — nothing is hidden and there is
        no switch.
      </p>

      <h3 className="mt-4 text-sm font-medium">With a model connected</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-text-2 marker:text-text-3">
        <li>
          It is <span className="text-text-1">agentic</span>: the model is handed the app&rsquo;s own
          tools and can read and write records to answer you. Every call it makes is listed in the
          reply as it happens — the tool, its arguments, and what came back — so a write is
          something you watch rather than discover.
        </li>
        <li>
          Conversations are <span className="text-text-1">threads, and they are saved</span>. They
          live in this browser&rsquo;s IndexedDB beside everything else, so closing the tab keeps
          them; the thread bar switches between them, and each can be filed under an application so
          two searches do not blur into one history.
        </li>
        <li>
          With the document reader configured as well, it can{' '}
          <span className="text-text-1">read your documents</span> — a PDF, a Word file, a deck —
          and answer from what is inside them.
        </li>
      </ul>

      <NotConnected title="Without one, the replies are written rather than generated">
        Five prompts a job search actually raises — a cover letter, tailoring a CV, reading a
        posting, a follow-up email, interview preparation — each answered with a worked example
        written out in full. A message matching none of them returns a reply that opens by saying it
        is canned, rather than a plausible paragraph about whatever you asked, and every reply
        carries the same badge —{' '}
        <span className="text-text-1">Example response · no model connected</span>.
      </NotConnected>

      <ul className="mt-3.5 list-disc space-y-1.5 pl-5 text-sm text-text-2 marker:text-text-3">
        <li>
          <span className="text-text-1">Save to snippets</span> files a reply in the{' '}
          <Go to={vaultPath({ tool: 'snippets' })}>Vault</Go> under the tag that reply belongs to,
          and the toast offers to open it there.
        </li>
        <li>
          Copy can be refused outright by a browser, so the button reports the failure instead of
          confirming something that did not happen.
        </li>
        <li>
          Deleting a thread offers an Undo rather than a confirmation.
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
        Seven panels: your documents, a local model, appearance, your data, your keywords,
        diagnostics, and the audit log. The runtime tile at the foot of the sidebar lands here,
        which is what it is for.
      </p>

      <h3 className="mt-4 text-sm font-medium">What is real</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-text-2 marker:text-text-3">
        <li>
          <span className="text-text-1">Export a backup</span> writes a full versioned backup to{' '}
          <span className="text-text-1">jojo-backup-YYYY-MM-DD.json</span>: applications, timeline,
          vault, saved postings, your keywords and their tags, and your profile. It is a copy taken
          at the moment you press it and does not keep up with what you do next.
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

      <NotConnected title="One panel and one button are switched off">
        The local-model endpoint is a field, and a Test button that says why it cannot run.
        The panel that used to sit beside it — a bridge address, a pairing code, a save path and
        three switches, all of which accepted what you typed and reached nothing — is gone;
        documents are stored for real now, and{' '}
        <span className="text-text-1">Your documents</span> says where. <span className="text-text-1">Export to Excel</span> and{' '}
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
