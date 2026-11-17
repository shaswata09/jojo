import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { FormField } from '@/components/common/Field'
import { GRAPH_RELS, NODE_TYPE_LABEL, REL_LABEL } from '@/lib/graph/model'
import type { GraphNode, GraphNodeType } from '@/lib/graph/model'
import { ITEM_FACETS } from '@/lib/graph/query'
import type { ItemFacet, PathQuery, PatternQuery } from '@/lib/graph/query'
import { domain } from '@/i18n/domain'
import { truncate } from './truncate'

/**
 * The controls that write the query — the whole builder, in one file.
 *
 * A pattern is read left to right as a sentence: these records, this condition,
 * this relationship, that kind of thing on the other end. The selects that only
 * apply sometimes (`Of kind`, `How many`, `Carrying keyword`) are mounted only
 * when they do, so the form never shows a control that cannot affect the answer.
 *
 * Every change is committed immediately by the caller. There is no Run button,
 * because a Run button creates a state where the table on screen and the
 * controls above it disagree about what was asked.
 */

const SELECT_CLASS =
  'h-8 w-full cursor-pointer rounded-lg border border-input bg-transparent px-2 text-sm text-text-1 transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

const facetLabel = (facet: ItemFacet, t: TFunction<'graph'>) =>
  facet === 'any'
    ? t('fields.anyKind')
    : facet === 'reminder'
      ? t('fields.reminder')
      : domain.kind(facet)

export function PatternFields({
  fieldId,
  pattern,
  presentTypes,
  keywords,
  onEdit,
}: {
  fieldId: string
  pattern: PatternQuery
  /** Only the kinds this session actually holds — see `QueryPanel`. */
  presentTypes: GraphNodeType[]
  keywords: GraphNode[]
  onEdit: (patch: Partial<PatternQuery>) => void
}) {
  const { t } = useTranslation('graph')
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      <FormField label={t('fields.records')} htmlFor={`${fieldId}-start`}>
        <select
          id={`${fieldId}-start`}
          className={SELECT_CLASS}
          value={pattern.start}
          onChange={(event) => onEdit({ start: event.target.value as PatternQuery['start'] })}
        >
          <option value="any">{t('fields.anyRecord')}</option>
          {presentTypes.map((type) => (
            <option key={type} value={type}>
              {NODE_TYPE_LABEL[type]}
            </option>
          ))}
        </select>
      </FormField>

      {pattern.start === 'item' ? (
        <FormField label={t('fields.ofKind')} htmlFor={`${fieldId}-start-facet`}>
          <select
            id={`${fieldId}-start-facet`}
            className={SELECT_CLASS}
            value={pattern.startFacet ?? 'any'}
            onChange={(event) => onEdit({ startFacet: event.target.value as ItemFacet })}
          >
            {ITEM_FACETS.map((facet) => (
              <option key={facet} value={facet}>
                {facetLabel(facet, t)}
              </option>
            ))}
          </select>
        </FormField>
      ) : null}

      <FormField label={t('fields.condition')} htmlFor={`${fieldId}-quantifier`}>
        <select
          id={`${fieldId}-quantifier`}
          className={SELECT_CLASS}
          value={pattern.quantifier}
          onChange={(event) =>
            onEdit({ quantifier: event.target.value as PatternQuery['quantifier'] })
          }
        >
          <option value="has">{t('fields.quantifier.has')}</option>
          <option value="missing">{t('fields.quantifier.missing')}</option>
          <option value="atLeast">{t('fields.quantifier.atLeast')}</option>
        </select>
      </FormField>

      {pattern.quantifier === 'atLeast' ? (
        <FormField label={t('fields.howMany')} htmlFor={`${fieldId}-at-least`}>
          <select
            id={`${fieldId}-at-least`}
            className={SELECT_CLASS}
            value={pattern.atLeast ?? 2}
            onChange={(event) => onEdit({ atLeast: Number(event.target.value) })}
          >
            {[2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {t('fields.orMore', { count: n })}
              </option>
            ))}
          </select>
        </FormField>
      ) : null}

      <FormField label={t('fields.relationship')} htmlFor={`${fieldId}-rel`}>
        <select
          id={`${fieldId}-rel`}
          className={SELECT_CLASS}
          value={pattern.rel}
          onChange={(event) => onEdit({ rel: event.target.value as PatternQuery['rel'] })}
        >
          <option value="any">{t('fields.anyRelationship')}</option>
          {GRAPH_RELS.map((rel) => (
            <option key={rel} value={rel}>
              {REL_LABEL[rel]} ({rel})
            </option>
          ))}
        </select>
      </FormField>

      <FormField label={t('fields.connectedTo')} htmlFor={`${fieldId}-end`}>
        <select
          id={`${fieldId}-end`}
          className={SELECT_CLASS}
          value={pattern.end}
          onChange={(event) => onEdit({ end: event.target.value as PatternQuery['end'] })}
        >
          <option value="any">{t('fields.anything')}</option>
          {presentTypes.map((type) => (
            <option key={type} value={type}>
              {NODE_TYPE_LABEL[type]}
            </option>
          ))}
        </select>
      </FormField>

      {pattern.end === 'item' ? (
        <FormField label={t('fields.ofKind')} htmlFor={`${fieldId}-end-facet`}>
          <select
            id={`${fieldId}-end-facet`}
            className={SELECT_CLASS}
            value={pattern.endFacet ?? 'any'}
            onChange={(event) => onEdit({ endFacet: event.target.value as ItemFacet })}
          >
            {ITEM_FACETS.map((facet) => (
              <option key={facet} value={facet}>
                {facetLabel(facet, t)}
              </option>
            ))}
          </select>
        </FormField>
      ) : null}

      {keywords.length > 0 ? (
        <FormField label={t('fields.keyword')} htmlFor={`${fieldId}-keyword`}>
          <select
            id={`${fieldId}-keyword`}
            className={SELECT_CLASS}
            value={pattern.keywordId ?? ''}
            onChange={(event) => onEdit({ keywordId: event.target.value || undefined })}
          >
            <option value="">{t('fields.anyKeyword')}</option>
            {keywords.map((keyword) => (
              <option key={keyword.id} value={keyword.id}>
                {keyword.label}
              </option>
            ))}
          </select>
        </FormField>
      ) : null}
    </div>
  )
}

export function PathFields({
  fieldId,
  path,
  presentTypes,
  nodesByType,
  onEdit,
}: {
  fieldId: string
  /** Already normalised against the graph by `QueryPanel`. */
  path: PathQuery
  presentTypes: GraphNodeType[]
  nodesByType: ReadonlyMap<GraphNodeType, GraphNode[]>
  onEdit: (patch: Partial<PathQuery>) => void
}) {
  const { t } = useTranslation('graph')
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      <FormField label={t('fields.from')} htmlFor={`${fieldId}-from`}>
        <NodePicker
          id={`${fieldId}-from`}
          types={presentTypes}
          nodesByType={nodesByType}
          value={path.from}
          onChange={(id) => onEdit({ from: id })}
        />
      </FormField>
      <FormField label={t('fields.to')} htmlFor={`${fieldId}-to`}>
        <NodePicker
          id={`${fieldId}-to`}
          types={presentTypes}
          nodesByType={nodesByType}
          value={path.to}
          onChange={(id) => onEdit({ to: id })}
        />
      </FormField>
    </div>
  )
}

/** One record out of the whole graph, grouped by kind so the list is scannable. */
function NodePicker({
  id,
  types,
  nodesByType,
  value,
  onChange,
}: {
  id: string
  types: GraphNodeType[]
  nodesByType: ReadonlyMap<GraphNodeType, GraphNode[]>
  value: string
  onChange: (id: string) => void
}) {
  return (
    <select
      id={id}
      className={SELECT_CLASS}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {types.map((type) => (
        <optgroup key={type} label={NODE_TYPE_LABEL[type]}>
          {(nodesByType.get(type) ?? []).map((node) => (
            <option key={node.id} value={node.id}>
              {truncate(node.label, 38)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
