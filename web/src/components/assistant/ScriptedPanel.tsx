import type { LucideIcon } from 'lucide-react'
import { ArrowUp, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router'
import { Trans, useTranslation } from 'react-i18next'
import { RobotIcon } from '@/components/brand/RobotIcon'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { Panel } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useTitle } from '@/lib/links'
import { OpenerList } from './OpenerList'
import { ScriptedMessage } from './ScriptedMessage'
import { SCRIPTS } from './scripts'
import { useScriptedConversation } from './use-scripted-conversation'

/**
 * The assistant with no model behind it.
 *
 * Everything here is a worked example and says so. This was the whole page
 * before Settings could reach a model, and it is unchanged in behaviour — what
 * changed is that it no longer has to ASK whether one is connected, because
 * `Assistant` above answered that before rendering it. The `connected` branches
 * that used to be threaded through every string are gone with it.
 */
export function ScriptedPanel() {
  const { t } = useTranslation('assistant')
  useTitle(t('common.title'))
  const c = useScriptedConversation()
  // Built per render rather than at import, so the labels follow the language.
  const openers = SCRIPTS.map((s) => ({ key: s.id, label: s.action }))
  // A quick action names its script outright: the cues that pick a script from
  // typed text are English, and a translated label would not find them.
  const pick = (label: string) => c.send(label, openers.find((o) => o.label === label)?.key)

  return (
    <>
      <PageHeader
        title={t('common.title')}
        subtitle={t('scripted.subtitle')}
        actions={
          c.messages.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={c.clearConversation}>
              {t('scripted.clear')}
            </Button>
          ) : null
        }
      />

      {/* Stated once, at the top, in the same words the Job scout uses for the
          same fact. The per-reply badge below repeats it because a reply that
          scrolled away from this banner would otherwise read as a real answer.

          Connected, it says the opposite thing and is not a warning: which model
          and at what address, because "where did that answer come from" is the
          question a local-first app has to be able to answer on the page rather
          than in Settings. */}
      <div
        role="status"
        className="flex items-start gap-2.5 rounded-lg border border-warning-border bg-warning-soft px-4 py-3 text-sm text-warning"
      >
        <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} aria-hidden />
        <p>
          <Trans
            t={t}
            i18nKey="scripted.notConnected"
            components={{
              settings: <Link to="/settings" className="underline underline-offset-2" />,
            }}
          />
        </p>
      </div>

      <Panel className="min-w-0">
        {c.messages.length === 0 ? (
          <EmptyState
            // EmptyState takes a Lucide component; the brand mark is a plain
            // SVG with the same three props, so the cast is safe and is how the
            // rest of the app has always passed it.
            icon={RobotIcon as unknown as LucideIcon}
            title={t('common.nothingAsked')}
            description={t('scripted.emptyDescription')}
          />
        ) : (
          // A log, so both halves are announced in the order they arrive.
          <ul aria-live="polite" className="space-y-3">
            {c.messages.map((m) => (
              <ScriptedMessage
                key={m.id}
                message={m}
                copied={c.copiedId === m.id}
                copyFailed={c.copyFailed}
                onCopy={(id, text) => void c.copy(id, text)}
                onSave={c.saveToSnippets}
              />
            ))}
          </ul>
        )}

        {/* Announced rather than only shown: the confirmation appears on a
            button the user has just left, and a swapped icon is easy to miss. */}
        <p aria-live="polite" className="sr-only">
          {c.copiedId ? (c.copyFailed ? t('common.copyBlocked') : t('common.copied')) : ''}
        </p>

        {/* Empty thread only, exactly as the connected panel does it — the two
            must not visibly diverge for the person who has not set a model up
            yet, and that includes when the openers disappear. */}
        {c.messages.length === 0 ? <OpenerList openers={openers} onPick={pick} /> : null}

        <form onSubmit={c.onSubmit} className="mt-2 flex gap-2">
          <div className="min-w-0 flex-1">
            <Label htmlFor="assistant-prompt" className="sr-only">
              {t('common.askLabel')}
            </Label>
            <Textarea
              id="assistant-prompt"
              value={c.prompt}
              rows={2}
              // Fixed, for the reasons set out on the connected composer above.
              className="field-sizing-fixed h-16 resize-none overflow-y-auto"
              autoComplete="off"
              placeholder={t('scripted.placeholder')}
              onChange={(event) => c.setPrompt(event.target.value)}
              onKeyDown={c.onComposerKey}
            />
          </div>
          <Button
            type="submit"
            size="icon"
            aria-label={t('composer.send')}
            disabled={!c.prompt.trim()}
            title={c.prompt.trim() ? t('composer.send') : t('composer.typeFirst')}
          >
            <ArrowUp className="size-4" strokeWidth={2} aria-hidden />
          </Button>
        </form>
      </Panel>

      <p className="text-sm text-text-2">{t('scripted.footer')}</p>
    </>
  )
}
