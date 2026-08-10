import { useId, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { ChevronsUpDown, Copy, ExternalLink, Link2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { BucketFilter } from '@/components/common/BucketFilter'
import { EmptyState } from '@/components/common/EmptyState'
import { Field, FormField } from '@/components/common/Field'
import { LabelChips, LabelPicker } from '@/components/common/LabelFilter'
import { Panel } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { MenuItem, MenuSection, RowMenu } from '@/components/vault/RowMenu'
import { VaultSearch, VaultToolbar, matchesQuery } from '@/components/vault/VaultToolbar'
import { displayName } from '@/data/seed'
import { LINK_CATEGORIES } from '@/data/vault'
import type { LinkCategory, VaultLink } from '@/data/vault'
import { useApplications } from '@/kg/react/use-applications'
import { useVault } from '@/kg/react/use-vault'
import { useLabels } from '@/lib/labels-context'
import { appPath } from '@/lib/links'
import { useToast } from '@/lib/toast-context'
import { useArrivalScroll } from '@/lib/use-arrival-highlight'
import { cn } from '@/lib/utils'

/** Strips the scheme and any trailing slash, so the host reads at a glance. */
function hostOf(url: string) {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

/**
 * Height and border of a Field's input, which a bare `select` cannot inherit.
 */
const SELECT_CLASS =
  'h-8 w-full cursor-pointer rounded-lg border border-input bg-transparent px-2 text-sm text-text-1 transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

/**
 * Takes what people actually paste.
 *
 * 'jobs.rice.edu/postings' is a URL to everyone except `new URL`, so a missing
 * scheme is filled in rather than rejected — refusing the most common form of
 * paste would make the field feel broken.
 */
function normalizeUrl(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

/**
 * The URL as a URL, or null. A host with no dot in it ('notes', 'localhost') is
 * refused too: `new URL` accepts those happily and a link to one goes nowhere.
 */
function parseUrl(raw: string) {
  try {
    const url = new URL(raw)
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) return null
    return url
  } catch {
    return null
  }
}

/** A stray '%' is not an escape sequence, and `decodeURIComponent` throws on it. */
function safeDecode(segment: string) {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/**
 * A title good enough to save without stopping to type one.
 *
 * The last path segment names most postings — '…/postings/statistics-tt' — so it
 * leads, with the host behind it for context. A bare host keeps just the host.
 * The guess is often clumsy, which is what row-level Edit is for.
 */
function titleFromUrl(url: URL) {
  const host = url.hostname.replace(/^www\./, '')
  const slug = url.pathname.split('/').filter(Boolean).pop()
  if (!slug) return host

  const words = safeDecode(slug)
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[-_+]+/g, ' ')
    .trim()

  return words ? `${host} — ${words}` : host
}

/**
 * Files a record under a job, or under nothing.
 *
 * The same combobox the timeline dialog uses, kept here rather than shared
 * because the two differ in one thing that matters: this one is inline in a
 * list, so its trigger has to survive a narrow column.
 */
function ApplicationPicker({
  id,
  value,
  onChange,
  className,
}: {
  id?: string
  value?: string
  onChange: (id: string | undefined) => void
  className?: string
}) {
  const { all, byId } = useApplications()
  const [open, setOpen] = useState(false)
  const selected = value ? byId.get(value) : undefined

  return (
    <div className={cn('flex min-w-0 items-center gap-1', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            // Named here as well as by the field label around it: in the header
            // form there is no label, and 'No application' on its own says what
            // the value is without saying what it is the value of.
            aria-label="Related application"
            className="h-8 min-w-0 flex-1 justify-between font-normal"
          >
            <span className="truncate">{selected ? displayName(selected) : 'No application'}</span>
            <ChevronsUpDown aria-hidden className="size-3.5 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
          <Command>
            <CommandInput placeholder="Search applications…" />
            <CommandList>
              <CommandEmpty>
                {all.length === 0 ? 'No applications yet.' : 'No application matches that.'}
              </CommandEmpty>
              <CommandGroup>
                {all.map((a) => (
                  <CommandItem
                    key={a.id}
                    // cmdk matches on `value`, so the role and stage are
                    // searchable while the row still reads as one name.
                    value={`${displayName(a)} ${a.roleTag} ${a.stage}`}
                    data-checked={a.id === value}
                    onSelect={() => {
                      onChange(a.id)
                      setOpen(false)
                    }}
                  >
                    <span className="truncate">{displayName(a)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Unfile this link"
          aria-label="Unfile this link"
          onClick={() => onChange(undefined)}
        >
          <X aria-hidden />
        </Button>
      ) : null}
    </div>
  )
}

/**
 * Correcting a saved link, in place.
 *
 * Its own component so the fields seed from the record on mount: held in the
 * list's state they would have to be re-seeded by hand every time a different
 * row opened, which is where half-edited values leak between records.
 */
function LinkEditor({ link, onDone }: { link: VaultLink; onDone: () => void }) {
  const { updateLink } = useVault()
  const { toast } = useToast()

  const [title, setTitle] = useState(link.title)
  const [url, setUrl] = useState(link.url)
  const [category, setCategory] = useState<LinkCategory>(link.category)
  const [note, setNote] = useState(link.note ?? '')
  const [applicationId, setApplicationId] = useState(link.applicationId)
  const [submitted, setSubmitted] = useState(false)

  const categoryId = useId()
  const appFieldId = useId()

  const cleanUrl = normalizeUrl(url)
  const parsed = parseUrl(cleanUrl)

  const titleError = submitted && !title.trim() ? 'Give the link a title.' : undefined
  const urlError =
    submitted && !parsed ? 'That needs a host, like jobs.rice.edu/postings.' : undefined

  const save = (event: FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (!title.trim() || !parsed) return

    // Captured before the write, so Undo restores the record rather than the
    // values it has just been given.
    const before = {
      title: link.title,
      url: link.url,
      category: link.category,
      note: link.note,
      applicationId: link.applicationId,
    }

    updateLink(link.id, {
      title: title.trim(),
      url: cleanUrl,
      category,
      note: note.trim() || undefined,
      applicationId,
    })
    toast({
      title: `${title.trim()} updated`,
      description: `Filed under ${category}.`,
      action: { label: 'Undo', onClick: () => updateLink(link.id, before) },
    })
    onDone()
  }

  return (
    // `noValidate`, because `required` stays on the fields for assistive tech and
    // the browser's own bubble would fire over the message written for the field.
    <form noValidate onSubmit={save} className="grid gap-3 py-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Title"
          required
          error={titleError}
          value={title}
          autoFocus
          autoComplete="off"
          onChange={(event) => setTitle(event.target.value)}
        />
        <Field
          label="URL"
          mono
          required
          error={urlError}
          value={url}
          autoComplete="off"
          onChange={(event) => setUrl(event.target.value)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Category" htmlFor={categoryId}>
          <select
            id={categoryId}
            value={category}
            onChange={(event) => setCategory(event.target.value as LinkCategory)}
            className={SELECT_CLASS}
          >
            {LINK_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </FormField>

        <FormField
          label="Related application"
          htmlFor={appFieldId}
          hint="Files the link under a job, so both ends know about the other."
        >
          <ApplicationPicker id={appFieldId} value={applicationId} onChange={setApplicationId} />
        </FormField>
      </div>

      <Field
        label="Note"
        hint="One line about why this is worth keeping."
        value={note}
        autoComplete="off"
        onChange={(event) => setNote(event.target.value)}
      />

      <FormField
        label="Keywords"
        hint="Shared with applications, reminders and files — filtering by one finds all of them."
      >
        <div className="flex min-h-6 flex-wrap items-center gap-1.5">
          <LabelPicker recordId={link.id} />
          <LabelChips recordId={link.id} />
        </div>
      </FormField>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone}>
          Cancel
        </Button>
        {/* Left enabled with a field empty: pressing it names the problem, where
            a disabled button leaves the user hunting for which one. */}
        <Button type="submit" size="sm">
          Save changes
        </Button>
      </div>
    </form>
  )
}

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

  /**
   * Every empty list names the control that emptied it. "No links yet" over a
   * vault holding eight of them, because a chip two rows up is set, is the
   * fastest way to make someone think the app lost their data.
   */
  const empty = (() => {
    if (links.length === 0) {
      return {
        title: 'No links saved yet',
        description:
          'Save a URL — a posting, a department page, a person you were told to contact. The title is read off the address.',
        action: addButton,
      }
    }
    if (query.trim()) {
      return {
        title: 'Nothing matches that search',
        description: `No link mentions "${query.trim()}" in its title, address, note or category.`,
        action: (
          <Button variant="outline" size="sm" onClick={() => setQuery('')}>
            Clear search
          </Button>
        ),
      }
    }
    const byCategory = bucket !== 'all'
    const byKeyword = selectedLabels.size > 0

    if (byCategory && byKeyword) {
      return {
        title: 'Nothing matches both filters',
        description: `No ${bucket} link carries the selected keywords.`,
        action: (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setBucket('all')
              clearSelected()
            }}
          >
            Clear both filters
          </Button>
        ),
      }
    }
    if (byCategory) {
      return {
        title: `No links under ${bucket}`,
        description: `${links.length} links are filed under the other categories.`,
        action: (
          <Button variant="outline" size="sm" onClick={() => setBucket('all')}>
            Show all categories
          </Button>
        ),
      }
    }
    return {
      title: 'No links carry those keywords',
      description: 'The keyword filter at the top of the page is what is hiding them.',
      action: (
        <Button variant="outline" size="sm" onClick={clearSelected}>
          Clear keywords
        </Button>
      ),
    }
  })()

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

            const related = l.applicationId ? byId.get(l.applicationId) : undefined

            return (
              <li
                key={l.id}
                ref={l.id === focus ? focusedRow : undefined}
                className={cn(
                  'flex items-center gap-2 py-2.5',
                  l.id === focus && 'arrival-highlight -mx-2 rounded-md px-2',
                )}
              >
                <Link2
                  aria-hidden
                  strokeWidth={1.7}
                  className="mt-0.5 size-3.5 shrink-0 self-start text-text-3"
                />

                <div className="min-w-0 flex-1">
                  {/* The title opens the editor, matching the reminder and file
                      rows, where a title that looks like this is the way in to
                      correcting the record. The address below leaves the app —
                      it is the one line that is unambiguously about elsewhere,
                      and it is also the thing you would check before following. */}
                  <button
                    type="button"
                    onClick={() => setEditingId(l.id)}
                    className="block max-w-full cursor-pointer truncate text-left text-sm text-text-1 transition-colors hover:text-accent"
                  >
                    {l.title}
                  </button>

                  <div className="mt-0.5 flex items-center gap-x-2 overflow-hidden text-xs text-text-3">
                    <a
                      href={l.url}
                      target="_blank"
                      // noreferrer as well as noopener: the target should not
                      // learn where the click came from.
                      rel="noopener noreferrer"
                      className="group flex min-w-0 items-center gap-1 font-mono underline-offset-2 transition-colors hover:text-accent hover:underline"
                    >
                      <span className="truncate">{hostOf(l.url)}</span>
                      <ExternalLink
                        aria-label="Opens in a new tab"
                        role="img"
                        strokeWidth={1.7}
                        className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                      />
                    </a>
                    {l.note ? <span className="truncate">· {l.note}</span> : null}
                    {related ? (
                      <Link
                        to={appPath(related)}
                        className="shrink-0 truncate underline-offset-2 transition-colors hover:text-accent hover:underline"
                      >
                        · {displayName(related)}
                      </Link>
                    ) : null}
                    <LabelChips recordId={l.id} className="shrink-0" />
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <LabelPicker recordId={l.id} />
                  <RowMenu name={l.title}>
                    <MenuItem icon={Pencil} onSelect={() => setEditingId(l.id)}>
                      Edit
                    </MenuItem>
                    <MenuItem icon={Copy} onSelect={() => onDuplicate(l)}>
                      Duplicate
                    </MenuItem>
                    <MenuSection title="Move to">
                      {LINK_CATEGORIES.map((c) => (
                        <MenuItem key={c} current={c === l.category} onSelect={() => onMove(l, c)}>
                          {c}
                        </MenuItem>
                      ))}
                    </MenuSection>
                    <MenuSection>
                      <MenuItem icon={Trash2} danger onSelect={() => onDelete(l)}>
                        Delete
                      </MenuItem>
                    </MenuSection>
                  </RowMenu>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
