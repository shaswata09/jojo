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
import { reminders } from '@/data/reminders'
import { snippets, vaultFiles, vaultLinks } from '@/data/vault'

const TOOLS = [
  { value: 'reminders', label: 'Reminders' },
  { value: 'links', label: 'Links' },
  { value: 'files', label: 'Files' },
  { value: 'snippets', label: 'Snippets' },
  { value: 'tools', label: 'Tools' },
] as const

type Tool = (typeof TOOLS)[number]['value']

/**
 * Everything you set aside to come back to.
 *
 * Reminders used to be a page of its own. It is one of several things a job
 * search accumulates — postings you have not read, the department page you
 * meant to study, the paragraph you rewrite on every form — and they all share
 * the same shape: saved now, needed later. One page, one tool at a time.
 */
export function Vault() {
  const [tool, setTool] = useState<Tool>('reminders')
  // Counts in the subtitle are informative but noisy on a narrow screen.
  const [showCounts, setShowCounts] = useState(true)

  // Ids of whatever the active tool lists, so the keyword counts describe the
  // tab you are looking at rather than the whole vault.
  const scopeIds =
    tool === 'reminders'
      ? reminders.map((r) => r.id)
      : tool === 'links'
        ? vaultLinks.map((l) => l.id)
        : tool === 'files'
          ? vaultFiles.map((f) => f.id)
          : tool === 'snippets'
            ? snippets.map((s) => s.id)
            : null

  const openReminders = reminders.filter((r) => r.status !== 'done').length
  const subtitle = showCounts
    ? `${openReminders} reminders · ${vaultLinks.length} links · ${vaultFiles.length} files · ${snippets.length} snippets`
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
        actions={<Segment label="Vault tool" options={TOOLS} value={tool} onChange={setTool} />}
      />

      {/* One filter for the whole vault: a keyword means the same thing on a
          reminder, a link, a file and a snippet, so it would be wrong to give
          each tab its own copy with its own selection. */}
      {/* Hidden on Tools, which holds instruments rather than records — there
          is nothing there to filter, and a row of chips all reading zero would
          only look broken. */}
      {scopeIds ? <LabelFilter scopeIds={scopeIds} /> : null}

      {tool === 'reminders' ? <RemindersTool /> : null}
      {tool === 'links' ? <LinksTool /> : null}
      {tool === 'files' ? <FilesTool /> : null}
      {tool === 'snippets' ? <SnippetsTool /> : null}
      {tool === 'tools' ? <Calculator /> : null}
    </>
  )
}
