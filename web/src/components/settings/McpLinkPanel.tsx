import type { ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Chip } from '@/components/common/Chip'
import { CopyButton } from '@/components/common/CopyButton'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { bridgeCommand, clientCommand } from '@/lib/mcp-link'
import { useMcpLink } from '@/lib/mcp-link-context'
import type { McpLink, McpLinkStatus } from '@/lib/mcp-link-context'
import { publicUrl } from '@/lib/public-url'

/**
 * Settings → Connect from an MCP client.
 *
 * ## What it is for
 *
 * Somebody who already pays for an assistant — Claude Code on a Max plan is the
 * case this was built for — wants that assistant working on their job search,
 * with its own harness and its own model, rather than a second assistant inside
 * jojo. jojo cannot offer their Claude login as a provider: Anthropic does not
 * allow third-party apps to, and says so. What it can do is the reverse, which
 * is exactly what MCP exists for — be a tool server their assistant connects to.
 *
 * ## Why the panel is mostly two commands
 *
 * Because that is the whole of the setup, and a person who has just turned the
 * switch on wants the recipe, not an essay. The status chip does the rest: it
 * names which of the four things that can be wrong is wrong, in the words of the
 * fix, so nobody restarts a bridge when the problem was a stale extension.
 */

type Tone = NonNullable<ComponentProps<typeof Chip>['tone']>

/**
 * Every state has a chip. A table, so a new state is a compile error here until it has one.
 * `label` is a catalog key, translated where the chip is drawn.
 */
const CHIP: { readonly [S in McpLinkStatus['state']]: { tone: Tone; label: string } } = {
  off: { tone: 'gray', label: 'mcp.chip.off' },
  searching: { tone: 'amber', label: 'mcp.chip.searching' },
  ready: { tone: 'green', label: 'mcp.chip.ready' },
  'bad-token': { tone: 'red', label: 'mcp.chip.badToken' },
  'no-extension': { tone: 'red', label: 'mcp.chip.noExtension' },
  'stale-extension': { tone: 'amber', label: 'mcp.chip.staleExtension' },
}

/**
 * Which shell the first command is written for. Windows gets PowerShell, where
 * `curl` is an alias and `&&` does not exist; everything else gets a POSIX
 * shell. Read once: the platform does not change under a running page.
 */
const SHELL: 'posix' | 'powershell' =
  typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent) ? 'powershell' : 'posix'

/** The sentence under the chip: what is true now, and what to do about it. */
function explain(link: McpLink, t: TFunction<'settings'>): string {
  switch (link.status.state) {
    case 'off':
      return ''
    case 'searching':
      // The link says why when it knows: another tab carrying it, or something
      // that is not jojo-bridge sitting on the port.
      return link.status.reason ?? t('mcp.explain.searching')
    case 'ready':
      return link.served > 0
        ? link.lastMethod === null
          ? t('mcp.explain.servedNoMethod', { count: link.served })
          : t('mcp.explain.served', { count: link.served, method: link.lastMethod })
        : t('mcp.explain.ready')
    case 'bad-token':
      return t('mcp.explain.badToken')
    case 'no-extension':
      return t('mcp.explain.noExtension')
    case 'stale-extension':
      return t('mcp.explain.staleExtension')
  }
}

function Step({
  n,
  title,
  command,
  copyLabel,
  note,
}: {
  n: number
  title: string
  command: string
  copyLabel: string
  note: string
}) {
  return (
    <div className="mt-3">
      <p className="text-xs text-text-2">
        <span className="font-mono text-text-3">{String(n)}.</span> {title}
      </p>
      <div className="mt-1 flex items-start gap-2 rounded-md border border-hairline bg-raised py-1.5 ps-2.5 pe-1">
        {/* `min-w-0`, or the command refuses to shrink and pushes the button off the card. */}
        <pre className="min-w-0 flex-1 overflow-x-auto py-0.5 font-mono text-xs whitespace-pre text-text-1">
          {command}
        </pre>
        <CopyButton text={command} label={copyLabel} />
      </div>
      <p className="mt-1 text-xs text-text-3">{note}</p>
    </div>
  )
}

export function McpLinkPanel() {
  const { t } = useTranslation('settings')
  const link = useMcpLink()
  const chip = CHIP[link.status.state]
  // Absolute, because it is pasted into a terminal that has no idea where this page lives.
  const script = new URL(publicUrl('jojo-bridge.mjs'), window.location.origin).href

  return (
    <Panel focusId="mcp">
      <PanelTitle hint={t('shared.optional')}>{t('mcp.title')}</PanelTitle>
      <p className="mb-3 text-sm text-text-2">{t('mcp.intro')}</p>

      <div className="flex items-center gap-3" data-focus-id="mcp-allow">
        <Switch id="mcp-link-switch" checked={link.enabled} onCheckedChange={link.setEnabled} />
        <label htmlFor="mcp-link-switch" className="text-sm text-text-1">
          {t('mcp.allow')}
        </label>
      </div>

      {link.enabled ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
            <Chip tone={chip.tone}>{t(chip.label)}</Chip>
            <span className="text-xs text-text-3">{explain(link, t)}</span>
          </div>

          <Step
            n={1}
            title={t('mcp.start.title')}
            command={bridgeCommand(script, link.token, SHELL)}
            copyLabel={t('mcp.start.copy')}
            note={SHELL === 'powershell' ? t('mcp.start.notePowershell') : t('mcp.start.note')}
          />
          <Step
            n={2}
            title={t('mcp.connect.title')}
            command={clientCommand(link.token)}
            copyLabel={t('mcp.connect.copy')}
            note={t('mcp.connect.note')}
          />

          {/*
           * The honesty paragraph. Each clause answers a question somebody
           * handing their records to another program is entitled to ask, and
           * none of them is a promise this code does not keep.
           */}
          <p className="mt-3 text-xs text-text-3">{t('mcp.honesty')}</p>

          <div className="mt-3 flex items-center gap-3" data-focus-id="mcp-token">
            <Button variant="ghost" size="sm" onClick={link.regenerate}>
              {t('mcp.newToken')}
            </Button>
            <span className="text-xs text-text-3">{t('mcp.newTokenNote')}</span>
          </div>
        </>
      ) : null}
    </Panel>
  )
}
