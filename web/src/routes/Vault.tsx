import { useState } from 'react'
import { LabelFilter } from '@/components/common/LabelFilter'
import { PageHeader, PageOption } from '@/components/common/PageHeader'
import { Segment } from '@/components/common/Segment'
import { Switch } from '@/components/ui/switch'
import { Calculator } from '@/components/vault/Calculator'
import { FilesTool } from '@/components/vault/FilesTool'
import { LinksTool } from '@/components/vault/LinksTool'
import { RemindersTool } from '@/components/vault/RemindersTool'
import { SnippetsTool } from '@/components/vault/SnippetsTool'
import { type VaultTool, useTitle, useVaultParams } from '@/lib/links'
import { useTimeline, useVault } from '@/lib/store-context'
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
          <Segment
            label="Vault tool"
            options={TOOLS}
            value={tool}
            // `focus` is cleared with the tab: a highlighted row in the tool you
            // just left is a URL describing something nobody is looking at.
            onChange={(next) => set({ tool: next, focus: undefined })}
          />
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
