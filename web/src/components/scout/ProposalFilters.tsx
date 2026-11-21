import { useId, useState } from 'react'
import { ListFilter, Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { filterCount, toggleFilter } from '@jojo/service/core/proposal-filter'
import type {
  FacetValue,
  ProposalFacets,
  ProposalFilter,
} from '@jojo/service/core/proposal-filter'

/** The filterable categories, in the order the menu lists them; labels are catalog keys. */
const CATEGORIES = [
  { key: 'pipelines', label: 'proposals.filter.pipeline' },
  { key: 'types', label: 'proposals.filter.type' },
  { key: 'roleTags', label: 'proposals.filter.roleTag' },
  { key: 'keywords', label: 'proposals.filter.keyword' },
  { key: 'employers', label: 'proposals.filter.employer' },
] as const satisfies readonly { key: keyof ProposalFacets; label: string }[]

type Category = (typeof CATEGORIES)[number]['key']

/**
 * The search box and the filter menu above the suggestions (Q343).
 *
 * Search filters as you type, with no debounce: the queue is tens of cards,
 * not the thousands of records the Applications search has to hold its text
 * against (see `SearchInput` there), and it is not in the URL.
 *
 * The categories sit behind one Filter button rather than as rows of chips: a
 * busy queue has dozens of employers, and five rows of chips would push the
 * cards — the thing being answered — below the fold. What is picked is shown
 * outside the menu, as chips that each turn their value off, so a narrowed
 * queue always says why it is narrowed.
 */
export function ProposalFilters({
  filter,
  facets,
  onChange,
}: {
  filter: ProposalFilter
  facets: ProposalFacets
  onChange: (next: ProposalFilter) => void
}) {
  const { t } = useTranslation('scout')
  const searchId = useId()
  const [open, setOpen] = useState(false)
  const picked = filterCount(filter)

  const toggle = (category: Category, value: string) =>
    onChange(toggleFilter(filter, category, value as never))

  // What is picked, for the chips under the box: each with its category's
  // facet entry, so the chip shows the label the menu showed.
  const chips = CATEGORIES.flatMap(({ key }) =>
    (filter[key] as readonly string[]).map((value) => ({
      key,
      value,
      label: facets[key].find((v) => v.value === value)?.label ?? value,
    })),
  )

  return (
    <div className="mb-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-[220px]">
          <label htmlFor={searchId} className="sr-only">
            {t('proposals.search.label')}
          </label>
          <Search
            aria-hidden
            strokeWidth={1.8}
            className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-3"
          />
          <Input
            id={searchId}
            type="search"
            value={filter.query}
            onChange={(e) => onChange({ ...filter, query: e.target.value })}
            placeholder={t('proposals.search.placeholder')}
            className="ps-8"
          />
        </div>

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" aria-label={t('proposals.filter.buttonAria', { picked })}>
              <ListFilter className="size-3.5" strokeWidth={1.8} aria-hidden />
              {t('proposals.filter.button')}
              {picked > 0 ? (
                <span className="rounded-full bg-accent-soft px-1.5 text-xs font-medium text-accent">
                  {picked}
                </span>
              ) : null}
            </Button>
          </PopoverTrigger>
          {/* Scrolls inside itself: five categories with a few dozen employers
              between them is taller than a laptop screen. */}
          <PopoverContent align="end" className="max-h-[min(28rem,70vh)] w-80 overflow-y-auto">
            <div className="flex flex-col gap-3">
              {CATEGORIES.map(({ key, label }) => (
                <FacetGroup
                  key={key}
                  title={t(label)}
                  values={facets[key]}
                  picked={filter[key] as readonly string[]}
                  onToggle={(value) => toggle(key, value)}
                />
              ))}
              {picked > 0 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="self-start"
                  onClick={() => onChange({ ...filter, pipelines: [], types: [], roleTags: [], keywords: [], employers: [] })}
                >
                  {t('proposals.filter.clear')}
                </Button>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {chips.length > 0 ? (
        <ul className="flex flex-wrap items-center gap-1.5" aria-label={t('proposals.filter.active')}>
          {chips.map((c) => (
            <li key={`${c.key}:${c.value}`}>
              <button
                type="button"
                onClick={() => toggle(c.key, c.value)}
                aria-label={t('proposals.filter.remove', { value: c.label })}
                className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-accent-border bg-accent-soft px-2 py-0.5 text-xs whitespace-nowrap text-accent transition-colors hover:bg-accent-soft/70"
              >
                {c.label}
                <X className="size-3" strokeWidth={2} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * One category in the menu: its values as toggle chips with how many cards
 * carry each. A category no card carries says so rather than vanishing, so
 * the menu has the same five headings every time it opens.
 */
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
  const { t } = useTranslation('scout')
  return (
    <div role="group" aria-label={title}>
      <p className="mb-1.5 text-xs font-medium text-text-2">{title}</p>
      {values.length === 0 ? (
        <p className="text-xs text-text-3">{t('proposals.filter.none')}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => {
            const on = picked.includes(v.value)
            return (
              <button
                key={v.value}
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(v.value)}
                className={cn(
                  'flex max-w-full shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                  on
                    ? 'border-accent-border bg-accent-soft font-medium text-accent'
                    : 'border-hairline text-text-2 hover:text-text-1',
                )}
              >
                <span className="truncate">{v.label}</span>
                <span className="text-text-3 [unicode-bidi:isolate]">{v.count}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
