import { useEffect, useState } from 'react'
import { useRoute } from '@react-navigation/native'
import type { RouteProp } from '@react-navigation/native'
import { LabelFilter } from '@/components/common/Labels'
import { Screen } from '@/components/ui/Screen'
import { SettingRow, Toggle } from '@/components/ui/Field'
import { Segment } from '@/components/ui/Segment'
import { useTimeline, useVault } from '@/lib/store-context'
import type { TabParamList, VaultTool } from '@/navigation/types'
import { CalculatorTool } from '@/screens/vault/CalculatorTool'
import { FilesTool } from '@/screens/vault/FilesTool'
import { LinksTool } from '@/screens/vault/LinksTool'
import { RemindersTool } from '@/screens/vault/RemindersTool'
import { SnippetsTool } from '@/screens/vault/SnippetsTool'

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
 * Reminders used to be a screen of its own. It is one of several things a job
 * search accumulates — postings you have not read, the department page you
 * meant to study, the paragraph you rewrite on every form — and they all share
 * the same shape: saved now, needed later. One screen, one tool at a time.
 *
 * This file is the shell and nothing else. Each tool is its own module: they
 * were one 1,000-line file, which is the shape where a change to the links list
 * has to be made without disturbing three others in the same scroll.
 */
export function VaultScreen() {
  const route = useRoute<RouteProp<TabParamList, 'Vault'>>()
  const [tool, setTool] = useState<VaultTool>(route.params?.tool ?? 'reminders')
  // The web page makes this a switch too. Four totals is the right default —
  // it is the only place the vault says how much is in it — but it is also the
  // longest subtitle in the app, and on a narrow phone it wraps to two lines.
  const [showCounts, setShowCounts] = useState(true)
  const { reminders } = useTimeline()
  const { links, files, snippets } = useVault()

  // A link from elsewhere names a tool; the shell has to follow it even when
  // this screen was already mounted on another tab.
  useEffect(() => {
    if (route.params?.tool) setTool(route.params.tool)
  }, [route.params?.tool])

  /**
   * Ids of whatever the active tool lists, so the keyword counts describe the
   * tab you are looking at rather than the whole vault. Null on Tools, which
   * holds instruments rather than records — a row of chips all reading zero
   * would only look broken.
   */
  const scopeIds =
    tool === 'reminders'
      ? reminders.map((r) => r.id)
      : tool === 'links'
        ? links.map((l) => l.id)
        : tool === 'files'
          ? files.map((f) => f.id)
          : tool === 'snippets'
            ? snippets.map((x) => x.id)
            : null

  /**
   * Four totals, counted the same way.
   *
   * This used to lead with the number of *open* reminders and follow it with
   * three totals, within a line of a control reading "8 open · 2 completed" — so
   * the same tab was described by two different numbers. The open/completed
   * split belongs to the reminders bucket filter, where you can act on it.
   */
  const subtitle = showCounts
    ? `${reminders.length} reminders · ${links.length} links · ${files.length} files · ${snippets.length} snippets`
    : 'Reminders, links, files and snippets'

  return (
    <Screen
      title="Vault"
      subtitle={subtitle}
      options={
        <SettingRow
          label="Show counts"
          description="Item totals in the subtitle, rather than what the tabs hold"
          control={<Toggle value={showCounts} onValueChange={setShowCounts} label="Show counts" />}
        />
      }
    >
      <Segment label="Vault tool" scroll options={TOOLS} value={tool} onChange={setTool} />

      {/* One filter for the whole vault: a keyword means the same thing on a
          reminder, a link, a file and a snippet, so it would be wrong to give
          each tab its own copy with its own selection. */}
      {scopeIds && scopeIds.length > 0 ? <LabelFilter scopeIds={scopeIds} /> : null}

      {tool === 'reminders' ? <RemindersTool focus={route.params?.focus} /> : null}
      {tool === 'links' ? <LinksTool /> : null}
      {tool === 'files' ? <FilesTool /> : null}
      {tool === 'snippets' ? <SnippetsTool /> : null}
      {tool === 'tools' ? <CalculatorTool /> : null}
    </Screen>
  )
}
