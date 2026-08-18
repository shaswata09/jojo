import { useId, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link2, Plus } from 'lucide-react'
import { BucketFilter } from '@/components/common/BucketFilter'
import { EmptyState } from '@/components/common/EmptyState'
import { FormField } from '@/components/common/Field'
import { Panel } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { emptyStateFor } from '@/components/vault/empty-state'
import { matchesQuery } from '@/components/vault/search'
import { VaultSearch, VaultToolbar } from '@/components/vault/VaultToolbar'
import { ApplicationPicker } from '@/components/vault/links/ApplicationPicker'
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

/**
 * Saved URLs, filed by what they are.
 *
 * These open for real — an anchor to somewhere else on the web needs no local
 * store — and now they can be written as well as followed: paste a URL, and a
 * title is derived from it so saving is one gesture rather than a form.
 */
export function LinksTool({ focus }: { focus?: string }) {
  const [bucket, setBucket] = useState<LinkCategory | 'all'>('all')
  const [query, setQuery] = useState('')
  // The paste field used to be open permanently, which put a text input, a
  // combobox and a Save button above every list in the tab — three controls for
  // an action taken once a session, where the other three tabs have one button.
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftApp, setDraftApp] = useState<string | undefined>(undefined)
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
      matchesQuery(query, l.title, l.url, l.note, l.category, nameOf(l.applicationId)),
  )

  // A new link lands in whatever category is being looked at, so saving while
  // filtered does not file it somewhere the list cannot show it.
  const newCategory: LinkCategory = bucket === 'all' ? 'Posting' : bucket

  const parsed = parseUrl(normalizeUrl(draft))
  const draftError = submitted
    ? draft.trim()
      ? parsed
        ? undefined
        : 'That needs a host, like jobs.rice.edu/postings.'
      : 'Paste a URL to save it.'
    : undefined

  const closeAdd = () => {
    setAdding(false)
    setDraft('')
    setDraftApp(undefined)
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
      applicationId: draftApp,
    })
    closeAdd()

    // A link saved while a keyword filter is up carries no keywords yet, so it
    // is filed correctly and rendered nowhere. Saying "saved" and showing an
    // unchanged list is how a prototype gets accused of dropping writes.
    const hidden = selectedLabels.size > 0
    toast({
      title: `${link.title} saved`,
      description: hidden
        ? `Filed under ${newCategory} — hidden while the keyword filter is on.`
        : `Filed under ${newCategory}, with a title read off the URL.`,
      action: { label: 'Undo', onClick: () => removeLink(link.id) },
    })
  }

  const onDuplicate = (link: VaultLink) => {
    const copy = addLink({
      title: `${link.title} (copy)`,
      url: link.url,
      category: link.category,
      note: link.note,
      applicationId: link.applicationId,
    })
    const keywords = labelIdsOf(link.id)
    if (keywords.length > 0) setRecord(copy.id, keywords)
    toast({
      title: `${link.title} duplicated`,
      description: `The copy is filed under ${copy.category}, ready to be edited.`,
      action: {
        label: 'Undo',
        onClick: () => {
          removeLink(copy.id)
          removeRecord(copy.id)
        },
      },
    })
  }

  const onMove = (link: VaultLink, next: LinkCategory) => {
    const before = link.category
    updateLink(link.id, { category: next })
    toast({
      title: `${link.title} moved`,
      description: `Filed under ${next}${bucket !== 'all' && bucket !== next ? ` — out of the ${bucket} list you are looking at` : ''}.`,
      action: { label: 'Undo', onClick: () => updateLink(link.id, { category: before }) },
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
    const { restore } = removeLink(link.id)
    removeRecord(link.id)
    if (editingId === link.id) setEditingId(null)

    toast({
      title: `${link.title} deleted`,
      description: 'Gone from the vault. The page it points at is untouched.',
      tone: 'danger',
      action: {
        label: 'Undo',
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
      Add link
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
        title: 'No links saved yet',
        description:
          'Save a URL — a posting, a department page, a person you were told to contact. The title is read off the address.',
        action: addButton,
      },
      search: (q) => `No link mentions "${q}" in its title, address, note or category.`,
      both: `No ${bucket} link carries the selected keywords.`,
      bucket: {
        title: `No links under ${bucket}`,
        description: `${links.length} links are filed under the other categories.`,
        clearLabel: 'Show all categories',
      },
      keywords: { title: 'No links carry those keywords' },
    },
  })

  return (
    <Panel className="min-w-0">
      {links.length > 0 ? (
        <VaultToolbar
          filter={
            <BucketFilter
              label="Filter links by category"
              options={LINK_CATEGORIES}
              counts={counts}
              value={bucket}
              onChange={setBucket}
              total={links.length}
            />
          }
          search={
            <VaultSearch
              label="Search links"
              placeholder="Search title, address or note"
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
            label="Save a link"
            htmlFor={urlId}
            error={draftError}
            hint={`Saved under ${newCategory}, with a title read off the URL. Edit any row to change either.`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id={urlId}
                // `type="url"` rather than text for the keyboard it brings up on
                // a phone. Validation stays ours — the browser's rejects
                // everything without a scheme, which is most of what gets pasted.
                type="url"
                inputMode="url"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste a URL…"
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
                value={draftApp}
                onChange={setDraftApp}
                className="w-48"
              />
              <Button type="submit" size="sm">
                Save link
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={closeAdd}>
                Cancel
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
                related={l.applicationId ? byId.get(l.applicationId) : undefined}
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
