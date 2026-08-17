import { useEffect, useRef, useState } from 'react'
import { LabelFilter } from '@/components/common/LabelFilter'
import { PageHeader, PageOption } from '@/components/common/PageHeader'
import { Segment } from '@/components/common/Segment'
import { Switch } from '@/components/ui/switch'
import { Calculator } from '@/components/vault/Calculator'
import { FilesTool } from '@/components/vault/FilesTool'
import { LinksTool } from '@/components/vault/LinksTool'
import { RemindersTool } from '@/components/vault/RemindersTool'
import { SnippetsTool } from '@/components/vault/SnippetsTool'
import { useTimeline } from '@jojo/service/react/use-timeline'
import { useVault } from '@jojo/service/react/use-vault'
import { type VaultTool, useTitle, useVaultParams } from '@/lib/links'
import { useArrivalHighlight } from '@/lib/use-arrival-highlight'

/**
 * `satisfies` rather than a locally derived type: the URL contract in links.ts
 * owns the list of tools now, and this is where the tab labels live. Checked
 * against `VaultTool` so a tab whose value no route builder understands cannot
 * be added here without the compiler saying so.
 */
const TOOLS = [
  { value: 'reminders', label: 'Reminders' },
  { value: 'links', label: 'Links' },
  { value: 'files', label: 'Files' },
  { value: 'snippets', label: 'Snippets' },
  { value: 'tools', label: 'Tools' },
] as const satisfies readonly { value: VaultTool; label: string }[]

/**
 * Everything you set aside to come back to.
 *
 * Reminders used to be a page of its own. It is one of several things a job
 * search accumulates — postings you have not read, the department page you
 * meant to study, the paragraph you rewrite on every form — and they all share
 * the same shape: saved now, needed later. One page, one tool at a time.
 */
export function Vault() {
  useTitle('Vault')
  // In the URL rather than in state, so a link can name a tool and a record
  // inside it: the spotlight and the reminders badge both point at
  // '/vault?tool=reminders&focus=…', and with the tab held locally they would
  // have landed on whatever tab was open last and highlighted nothing.
  const { tool, focus, set } = useVaultParams()
  // The highlight is an arrival cue, not a selection: it fades and takes the
  // parameter with it, so a copied URL and the Back stack stop carrying a row
  // nobody is looking at any more.
  useArrivalHighlight(focus, () => set({ focus: undefined }))
  const { reminders } = useTimeline()
  const { links, files, snippets } = useVault()
  // Counts in the subtitle are informative but noisy on a narrow screen.
  const [showCounts, setShowCounts] = useState(true)

  /**
   * Keeps the open tab inside the scroller below.
   *
   * Once the segment can scroll, the selected pill can be off-screen — and it
   * is exactly where it hurts: '/vault?tool=tools' is a real link, the spotlight
   * and the sidebar both emit tab links, and at 320px Tools sits 42px past the
   * right edge. The control would open showing four unselected tabs, which
   * reads as a segmented control with nothing chosen rather than as one that
   * has been scrolled.
   *
   * Written straight to `scrollLeft` rather than `scrollIntoView`, which also
   * scrolls the window and would drag the page down to a control that was
   * already in view. Measured from rects rather than `offsetLeft`, because the
   * button's offset parent is whatever is positioned above it and that is not
   * this box. Everything fitting makes it a no-op: the target goes negative and
   * the browser clamps it to zero.
   */
  const tabs = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = tabs.current
    const active = box?.querySelector<HTMLElement>('[aria-checked="true"]')
    if (!box || !active) return
    const outer = box.getBoundingClientRect()
    const pill = active.getBoundingClientRect()
    box.scrollLeft += pill.left - outer.left - (outer.width - pill.width) / 2
  }, [tool])

  // Ids of whatever the active tool lists, so the keyword counts describe the
  // tab you are looking at rather than the whole vault.
  const scopeIds =
    tool === 'reminders'
      ? reminders.map((r) => r.id)
      : tool === 'links'
        ? links.map((l) => l.id)
        : tool === 'files'
          ? files.map((f) => f.id)
          : tool === 'snippets'
            ? snippets.map((s) => s.id)
            : null

  /**
   * Four totals, counted the same way.
   *
   * This used to lead with the number of *open* reminders and follow it with
   * three totals, within 100px of a control reading "8 open · 2 completed" —
   * so the same tab was described by two different numbers on one line. The
   * open/completed split belongs to the reminders toolbar, which is where you
   * can act on it; up here every figure means "records in this tab".
   */
  const subtitle = showCounts
    ? `${reminders.length} reminders · ${links.length} links · ${files.length} files · ${snippets.length} snippets`
    : 'Everything you set aside to come back to'

  return (
    <>
      <PageHeader
        title="Vault"
        subtitle={subtitle}
        settings={
          <>
            <PageOption
              label="Show counts"
              hint="Item totals in the page subtitle"
              control={
                <Switch
                  checked={showCounts}
                  onCheckedChange={setShowCounts}
                  aria-label="Show counts"
                />
              }
            />
          </>
        }
        actions={
          /**
           * Scrolled, not wrapped.
           *
           * Five tabs make this segment 342px wide and its buttons cannot
           * compress past their own words, so at 320px it pushed the document
           * to 354px and every page on the route scrolled sideways — the header,
           * the keyword chips and the rows all shifted with it. The Segment is
           * shared with four other pages and its own comment records that its
           * options cannot be narrowed, so the fix belongs here, to the one page
           * that carries five of them.
           *
           * Wrapping was the other option and it is the worse one: a pill track
           * is `rounded-full`, and a second row inside it turns the control into
           * a shape that is not a segmented control any more. `w-max` keeps the
           * track as wide as its buttons so the recessed background travels with
           * them — without it the track stops at 320px and the last tab slides
           * out over bare page.
           *
           * The cap is against the viewport rather than `max-w-full`, which was
           * tried first and does nothing: it resolves against the header's own
           * actions row, and that row is sized BY this control, so the two agree
           * on 342px and the page still overflows. Nothing between here and the
           * viewport carries a definite width to measure instead — the header
           * row's `min-width: auto` is what refuses to shrink, and it belongs to
           * PageHeader, which four other pages share. `1.5rem` is AppShell's
           * `p-3`; the cap can only bite below a 366px viewport, and `p-3` is
           * the padding everywhere under `sm`.
           */
          <div ref={tabs} className="-mb-1 max-w-[calc(100vw-1.5rem)] min-w-0 overflow-x-auto pb-1">
            <Segment
              label="Vault tool"
              options={TOOLS}
              value={tool}
              className="w-max"
              // `focus` is cleared with the tab: a highlighted row in the tool you
              // just left is a URL describing something nobody is looking at.
              onChange={(next) => set({ tool: next, focus: undefined })}
            />
          </div>
        }
      />

      {/* One filter for the whole vault: a keyword means the same thing on a
          reminder, a link, a file and a snippet, so it would be wrong to give
          each tab its own copy with its own selection. */}
      {/* Hidden on Tools, which holds instruments rather than records — there
          is nothing there to filter, and a row of chips all reading zero would
          only look broken. Hidden on an empty tab for the same reason: at zero
          rows the empty state is the only thing that should be offering an
          action, and a filter above it filters nothing. */}
      {scopeIds && scopeIds.length > 0 ? <LabelFilter scopeIds={scopeIds} /> : null}

      {/* Every tool takes `focus`, not just reminders: the graph's "Open link /
          file / snippet" used to land on a list of ten with nothing pointing at
          the one you clicked. */}
      {tool === 'reminders' ? <RemindersTool focus={focus} /> : null}
      {tool === 'links' ? <LinksTool focus={focus} /> : null}
      {tool === 'files' ? <FilesTool focus={focus} /> : null}
      {tool === 'snippets' ? <SnippetsTool focus={focus} /> : null}
      {tool === 'tools' ? <Calculator /> : null}
    </>
  )
}
