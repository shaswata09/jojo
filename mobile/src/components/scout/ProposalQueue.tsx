import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { EmptyState } from '@/components/ui/EmptyState'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { SearchInput } from '@/components/ui/SearchInput'
import { Sheet } from '@/components/ui/Sheet'
import { Txt } from '@/components/ui/Text'
import { proposalDetail } from '@jojo/service/core/proposal'
import {
  NO_PROPOSAL_FILTER,
  filterCount,
  isFiltering,
  proposalFacets,
  proposalFacts,
  proposalMatches,
  splitProposals,
  toggleFilter,
} from '@jojo/service/core/proposal-filter'
import type {
  FacetValue,
  ProposalFacets,
  ProposalFilter,
} from '@jojo/service/core/proposal-filter'
import type { Pipeline, Proposal } from '@jojo/service/core/model'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'

/**
 * The queue, as rows a person answers one at a time.
 *
 * The web version calls these cards; on a phone the surrounding Panel already
 * gives each row its edges, so they are rows with a rationale under them. What
 * is the same on both is the ordering decision: the reason the agent gives is
 * never behind a disclosure, because it is the thing being judged, and hiding
 * it would make Approve the cheap option on a control that writes to someone's
 * records.
 *
 * Search, filters and the Closed box (Q343), as on the web: the main list is
 * what still needs the person, everything answered sits in its own scrolling
 * box under it, and both are narrowed by the same search and filters. The rules
 * are `core/proposal-filter.ts`, shared with the web. The phone files an
 * approved job straight into Matches or Postings with no second step on the
 * card, so an approved card here is closed.
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
  const c = useColors()
  const [confirming, setConfirming] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filter, setFilter] = useState<ProposalFilter>(NO_PROPOSAL_FILTER)
  const pending = proposals.filter((p) => p.status === 'pending')
  const answered = proposals.filter((p) => p.status !== 'pending')
  const nameOf = (id: string | null) =>
    pipelines.find((p) => p.id === id)?.name ?? t('proposals.aPipeline')

  const { active, closed } = splitProposals(proposals)
  const facts = new Map(proposals.map((p) => [p.id, proposalFacts(p, nameOf(p.pipelineId))]))
  const passes = (p: Proposal) => proposalMatches(facts.get(p.id)!, filter)
  const shownActive = active.filter(passes)
  const shownClosed = closed.filter(passes)
  const filtering = isFiltering(filter)
  const picked = filterCount(filter)
  const facets = proposalFacets(
    [...facts.values()],
    filter,
    (id) => (id === '' ? t('proposals.filter.noPipeline') : nameOf(id)),
    (type) => t(`proposals.filter.types.${type}`),
  )
  const chips = CATEGORIES.flatMap(({ key }) =>
    (filter[key] as readonly string[]).map((value) => ({
      key,
      value,
      label: facets[key].find((v) => v.value === value)?.label ?? value,
    })),
  )

  // Only offered when everything answered came from one pipeline — a single
  // Clear across two searches is one gesture the user cannot describe after.
  const from = new Set(answered.map((p) => p.pipelineId))
  const sweepable = from.size === 1 ? [...from][0] : null

  const rows = (list: readonly Proposal[]) =>
    list.map((p, i) => (
      <View key={p.id}>
        {i > 0 ? <Divider /> : null}
        <ProposalRow
          p={p}
          pipelineName={nameOf(p.pipelineId)}
          onApprove={onApprove}
          onDiscard={onDiscard}
        />
      </View>
    ))

  return (
    <Panel>
      <PanelTitle hint={t('proposals.hint')}>{t('proposals.title')}</PanelTitle>

      {proposals.length === 0 ? (
        <EmptyState
          icon="inbox"
          title={t('proposals.empty.title')}
          description={t('proposals.empty.description')}
        />
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
            <View style={s.fill}>
              <SearchInput
                value={filter.query}
                onChange={(query) => setFilter({ ...filter, query })}
                label={t('proposals.search.label')}
                placeholder={t('proposals.search.placeholder')}
              />
            </View>
            <Button
              label={picked > 0 ? `${t('proposals.filter.button')} · ${String(picked)}` : t('proposals.filter.button')}
              icon="filter"
              variant="outline"
              size="md"
              onPress={() => setFiltersOpen(true)}
            />
          </View>

          {chips.length > 0 ? (
            <View
              accessibilityLabel={t('proposals.filter.active')}
              style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1.5], marginTop: space[2] }}
            >
              {chips.map((chip) => (
                <Pressable
                  key={`${chip.key}:${chip.value}`}
                  accessibilityRole="button"
                  accessibilityLabel={t('proposals.filter.remove', { value: chip.label })}
                  onPress={() => setFilter(toggleFilter(filter, chip.key, chip.value as never))}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space[1],
                    paddingHorizontal: space[2],
                    minHeight: 32,
                    borderRadius: radius.full,
                    borderWidth: 1,
                    borderColor: c.accentBorder,
                    backgroundColor: c.accentSoft,
                  }}
                >
                  <Txt size="sm" tone="accent">
                    {chip.label}
                  </Txt>
                  <Txt size="sm" tone="accent">
                    ×
                  </Txt>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View style={{ marginTop: space[2] }}>
            {shownActive.length > 0 ? (
              rows(shownActive)
            ) : (
              <View style={{ paddingVertical: space[3], gap: space[2] }}>
                <Txt size="sm" tone="muted">
                  {filtering && active.length > 0
                    ? t('proposals.noActiveMatch')
                    : t('proposals.noActive')}
                </Txt>
                {filtering ? (
                  <Button
                    label={t('proposals.filter.clearAll')}
                    variant="ghost"
                    size="sm"
                    onPress={() => setFilter(NO_PROPOSAL_FILTER)}
                  />
                ) : null}
              </View>
            )}
          </View>

          {closed.length > 0 ? (
            <View style={{ marginTop: space[3] }}>
              <Divider />
              <Txt
                size="sm"
                weight="medium"
                tone="secondary"
                accessibilityRole="header"
                style={{ marginTop: space[3], marginBottom: space[2] }}
              >
                {t('proposals.closed.title')} ·{' '}
                {filtering
                  ? t('proposals.closed.countOf', { shown: shownClosed.length, total: closed.length })
                  : String(closed.length)}
              </Txt>
              {shownClosed.length > 0 ? (
                /* Its own scroll, inside the screen's: Android needs
                   `nestedScrollEnabled` for an inner list in the same
                   direction to scroll at all. */
                <ScrollView
                  nestedScrollEnabled
                  style={{
                    maxHeight: 360,
                    borderWidth: 1,
                    borderColor: c.hairline,
                    borderRadius: radius.md,
                    backgroundColor: c.well,
                  }}
                  contentContainerStyle={{ paddingHorizontal: space[3] }}
                >
                  {rows(shownClosed)}
                </ScrollView>
              ) : (
                <Txt size="sm" tone="muted">
                  {t('proposals.noClosedMatch')}
                </Txt>
              )}
            </View>
          ) : null}

          {/* Clear all is not restricted to a single pipeline the way Clear
              answered is: it writes to nothing but the queue, and two
              pipelines both filling the list is exactly when it is wanted. */}
          <View
            style={{
              marginTop: space[3],
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

      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title={t('proposals.filter.title')}
        footer={
          <View style={{ flexDirection: 'row', gap: space[2] }}>
            {picked > 0 ? (
              <Button
                label={t('proposals.filter.clear')}
                variant="outline"
                onPress={() =>
                  setFilter({ ...filter, pipelines: [], types: [], roleTags: [], keywords: [], employers: [] })
                }
              />
            ) : null}
            <Button label={t('proposals.filter.done')} onPress={() => setFiltersOpen(false)} />
          </View>
        }
      >
        <View style={{ gap: space[4] }}>
          {CATEGORIES.map(({ key, label }) => (
            <FacetGroup
              key={key}
              title={t(label)}
              values={facets[key]}
              picked={filter[key] as readonly string[]}
              onToggle={(value) => setFilter(toggleFilter(filter, key, value as never))}
            />
          ))}
        </View>
      </Sheet>

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

/** The filterable categories, in the order the sheet lists them; labels are catalog keys. */
const CATEGORIES = [
  { key: 'pipelines', label: 'proposals.filter.pipeline' },
  { key: 'types', label: 'proposals.filter.type' },
  { key: 'roleTags', label: 'proposals.filter.roleTag' },
  { key: 'keywords', label: 'proposals.filter.keyword' },
  { key: 'employers', label: 'proposals.filter.employer' },
] as const satisfies readonly { key: keyof ProposalFacets; label: string }[]

/** One category in the filter sheet: its values as toggles, with how many cards carry each. */
function FacetGroup({
  title,
  values,
  picked,
  onToggle,
}: {
  title: string
  values: readonly FacetValue[]
  picked: readonly string[]
  onToggle: (value: string) => void
}) {
  const { t } = useTranslation('components')
  const c = useColors()
  return (
    <View accessibilityLabel={title}>
      <Txt size="sm" weight="medium" tone="secondary" accessibilityRole="header" style={{ marginBottom: space[2] }}>
        {title}
      </Txt>
      {values.length === 0 ? (
        <Txt size="sm" tone="muted">
          {t('proposals.filter.none')}
        </Txt>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1.5] }}>
          {values.map((v) => {
            const on = picked.includes(v.value)
            return (
              <Pressable
                key={v.value}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, selected: on }}
                accessibilityLabel={`${v.label}, ${String(v.count)}`}
                onPress={() => onToggle(v.value)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space[1.5],
                  maxWidth: '100%',
                  paddingHorizontal: space[3],
                  minHeight: 36,
                  borderRadius: radius.full,
                  borderWidth: 1,
                  backgroundColor: on ? c.accentSoft : c.well,
                  borderColor: on ? c.accentBorder : c.hairline,
                }}
              >
                <Txt size="sm" weight={on ? 'medium' : 'regular'} tone={on ? 'accent' : 'secondary'} numberOfLines={1} style={{ flexShrink: 1 }}>
                  {v.label}
                </Txt>
                <Txt size="xs" mono tone="muted">
                  {v.count}
                </Txt>
              </Pressable>
            )
          })}
        </View>
      )}
    </View>
  )
}

/** One suggestion: what it would do, why, and — while it is pending — Approve and Discard. */
function ProposalRow({
  p,
  pipelineName,
  onApprove,
  onDiscard,
}: {
  p: Proposal
  pipelineName: string
  onApprove: (id: string) => void
  onDiscard: (id: string) => void
}) {
  const { t } = useTranslation('components')
  return (
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
            {t('proposals.from', { tool: p.tool, pipeline: pipelineName })}
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
  )
}
