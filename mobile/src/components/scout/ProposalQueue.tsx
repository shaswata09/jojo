import { View } from 'react-native'
import { Button, IconButton } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
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
}: {
  proposals: readonly Proposal[]
  pipelines: readonly Pipeline[]
  onApprove: (id: string) => void
  onDiscard: (id: string) => void
  onSweep: (pipelineId: string) => void
}) {
  const pending = proposals.filter((p) => p.status === 'pending')
  const answered = proposals.filter((p) => p.status !== 'pending')
  const ordered = [...pending, ...answered]
  const nameOf = (id: string | null) => pipelines.find((p) => p.id === id)?.name ?? 'a pipeline'

  // Only offered when everything answered came from one pipeline — a single
  // Clear across two searches is one gesture the user cannot describe after.
  const from = new Set(answered.map((p) => p.pipelineId))
  const sweepable = from.size === 1 ? [...from][0] : null

  return (
    <Panel>
      <PanelTitle hint="nothing happens until you say so">Suggestions</PanelTitle>

      {ordered.length === 0 ? (
        <EmptyState
          icon="inbox"
          title="Nothing to review"
          description="When a pipeline is running, anything it wants to change shows up here first. It will not touch your records until you approve it."
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
                          applied
                        </Chip>
                      ) : null}
                      {p.status === 'discarded' ? (
                        <Chip tone="gray" size="sm">
                          discarded
                        </Chip>
                      ) : null}
                      {p.status === 'failed' ? (
                        <Chip tone="red" size="sm">
                          could not apply
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
                      {p.tool} · from {nameOf(p.pipelineId)}
                    </Txt>
                  </View>

                  {p.status === 'pending' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
                      <Button label="Approve" size="sm" onPress={() => onApprove(p.id)} />
                      <IconButton
                        icon="x"
                        label={`Discard: ${p.title}`}
                        onPress={() => onDiscard(p.id)}
                      />
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
          ))}

          {answered.length > 0 && sweepable ? (
            <View style={{ marginTop: space[2], alignItems: 'flex-start' }}>
              <Button
                label="Clear answered"
                variant="outline"
                size="sm"
                onPress={() => onSweep(sweepable)}
              />
            </View>
          ) : null}
        </>
      )}
    </Panel>
  )
}
