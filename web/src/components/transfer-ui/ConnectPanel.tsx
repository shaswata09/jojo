import { useState } from 'react'
import { ArrowRight, Loader } from 'lucide-react'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { SendState } from '@/lib/handoff-send'
import { canReachLocalNetwork } from '@/lib/handoff-client'

/**
 * The address, typed in, and the transfer that follows it.
 *
 * A browser cannot find a phone on the local network — there is no API for it,
 * and the standards effort that would have provided one was abandoned. So the
 * last piece of the handshake travels the way the first piece did: off one
 * screen and into another, by a person. Twelve characters, in three groups,
 * from an alphabet with no character anyone confuses with another.
 *
 * That is worth being unapologetic about in the copy. A field asking for a code
 * reads as a step that failed to be automated; the honest framing is that the
 * phone is telling this computer where it is, because nothing else can.
 *
 * ## Safari
 *
 * WebKit has no Local Network Access implementation, so this cannot work there —
 * on macOS or iOS, where every browser is WebKit. Said before the field rather
 * than after a request that would hang, and paired with the thing that does
 * work: the backup file.
 */
export function ConnectPanel({ send, token }: { send: SendState; token: string | null }) {
  const [code, setCode] = useState('')
  const able = canReachLocalNetwork()
  const busy = send.stage === 'connecting' || send.stage === 'packing' || send.stage === 'sending'

  if (!able) {
    return (
      <Panel>
        <PanelTitle hint="not in this browser">Connect</PanelTitle>
        <p className="text-sm text-text-2">
          Safari cannot connect to another device on your network. Use Chrome, Edge or Firefox
          here — or move everything with a backup file from Settings, which works everywhere and
          has no size limit.
        </p>
      </Panel>
    )
  }

  return (
    <Panel>
      <PanelTitle hint="from the other device">Connect</PanelTitle>

      {send.stage === 'done' ? (
        <p className="text-sm text-text-2">
          Everything moved{send.target === null ? '' : ` to ${send.target}`}. Both devices now hold
          the same records.
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm text-text-2">
            After scanning, your phone shows a short code. Type it here — it is how this computer
            learns where the phone is, which a browser cannot work out on its own.
          </p>

          <div className="flex gap-2">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="K3M9-2XQ7-4B1P"
              spellCheck={false}
              autoCapitalize="characters"
              autoComplete="off"
              className="tabular font-mono tracking-[0.12em]"
              aria-label="The code shown on your phone"
              disabled={busy}
            />
            <Button
              size="sm"
              disabled={busy || token === null || code.trim().length === 0}
              onClick={() => {
                if (token !== null) void send.start(code, token)
              }}
            >
              {busy ? (
                <Loader className="size-3.5 animate-spin" strokeWidth={1.8} aria-hidden />
              ) : (
                <ArrowRight className="size-3.5" strokeWidth={1.8} aria-hidden />
              )}
              Send
            </Button>
          </div>

          {busy ? (
            <div className="mt-4">
              <div
                role="progressbar"
                aria-label="Transfer progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(send.progress * 100)}
                className="h-1.5 w-full overflow-hidden rounded-full bg-well"
              >
                <div
                  className="h-full rounded-full bg-info transition-[width] duration-150 ease-linear"
                  style={{ width: `${Math.round(send.progress * 100)}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-text-3">
                {send.stage === 'connecting'
                  ? 'Reaching your phone…'
                  : send.stage === 'packing'
                    ? 'Gathering your records…'
                    : `${Math.round(send.progress * 100)}% sent`}
              </p>
            </div>
          ) : null}

          {send.problem === null ? null : (
            <p className="mt-3 text-sm text-warn">{send.problem}</p>
          )}
        </>
      )}
    </Panel>
  )
}
