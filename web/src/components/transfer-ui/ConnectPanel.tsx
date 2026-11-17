import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Loader } from 'lucide-react'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { SendState } from '@/lib/handoff-send'
import { doneSentence } from './done-sentence'
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
export function ConnectPanel({ send, tokens }: { send: SendState; tokens: readonly string[] }) {
  const { t } = useTranslation('transfer')
  const [code, setCode] = useState('')
  const able = canReachLocalNetwork()
  const busy = send.stage === 'connecting' || send.stage === 'packing' || send.stage === 'sending'

  if (!able) {
    return (
      <Panel>
        <PanelTitle hint={t('connect.hintUnable')}>{t('connect.title')}</PanelTitle>
        <p className="text-sm text-text-2">{t('connect.unable')}</p>
      </Panel>
    )
  }

  return (
    <Panel>
      <PanelTitle hint={t('connect.hint')}>{t('connect.title')}</PanelTitle>

      {send.stage === 'done' ? (
        <>
          {/* Not "both devices now hold the same records": the phone has the
              bytes, and it asks its person before it replaces anything — so
              until they confirm there, nothing on it has changed (transfer
              audit, 2026-11-16). */}
          <p className="text-sm text-text-2" aria-live="polite">
            {doneSentence(send)}
          </p>
          {/* The page has already put a new code up for the next device, and
              this is the way back to the field to type that device's address.
              Without it a finished send was a dead end: no field, a payload
              switch still locked, and only leaving the page to start over. */}
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => {
              setCode('')
              send.cancel()
            }}
          >
            {t('connect.another')}
          </Button>
        </>
      ) : (
        <>
          <p className="mb-3 text-sm text-text-2">{t('connect.intro')}</p>

          <div className="flex gap-2">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="K3M9-2XQ7-4B1P"
              spellCheck={false}
              autoCapitalize="characters"
              autoComplete="off"
              className="tabular font-mono tracking-[0.12em]"
              aria-label={t('connect.codeLabel')}
              disabled={busy}
            />
            <Button
              size="sm"
              disabled={busy || tokens.length === 0 || code.trim().length === 0}
              onClick={() => {
                if (tokens.length > 0) void send.start(code, tokens)
              }}
            >
              {busy ? (
                <Loader className="size-3.5 animate-spin" strokeWidth={1.8} aria-hidden />
              ) : (
                <ArrowRight className="size-3.5 rtl:-scale-x-100" strokeWidth={1.8} aria-hidden />
              )}
              {t('connect.send')}
            </Button>
          </div>

          {busy ? (
            <div className="mt-4">
              <div
                role="progressbar"
                aria-label={t('connect.progress')}
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
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <p className="text-xs text-text-3">
                  {send.stage === 'connecting'
                    ? t('connect.reaching')
                    : send.stage === 'packing'
                      ? t('connect.gathering')
                      : t('connect.percentSent', { percent: Math.round(send.progress * 100) })}
                </p>
                {/* Always a way out. A phone that went quiet used to leave this
                    spinning with every control disabled. Stopping part-way
                    changes nothing on the phone, which acts only on a whole,
                    authenticated transfer. */}
                <Button size="xs" variant="ghost" onClick={send.cancel}>
                  {t('connect.cancel')}
                </Button>
              </div>
            </div>
          ) : null}

          {send.problem === null ? null : (
            <p className="mt-3 text-sm text-warning">{send.problem}</p>
          )}
        </>
      )}
    </Panel>
  )
}
