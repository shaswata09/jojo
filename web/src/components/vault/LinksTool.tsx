import { useId, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link2, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useDomain } from '@/i18n/domain'
import { BucketFilter } from '@/components/common/BucketFilter'
import { EmptyState } from '@/components/common/EmptyState'
import { FormField } from '@/components/common/Field'
import { Panel } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { emptyStateFor } from '@/components/vault/empty-state'
import { matchesQuery } from '@/components/vault/search'
import { VaultSearch, VaultToolbar } from '@/components/vault/VaultToolbar'
import { ApplicationPicker } from '@/components/vault/ApplicationPicker'
import { LinkEditor } from '@/components/vault/links/LinkEditor'
import { LinkRow } from '@/components/vault/links/LinkRow'
import { normalizeUrl, parseUrl, titleFromUrl } from '@/components/vault/links/url'
import { displayName } from '@/data/seed'
import { LINK_CATEGORIES } from '@/data/vault'
import type { LinkCategory, VaultLink } from '@/data/vault'
import { useApplications } from '@jojo/service/react/use-applications'
import { useVault } from '@jojo/service/react/use-vault'
import { useLabels } from '@/lib/labels-context'
import { useToast } from '@/lib/toast-context'
import { useArrivalScroll } from '@/lib/use-arrival-highlight'
import { report } from '@/lib/analytics'
import { announceRefusal } from '@/components/common/write-result'

/**
 * Saved URLs, filed by what they are.
 *
 * These open for real — an anchor to somewhere else on the web needs no local
 * store — and now they can be written as well as followed: paste a URL, and a
 * title is derived from it so saving is one gesture rather than a form.
 */
export function LinksTool({ focus }: { focus?: string }) {
  const { t } = useTranslation('vault')
  const domain = useDomain()
  const [bucket, setBucket] = useState<LinkCategory | 'all'>('all')
  const [query, setQuery] = useState('')
  // The paste field used to be open permanently, which put a text input, a
  // combobox and a Save button above every list in the tab — three controls for
  // an action taken once a session, where the other three tabs have one button.
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftApp, setDraftApp] = useState<string[]>([])
  const [submitted, setSubmitted] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const {
    matches,
    selected: selectedLabels,
    clearSelected,
    labelIdsOf,
    setRecord,
    removeRecord,
  } = useLabels()
  const { byId } = useApplications()
  const { links, addLink, updateLink, removeLink } = useVault()
  const { toast } = useToast()
  // Arrived from a graph node or a query row that named one link — see `focus`
  // in links.ts. The tint fades on its own; this only has to be on screen.
  const focusedRow = useArrivalScroll<HTMLLIElement>(focus)

  const urlId = useId()
  const draftAppId = useId()

  const counts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const l of links) map[l.category] = (map[l.category] ?? 0) + 1
    return map
  }, [links])

  const nameOf = (id?: string) => {
    const app = id ? byId.get(id) : undefined
    return app ? displayName(app) : undefined
  }

  const visible = links.filter(
    (l) =>
      (bucket === 'all' || l.category === bucket) &&
      matches(l.id) &&
      matchesQuery(
        query,
        l.title,
        l.url,
        l.note,
        l.category,
        domain.linkCategory(l.category),
        ...l.applicationIds.map(nameOf),
      ),
  )

  // A new link lands in whatever category is being looked at, so saving while
  // filtered does not file it somewhere the list cannot show it.
  const newCategory: LinkCategory = bucket === 'all' ? 'Posting' : bucket

  const parsed = parseUrl(normalizeUrl(draft))
  const draftError = submitted
    ? draft.trim()
      ? parsed
        ? undefined
        : t('links.errors.url')
      : t('links.errors.empty')
    : undefined

  const closeAdd = () => {
    setAdding(false)
    setDraft('')
    setDraftApp([])
    setSubmitted(false)
  }

  const save = (event: FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (!parsed) return

    const link = addLink({
      title: titleFromUrl(parsed),
      url: normalizeUrl(draft),
      category: newCategory,
      applicationIds: draftApp,
    })
    closeAdd()
    report('vault_item_added', { kind: 'link' })

    // A link saved while a keyword filter is up carries no keywords yet, so it
    // is filed correctly and rendered nowhere. Saying "saved" and showing an
    // unchanged list is how a prototype gets accused of dropping writes.
    const hidden = selectedLabels.size > 0
    toast({
      title: t('common.saved', { title: link.title }),
      description: hidden
        ? t('links.toast.savedHidden', { category: domain.linkCategory(newCategory) })
        : t('links.toast.saved', { category: domain.linkCategory(newCategory) }),
      action: { label: t('common.undo'), onClick: () => removeLink(link.id) },
    })
  }

  const onDuplicate = (link: VaultLink) => {
    const copy = addLink({
      title: t('reminders.copyTitle', { title: link.title }),
      url: link.url,
      category: link.category,
      note: link.note,
      applicationIds: link.applicationIds,
    })
    const keywords = labelIdsOf(link.id)
    if (keywords.length > 0) setRecord(copy.id, keywords)
    toast({
      title: t('reminders.toast.duplicated', { title: link.title }),
      description: t('links.toast.duplicated', { category: domain.linkCategory(copy.category) }),
      action: {
        label: t('common.undo'),
        onClick: () => {
          removeLink(copy.id)
          removeRecord(copy.id)
        },
      },
    })
  }

  const onMove = (link: VaultLink, next: LinkCategory) => {
    const before = link.category
    if (announceRefusal(updateLink(link.id, { category: next }), toast)) return
    toast({
      title: t('reminders.toast.moved', { title: link.title }),
      description:
        bucket !== 'all' && bucket !== next
          ? t('snippets.toast.movedOut', {
              tag: domain.linkCategory(next),
              filter: domain.linkCategory(bucket),
            })
          : t('snippets.toast.moved', { tag: domain.linkCategory(next) }),
      action: {
        label: t('common.undo'),
        onClick: () => updateLink(link.id, { category: before }),
      },
    })
  }

  /**
   * A link is a URL and a title derived from it — seconds to re-save — so it
   * goes on an undo toast rather than a confirmation. Its keywords go with it
   * and come back with it: `removeLink` restores the record only, and one that
   * returned stripped of its keywords is not an undo.
   */
  const onDelete = (link: VaultLink) => {
    const stashed = labelIdsOf(link.id)
    const removed = removeLink(link.id)
    // Refused — already gone, removed by the assistant or another tab: say so
    // rather than "deleted" with an Undo that does nothing.
    if (!removed.ok) {
      toast({
        title: t('common.deleteFailed'),
        description: removed.refusal ?? t('snippets.toast.stillThere', { title: link.title }),
        tone: 'danger',
      })
      return
    }
    const { restore } = removed
    removeRecord(link.id)
    if (editingId === link.id) setEditingId(null)

    toast({
      title: t('common.deleted', { title: link.title }),
      description: t('links.toast.deletedDescription'),
      tone: 'danger',
      action: {
        label: t('common.undo'),
        onClick: () => {
          restore()
          // Guarded: `setRecord` with an empty list files the record as carrying
          // no keywords rather than leaving it unmentioned.
          if (stashed.length > 0) setRecord(link.id, stashed)
        },
      },
    })
  }

  const addButton = (
    <Button
      size="sm"
      aria-expanded={adding}
      onClick={() => (adding ? closeAdd() : setAdding(true))}
    >
      <Plus className="size-3.5" strokeWidth={2} aria-hidden />
      {t('links.add')}
    </Button>
  )

  const empty = emptyStateFor({
    total: links.length,
    query,
    filteredByBucket: bucket !== 'all',
    filteredByKeyword: selectedLabels.size > 0,
    onClearQuery: () => setQuery(''),
    onClearBucket: () => setBucket('all'),
    onClearKeywords: clearSelected,
    copy: {
      zero: {
        title: t('links.empty.zeroTitle'),
        description: t('links.empty.zeroDescription'),
        action: addButton,
      },
      search: (q) => t('links.empty.search', { query: q }),
      both: t('links.empty.both', { category: domain.linkCategory(bucket) }),
      bucket: {
        title: t('links.empty.bucketTitle', { category: domain.linkCategory(bucket) }),
        description: t('links.empty.bucketDescription', { count: links.length }),
        clearLabel: t('links.empty.showAll'),
      },
      keywords: { title: t('links.empty.keywordsTitle') },
    },
  })

  return (
    <Panel className="min-w-0">
      {links.length > 0 ? (
        <VaultToolbar
          filter={
            <BucketFilter
              label={t('links.filterLabel')}
              options={LINK_CATEGORIES}
              labels={Object.fromEntries(LINK_CATEGORIES.map((c) => [c, domain.linkCategory(c)]))}
              counts={counts}
              value={bucket}
              onChange={setBucket}
              total={links.length}
            />
          }
          search={
            <VaultSearch
              label={t('links.searchLabel')}
              placeholder={t('links.searchPlaceholder')}
              value={query}
              onChange={setQuery}
            />
          }
          action={addButton}
        />
      ) : null}

      {adding ? (
        <form noValidate onSubmit={save} className="mb-3.5 rounded-lg border border-hairline p-3">
          <FormField
            label={t('links.form.label')}
            htmlFor={urlId}
            error={draftError}
            hint={t('links.form.hint', { category: domain.linkCategory(newCategory) })}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id={urlId}
                // `type="url"` rather than text for the keyboard it brings up on
                // a phone. Validation stays ours — the browser's rejects
                // everything without a scheme, which is most of what gets pasted.
                type="url"
                // An address reads left to right in an Arabic or Urdu page too, so it
                // shows its start (https://…) rather than its end (review 3, responsive-4).
                dir="ltr"
                inputMode="url"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                placeholder={t('links.form.placeholder')}
                value={draft}
                aria-invalid={draftError ? true : undefined}
                aria-describedby={draftError ? `${urlId}-error` : undefined}
                // Escape backs out of an inline form everywhere else in this
                // app; a row that could only be left with the mouse would be the
                // odd one out.
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return
                  event.preventDefault()
                  closeAdd()
                }}
                onChange={(event) => setDraft(event.target.value)}
                className="min-w-[12rem] flex-1 font-mono text-xs"
              />
              <ApplicationPicker
                id={draftAppId}
                values={draftApp}
                onChange={setDraftApp}
                className="w-48"
              />
              <Button type="submit" size="sm">
                {t('links.form.save')}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={closeAdd}>
                {t('common.cancel')}
              </Button>
            </div>
          </FormField>
        </form>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState
          icon={Link2}
          title={empty.title}
          description={empty.description}
          action={empty.action}
        />
      ) : (
        <ul className="divide-y divide-hairline">
          {visible.map((l) => {
            if (editingId === l.id) {
              return (
                <li key={l.id}>
                  <LinkEditor link={l} onDone={() => setEditingId(null)} />
                </li>
              )
            }

            return (
              <LinkRow
                key={l.id}
                link={l}
                related={l.applicationIds.map((id) => byId.get(id)).filter((a) => a !== undefined)}
                focused={l.id === focus}
                rowRef={l.id === focus ? focusedRow : undefined}
                onEdit={() => setEditingId(l.id)}
                onDuplicate={onDuplicate}
                onMove={onMove}
                onDelete={onDelete}
              />
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
