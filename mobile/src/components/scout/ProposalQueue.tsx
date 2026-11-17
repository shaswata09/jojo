import { useState } from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { EmptyState } from '@/components/ui/EmptyState'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { proposalDetail } from '@jojo/service/core/proposal'
import type { Pipeline, Proposal } from '@jojo/service/core/model'
import { s } from '@/theme/styles'
import { space } from '@/theme/tokens'

/**
 * The queue, as rows a person answers one at a time.
 *
 * The web version calls these cards; on a phone the surrounding Panel already
 * gives each row its edges, so they are rows with a rationale under them. What
 * is the same on both is the ordering decision: the reason the agent gives is
 * never behind a disclosure, because it is the thing being judged, and hiding
 * it would make Approve the cheap option on a control that writes to someone's
 * records.
 */
export function ProposalQueue({
  proposals,
  pipelines,
  onApprove,
  onDiscard,
  onSweep,
  onClearAll,
}: {
  proposals: readonly Proposal[]
  pipelines: readonly Pipeline[]
  onApprove: (id: string) => void
  onDiscard: (id: string) => void
  onSweep: (pipelineId: string) => void
  onClearAll: () => void
}) {
  const { t } = useTranslation('components')
  const [confirming, setConfirming] = useState(false)
  const pending = proposals.filter((p) => p.status === 'pending')
  const answered = proposals.filter((p) => p.status !== 'pending')
  const ordered = [...pending, ...answered]
  const nameOf = (id: string | null) =>
    pipelines.find((p) => p.id === id)?.name ?? t('proposals.aPipeline')

  // Only offered when everything answered came from one pipeline — a single
  // Clear across two searches is one gesture the user cannot describe after.
  const from = new Set(answered.map((p) => p.pipelineId))
  const sweepable = from.size === 1 ? [...from][0] : null

  return (
    <Panel>
      <PanelTitle hint={t('proposals.hint')}>{t('proposals.title')}</PanelTitle>

      {ordered.length === 0 ? (
        <EmptyState
          icon="inbox"
          title={t('proposals.empty.title')}
          description={t('proposals.empty.description')}
        />
      ) : (
        <>
          {ordered.map((p, i) => (
            <View key={p.id}>
              {i > 0 ? <Divider /> : null}
              <View style={{ paddingVertical: space[2] }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2] }}>
                  <View style={s.fill}>
                    <View
                      style={{
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: space[1.5],
                      }}
                    >
                      <Txt
                        size="sm"
                        weight="medium"
                        tone={p.status === 'pending' ? 'primary' : 'muted'}
                      >
                        {p.title}
                      </Txt>
                      {p.status === 'approved' ? (
                        <Chip tone="green" size="sm">
                          {t('proposals.applied')}
                        </Chip>
                      ) : null}
                      {p.status === 'discarded' ? (
                        <Chip tone="gray" size="sm">
                          {t('proposals.discarded')}
                        </Chip>
                      ) : null}
                      {p.status === 'failed' ? (
                        <Chip tone="red" size="sm">
                          {t('proposals.failed')}
                        </Chip>
                      ) : null}
                    </View>

                    {/* What it would actually write. The card used to show the
                        operation and the reason and never the VALUE — someone
                        was being asked to approve a note without being shown
                        the note. See `proposalDetail`. */}
                    {proposalDetail(p.input) ? (
                      <Txt size="xs" style={{ marginTop: space[1] }}>
                        {proposalDetail(p.input)}
                      </Txt>
                    ) : null}

                    {p.rationale ? (
                      <Txt size="xs" tone="muted" style={{ marginTop: space[1] }}>
                        {p.rationale}
                      </Txt>
                    ) : null}

                    {p.status === 'failed' && p.error ? (
                      <Txt size="xs" tone="danger" style={{ marginTop: space[1] }}>
                        {p.error}
                      </Txt>
                    ) : null}

                    {/* What it would actually run. A person approving a write
                        to their own records is entitled to know which
                        operation they are approving; the title is a paraphrase. */}
                    <Txt
                      size="xs"
                      tone="muted"
                      mono
                      numberOfLines={1}
                      style={{ marginTop: space[1] }}
                    >
                      {t('proposals.from', { tool: p.tool, pipeline: nameOf(p.pipelineId) })}
                    </Txt>
                  </View>

                  {p.status === 'pending' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
                      <Button
                        label={t('proposals.approve')}
                        size="sm"
                        onPress={() => onApprove(p.id)}
                      />
                      <IconButton
                        icon="x"
                        label={t('proposals.discardNamed', { title: p.title })}
                        onPress={() => onDiscard(p.id)}
                      />
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
          ))}

          {/* Clear all is not restricted to a single pipeline the way Clear
              answered is: it writes to nothing but the queue, and two
              pipelines both filling the list is exactly when it is wanted. */}
          <View
            style={{
              marginTop: space[2],
              flexDirection: 'row',
              alignItems: 'center',
              gap: space[2],
            }}
          >
            {answered.length > 0 && sweepable ? (
              <Button
                label={t('proposals.clearAnswered')}
                variant="outline"
                size="sm"
                onPress={() => onSweep(sweepable)}
              />
            ) : null}
            <Button
              label={t('proposals.clearAll')}
              variant="outline"
              size="sm"
              onPress={() => setConfirming(true)}
            />
          </View>
        </>
      )}

      {/* Confirmed because it declines: anything still pending is a decision
          the person has not made, and this makes it for them. */}
      <ConfirmSheet
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('proposals.confirmTitle')}
        description={
          pending.length > 0
            ? t('proposals.confirmPending', { count: pending.length })
            : t('proposals.confirmAnswered')
        }
        confirmLabel={t('proposals.clearAll')}
        tone="danger"
        onConfirm={onClearAll}
      />
    </Panel>
  )
}
