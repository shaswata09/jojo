import { useMemo, useState } from 'react'
import { Mail, Pencil, Phone, Plus, Trash2, UserRound } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { Field, FormField, TextareaField } from '@/components/common/Field'
import { MenuItem, MenuSection, RowMenu } from '@/components/common/RowMenu'
import { Panel, Row, RowList } from '@/components/common/Panel'
import { ApplicationPicker } from '@/components/vault/ApplicationPicker'
import { VaultSearch, VaultToolbar } from '@/components/vault/VaultToolbar'
import { matchesQuery } from '@/components/vault/search'
import { Button } from '@/components/ui/button'
import { useApplications } from '@jojo/service/react/use-applications'
import { useVault } from '@jojo/service/react/use-vault'
import type { Person } from '@jojo/service/core/model'
import { displayName } from '@jojo/service/data/seed'
import { useToast } from '@/lib/toast-context'

/**
 * The people a job search is actually made of.
 *
 * WHY THIS EXISTS. Until now there was nowhere to put one. A referee, a search
 * chair, the recruiter who owes you an answer — all of them lived as prose
 * inside a reminder, which is what the seeded data still shows: "Chase the third
 * reference letter for Texas Tech" is a dated task with a person buried in the
 * sentence. Nothing could count outstanding letters, list everyone at one
 * university, or notice that the same referee is late for three jobs.
 *
 * WHY IT IS IN THE VAULT rather than a page of its own. A person is filed under
 * an application through `FILED_UNDER`, exactly as a CV is, and for exactly the
 * same reason the relation is many-to-many: a referee writes for every job you
 * name them on, and filing them under the last one edited would lose them from
 * the other eight. Everything the Vault already does — the filing picker, the
 * keyword chips, the search box, undo, Transfer — arrives with that decision
 * rather than being built again.
 *
 * WHAT IS DELIBERATELY NOT HERE: any notion of an interaction log. "When did I
 * last email Anita" is a real question and it wants dated records, which the
 * timeline already is. A second half-timeline attached to a person would be the
 * kind of thing that looks complete in a demo and disagrees with the calendar
 * by the second week.
 */
export function PeopleTool({ focus }: { focus?: string }) {
  const { people, addPerson, updatePerson, removePerson } = useVault()
  const { byId } = useApplications()
  const { toast } = useToast()

  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Person | null>(null)

  const shown = useMemo(
    () => people.filter((p) => matchesQuery(query, p.name, p.role, p.affiliation, p.email, p.note)),
    [people, query],
  )

  const onDelete = (person: Person) => {
    const { restore } = removePerson(person.id)
    toast({
      title: 'Person removed',
      description: person.name,
      action: { label: 'Undo', onClick: restore },
    })
  }

  return (
    <Panel>
      {/* The same toolbar shape as the other four tools — filter, search, add —
          with no filter, because a search has one kind of person in it and a
          chip row over five names would be furniture. */}
      <VaultToolbar
        search={
          <VaultSearch
            label="Search people"
            placeholder="Search name, role or note"
            value={query}
            onChange={setQuery}
          />
        }
        action={
          <Button
            size="sm"
            onClick={() => {
              setEditing(null)
              setAdding(true)
            }}
          >
            <Plus className="size-3.5" strokeWidth={2} aria-hidden />
            Add person
          </Button>
        }
      />

      {adding || editing ? (
        <PersonForm
          person={editing}
          onCancel={() => {
            setAdding(false)
            setEditing(null)
          }}
          onSave={(draft) => {
            if (editing) updatePerson(editing.id, draft)
            else addPerson(draft)
            setAdding(false)
            setEditing(null)
            toast({ title: 'Person saved', description: draft.name })
          }}
        />
      ) : null}

      {shown.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title={people.length === 0 ? 'Nobody yet' : 'No one matches that'}
          description={
            people.length === 0
              ? 'Referees, search chairs, recruiters — anyone the search runs through. File them under the jobs they are named on and they show up on those records too.'
              : 'Try part of a name, a role, or where they are.'
          }
        />
      ) : (
        <RowList>
          {shown.map((p) => (
            <Row key={p.id} className={focus === p.id ? 'arrival-highlight rounded-md' : undefined}>
              <div className="min-w-0 flex-1 basis-64">
                <div className="text-sm text-text-1">{p.name}</div>
                {p.role || p.affiliation ? (
                  <div className="mt-0.5 text-xs text-text-3">
                    {[p.role, p.affiliation].filter(Boolean).join(' · ')}
                  </div>
                ) : null}

                {/* Real links, because the point of keeping an address is to
                    use it — and a mail client is the one place this app can
                    hand someone off to without pretending to send anything. */}
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                  {p.email ? (
                    <a
                      href={`mailto:${p.email}`}
                      className="inline-flex items-center gap-1 font-mono text-text-2 underline-offset-2 hover:text-accent hover:underline"
                    >
                      <Mail className="size-3 shrink-0" strokeWidth={1.8} aria-hidden />
                      {p.email}
                    </a>
                  ) : null}
                  {p.phone ? (
                    <a
                      href={`tel:${p.phone.replace(/\s+/g, '')}`}
                      className="inline-flex items-center gap-1 font-mono text-text-2 underline-offset-2 hover:text-accent hover:underline"
                    >
                      <Phone className="size-3 shrink-0" strokeWidth={1.8} aria-hidden />
                      {p.phone}
                    </a>
                  ) : null}
                </div>

                {p.note ? <div className="mt-1 text-xs text-text-2">{p.note}</div> : null}

                {/* Named on, not filed under — the wording matters because it is
                    what a reader checks against their own memory. */}
                {p.applicationIds.length > 0 ? (
                  <div className="mt-1 text-xs text-text-3">
                    Named on{' '}
                    {p.applicationIds
                      .map((id) => {
                        const application = byId.get(id)
                        return application ? displayName(application) : null
                      })
                      .filter(Boolean)
                      .join(', ')}
                  </div>
                ) : null}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <RowMenu name={p.name}>
                  <MenuItem
                    icon={Pencil}
                    onSelect={() => {
                      setAdding(false)
                      setEditing(p)
                    }}
                  >
                    Edit
                  </MenuItem>
                  <MenuSection>
                    <MenuItem icon={Trash2} danger onSelect={() => onDelete(p)}>
                      Delete
                    </MenuItem>
                  </MenuSection>
                </RowMenu>
              </div>
            </Row>
          ))}
        </RowList>
      )}
    </Panel>
  )
}

type Draft = Omit<Person, 'id'>

/**
 * One form for adding and for editing, because they ask the same questions.
 *
 * Only the name is required. The first thing anyone records about a referee is
 * that they exist and have not sent the letter, and a form that demanded an
 * email before it would keep a name is a form people work around by typing the
 * name into a note — which is the state this whole tool replaces.
 */
function PersonForm({
  person,
  onSave,
  onCancel,
}: {
  person: Person | null
  onSave: (draft: Draft) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<Draft>({
    name: person?.name ?? '',
    role: person?.role ?? '',
    affiliation: person?.affiliation ?? '',
    email: person?.email ?? '',
    phone: person?.phone ?? '',
    note: person?.note ?? '',
    applicationIds: person?.applicationIds ?? [],
  })
  const [submitted, setSubmitted] = useState(false)

  const set = (key: keyof Draft) => (event: { target: { value: string } }) => {
    setDraft((prev) => ({ ...prev, [key]: event.target.value }))
  }

  const named = draft.name.trim().length > 0

  return (
    <form
      noValidate
      className="mb-3.5 rounded-lg border border-hairline p-3"
      onSubmit={(event) => {
        event.preventDefault()
        setSubmitted(true)
        if (!named) return
        onSave({ ...draft, name: draft.name.trim() })
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Name"
          required
          autoFocus
          value={draft.name}
          error={submitted && !named ? 'A name is the one thing this needs.' : undefined}
          announce
          placeholder="e.g. Prof. Ngozi Okafor"
          onChange={set('name')}
        />
        <Field
          label="Role"
          value={draft.role ?? ''}
          placeholder="e.g. Referee, search chair, recruiter"
          onChange={set('role')}
        />
        <Field
          label="Affiliation"
          value={draft.affiliation ?? ''}
          placeholder="e.g. Rice"
          hint="Where they are. Not linked to an employer you have applied to."
          onChange={set('affiliation')}
        />
        <Field
          label="Email"
          type="email"
          mono
          value={draft.email ?? ''}
          placeholder="n.okafor@rice.edu"
          onChange={set('email')}
        />
        <Field
          label="Phone"
          mono
          value={draft.phone ?? ''}
          placeholder="+1 555 0134"
          onChange={set('phone')}
        />
        <FormField label="Named on" hint="Every job they write for, screen for or chair.">
          <ApplicationPicker
            values={draft.applicationIds}
            what="person"
            onChange={(ids) => setDraft((prev) => ({ ...prev, applicationIds: ids }))}
          />
        </FormField>
        <TextareaField
          label="Note"
          className="sm:col-span-2"
          value={draft.note ?? ''}
          placeholder="What they said, what they owe you, when to chase."
          onChange={set('note')}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="submit" size="sm">
          {person ? 'Save person' : 'Add person'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
