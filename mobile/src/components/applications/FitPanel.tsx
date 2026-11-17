import { useState } from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '@/components/ui/Button'
import { MenuSheet } from '@/components/ui/Menu'
import type { MenuAction } from '@/components/ui/Menu'
import { Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { STALE_NOTE } from '@jojo/service/core/fit-reading'
import { supersededToast } from '@jojo/service/react/undo'
import { useKg } from '@jojo/service/react/kg-context'
import { useFit } from '@/lib/fit-agent'
import type { FitStep } from '@/lib/fit-agent'
import { useToast } from '@/lib/toast-context'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'
import { useDomain } from '@/i18n/domain'

/**
 * How this application's posting weighs against what the person has done.
 *
 * The phone's half of web's `detail/FitPanel.tsx`, and the same three sections
 * in the same order: a verdict with its reason, what to lead with, what to be
 * ready for. `core/tailor.ts` computes all three and argues that none of them
 * may be a model's prose — every line names a record or a requirement.
 *
 * The four ways this has nothing to say are also the web file's, and each is
 * said differently there for the reason it gives: they are genuinely different
 * situations with different fixes, and one card reading "not enough
 * information" for all of them is a card people stop reading.
 *
 * The state machine is NOT here any more. It was 127 lines copied from the web
 * panel with nothing comparing the two, and it lives in
 * `@jojo/service/react/use-fit` — which is also what makes both apps agree
 * about a reading that is now stored rather than held in memory for a session.
 *
 * Re-run and Clear are in a menu off the title rather than a button under the
 * card, which is where Re-run used to sit while web's was in the header. A
 * destructive action has to cost a menu on both platforms, and putting the pair
 * together is what makes the two screens describe the same feature.
 */

const STEP_KEY: Record<FitStep, string> = {
  reading: 'fit.step.reading',
  asking: 'fit.step.asking',
}

export function FitPanel({ applicationId }: { applicationId: string }) {
  const { t } = useTranslation(['components', 'common'])
  const { text } = useKg()
  const domain = useDomain()
  const c = useColors()
  const fit = useFit(applicationId)
  const { toast } = useToast()
  const [menu, setMenu] = useState(false)
  const { source, guidance } = fit

  const actions: MenuAction[] = [
    // Re-run is the item that needs a model; Clear does not, which is why the
    // menu itself is offered on `ready || reading` and this item on `ready`.
    //
    // And withheld while a read is QUEUED, because pressing it then stacked a
    // second read behind the first. The menu itself stays open in that window:
    // Clear is what stops a queued read landing on a reading the person has
    // just discarded, so it is the one control that must work during it.
    ...(fit.ready && !fit.queued
      ? [
          {
            id: 'rerun',
            label: fit.cleared ? t('fit.measure') : t('fit.rerun'),
            hint: t('fit.rerunHint'),
            icon: 'refresh-cw' as const,
            onPress: fit.rerun,
          },
        ]
      : []),
    ...(fit.reading && !fit.cleared
      ? [
          {
            id: 'clear',
            label: t('fit.clear'),
            hint: t('fit.clearHint'),
            icon: 'trash-2' as const,
            tone: 'danger' as const,
            onPress: () => {
              const cleared = fit.clear()
              if (!cleared) return
              const { result, restore } = cleared
              toast({
                // The title branches: a refusal that announces "Fit reading
                // cleared" and then explains why it did not is a toast arguing
                // with itself.
                title: result.ok ? t('fit.cleared') : t('fit.notCleared'),
                description: result.ok ? t('fit.clearedBody') : (result.errors[0]?.message ?? ''),
                // Hand-wired, because the service toast port types its action as
                // `onClick` and this app's as `onPress`. Dropping it is what made
                // a mis-tap on somebody's own record unrecoverable once already.
                ...(result.ok
                  ? restore
                    ? {
                        action: {
                          label: t('common:actions.undo'),
                          onPress: () => {
                            const outcome = restore()
                            // `undoableWith` declines to put a before-image back
                            // over a record touched since, and says so. Taken
                            // apart rather than passed through: the shared copy
                            // is typed against the service's toast port, whose
                            // action is an `onClick` this provider cannot take —
                            // and this one carries no action at all.
                            if (outcome.superseded.length > 0) {
                              const said = supersededToast(outcome, text)
                              toast({
                                title: said.title,
                                ...(said.description === undefined
                                  ? {}
                                  : { description: said.description }),
                                tone: 'danger',
                              })
                            }
                          },
                        },
                      }
                    : {}
                  : { tone: 'danger' as const }),
              })
            },
          },
        ]
      : []),
  ]

  return (
    <Panel>
      <PanelTitle
        hint={source ? `${source.name} — ${domain.how(source.how)}` : undefined}
        right={
          (fit.ready || fit.reading !== undefined) && fit.step === null ? (
            <IconButton
              icon="more-horizontal"
              // `IconButton`, which is what every other overflow on this app
              // uses — a 40pt target carrying its accessible name, rather than
              // the labelled pill an earlier draft of this file put here on the
              // false belief that no icon-only control existed.
              label={t('fit.options')}
              onPress={() => {
                setMenu(true)
              }}
            />
          ) : undefined
        }
      >
        {t('fit.title')}
      </PanelTitle>

      {fit.blocked === 'no-posting' && (
        <Txt size="sm" tone="secondary">
          {t('fit.blocked.noPosting')}
        </Txt>
      )}

      {fit.blocked === 'no-model' && (
        <Txt size="sm" tone="secondary">
          {t('fit.blocked.noModel')}
        </Txt>
      )}

      {fit.blocked === 'no-background' && (
        <Txt size="sm" tone="secondary">
          {t('fit.blocked.noBackground')}
        </Txt>
      )}

      {/* An answer, not a gap: nothing here offers to fill it in. The menu
          turns back into "Measure this posting", which is the one way back. */}
      {fit.blocked === null && fit.cleared && fit.step === null && !fit.queued && (
        <Txt size="sm" tone="secondary">
          {t('fit.clearedNote')}
        </Txt>
      )}

      {/* Queued is not idle: one job runs at a time and tailoring shares the
          queue, so a read can wait a whole minute before it starts. */}
      {fit.queued && (
        <Txt size="sm" tone="secondary">
          {t('fit.queued')}
        </Txt>
      )}

      {fit.step !== null && (
        <Txt size="sm" tone="secondary">
          {t(STEP_KEY[fit.step])}
        </Txt>
      )}

      {fit.error !== null && (
        <View style={{ gap: space[2] }}>
          <Txt size="sm" color={c.danger}>
            {fit.error}
          </Txt>
          <Button
            size="sm"
            variant="ghost"
            label={t('common:actions.tryAgain')}
            onPress={fit.rerun}
          />
        </View>
      )}

      {guidance && (
        <View style={{ gap: space[4] }}>
          <View style={{ gap: space[1] }}>
            <Txt size="sm" weight="medium">
              {domain.verdict(guidance.verdict)}
            </Txt>
            <Txt size="sm" tone="secondary">
              {guidance.summary}
            </Txt>
          </View>

          {guidance.tailor.length > 0 && (
            <View style={{ gap: space[1.5] }}>
              <Txt size="xs" tone="muted" uppercase>
                {t('fit.leadWith')}
              </Txt>
              {guidance.tailor.map((note) => (
                <View key={note.evidence.id}>
                  <Txt size="sm" weight="medium">
                    {note.evidence.title}
                    {note.evidence.where === undefined ? '' : ` · ${note.evidence.where}`}
                  </Txt>
                  <Txt size="xs" tone="secondary">
                    {t('fit.answers', { requirement: note.answers })}
                  </Txt>
                </View>
              ))}
            </View>
          )}

          {guidance.prepare.length > 0 && (
            <View style={{ gap: space[1.5] }}>
              <Txt size="xs" tone="muted" uppercase>
                {t('fit.beReadyFor')}
              </Txt>
              {guidance.prepare.map((note) => (
                <View key={note.requirement}>
                  <Txt size="sm" weight="medium">
                    {note.requirement}
                    {note.essential ? t('fit.required') : ''}
                  </Txt>
                  <Txt size="xs" tone="secondary">
                    {note.advice}
                  </Txt>
                </View>
              ))}
            </View>
          )}

          {/* Where the answer came from, and how old it is. The price of
              keeping a verdict past the session that produced it: a reload used
              to throw away anything stale and now nothing does. */}
          {fit.readNote && (
            <View>
              <Txt size="xs" tone="muted">
                {fit.readBy && domain.readBy(fit.readBy.model, fit.readBy.day, fit.readBy.today)}
                {fit.reading?.skipped === undefined
                  ? ''
                  : t('fit.skipped', { count: fit.reading.skipped })}
              </Txt>
              {fit.stale && (
                <Txt size="xs" color={c.warning}>
                  {STALE_NOTE[fit.stale]}
                </Txt>
              )}
            </View>
          )}
        </View>
      )}

      <MenuSheet
        open={menu}
        onClose={() => {
          setMenu(false)
        }}
        title={t('fit.title')}
        description={source?.name}
        actions={actions}
      />
    </Panel>
  )
}
