import type { ComponentProps } from 'react'
import { Chip } from '@/components/common/Chip'
import { CopyButton } from '@/components/common/CopyButton'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { bridgeCommand, clientCommand } from '@/lib/mcp-link'
import { useMcpLink } from '@/lib/mcp-link-provider'
import type { McpLink, McpLinkStatus } from '@/lib/mcp-link-provider'
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

/** Every state has a chip. A table, so a new state is a compile error here until it has one. */
const CHIP: { readonly [S in McpLinkStatus['state']]: { tone: Tone; label: string } } = {
  off: { tone: 'gray', label: 'Off' },
  searching: { tone: 'amber', label: 'Waiting for jojo-bridge' },
  ready: { tone: 'green', label: 'Linked' },
  'bad-token': { tone: 'red', label: 'Token refused' },
  'no-extension': { tone: 'red', label: 'Needs the extension' },
  'stale-extension': { tone: 'amber', label: 'Reload the extension' },
}

/** The sentence under the chip: what is true now, and what to do about it. */
function explain(link: McpLink): string {
  switch (link.status.state) {
    case 'off':
      return ''
    case 'searching':
      return 'Nothing is answering at 127.0.0.1:3002 yet. Start jojo-bridge with the first command — jojo keeps looking.'
    case 'ready':
      return link.served > 0
        ? `Answered ${String(link.served)} ${link.served === 1 ? 'request' : 'requests'} from your client this session, most recently ${link.lastMethod ?? 'one'}.`
        : 'jojo-bridge is running. Connect your client with the second command.'
    case 'bad-token':
      return 'jojo-bridge is running with a different token. Stop it with Ctrl+C and start it again with the first command.'
    case 'no-extension':
      return 'This copy of jojo is served from the web, and Chrome keeps web pages away from 127.0.0.1. The jojo extension carries the link — its installer is on this page, under Keeping postings.'
    case 'stale-extension':
      return 'The jojo extension in this browser is older than this page. Open chrome://extensions and press Reload on jojo.'
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
      <div className="mt-1 flex items-start gap-2 rounded-md border border-hairline bg-raised py-1.5 pr-1 pl-2.5">
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
  const link = useMcpLink()
  const chip = CHIP[link.status.state]
  // Absolute, because it is pasted into a terminal that has no idea where this page lives.
  const script = new URL(publicUrl('jojo-bridge.mjs'), window.location.origin).href

  return (
    <Panel>
      <PanelTitle hint="optional">Connect from an MCP client</PanelTitle>
      <p className="mb-3 text-sm text-text-2">
        Let an assistant you already use — Claude Code on your own plan, say — read and update your
        records here, with the same tools jojo&apos;s own assistant has. It reaches this tab through a
        small program on your computer, and every change it makes shows up here with Undo.
      </p>

      <div className="flex items-center gap-3">
        <Switch
          id="mcp-link-switch"
          checked={link.enabled}
          onCheckedChange={link.setEnabled}
        />
        <label htmlFor="mcp-link-switch" className="text-sm text-text-1">
          Allow an MCP client on this computer to use jojo
        </label>
      </div>

      {link.enabled ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
            <Chip tone={chip.tone}>{chip.label}</Chip>
            <span className="text-xs text-text-3">{explain(link)}</span>
          </div>

          <Step
            n={1}
            title="Start jojo-bridge, and leave it running"
            command={bridgeCommand(script, link.token)}
            copyLabel="Copy the command that starts jojo-bridge"
            note="Needs Node 18 or newer. In Windows PowerShell, type curl.exe for curl, and ; for &&."
          />
          <Step
            n={2}
            title="Connect Claude Code to it, once"
            command={clientCommand(link.token)}
            copyLabel="Copy the command that connects Claude Code"
            note="Then ask it something like “which of my applications are waiting on me?”. If your terminal says “command not found: claude”, you use Claude Code inside VS Code, which ships its own copy — run the same line with that copy’s full path (in the VS Code extensions folder, under anthropic.claude-code-…/resources/native-binary/claude), or install the Claude Code CLI. Any client that speaks MCP over HTTP can use the same address and token."
          />

          {/*
           * The honesty paragraph. Each clause answers a question somebody
           * handing their records to another program is entitled to ask, and
           * none of them is a promise this code does not keep.
           */}
          <p className="mt-3 text-xs text-text-3">
            Your client runs on your own plan and your own login — jojo never sees either, and sends
            nothing to Anthropic or anyone else. It can use every tool jojo&apos;s assistant can except
            the two that cannot be undone, Reset and Clear. Claude Code asks before it uses a tool unless
            you have told it not to, and jojo marks every delete as destructive. Keep this tab open while
            you use it: the records live here, and so does the other end of the link.
          </p>

          <div className="mt-3 flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={link.regenerate}>
              New token
            </Button>
            <span className="text-xs text-text-3">
              The old commands stop working — run both again with the new one.
            </span>
          </div>
        </>
      ) : null}
    </Panel>
  )
}
