import { type ReactNode, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Plus, UserPlus, UserRound, X } from 'lucide-react'
import {
  CONTACT_ROLE_LABEL,
  CONTACT_ROLE_VALUES,
  type ContactRole,
  type Person,
} from '@jojo/service/core/model'
import { useVault } from '@jojo/service/react/use-vault'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { vaultPath } from '@/lib/links'
import { useToast } from '@/lib/toast-context'
import { cn } from '@/lib/utils'

/**
 * Who is on this application: the people writing for it and the people you
 * deal with there.
 *
 * WHY HERE AND NOT ONLY IN THE VAULT. A person could only be named on a job from
 * their own form in the Vault, so the moment the question arises — reading the
 * Rice record, realising Ngozi is the referee for it — the answer was a trip to
 * another page and a picker of every job. This is that same filing, made from
 * the job's side, one person at a time.
 *
 * WHAT A ROLE IS. Recommender or point of contact ON THIS JOB, stored on the
 * pairing (`ContactRole`), so Anita can be both — for different jobs — and the
 * recommender list (`RefereePackDialog`) knows which jobs to send her.
 *
 * Every change is one write and has an Undo. Taking somebody off a job leaves
 * them in the Vault and on their other jobs.
 */
/**
 * A person's name, then where they are, on one line — the name first in line
 * for the room.
 *
 * Both used to be plain truncating spans side by side, and two spans that
 * shrink alike give the same share to each: in the Add person list a long
 * title like "Search committee chair" cut "Prof. Ngozi Okafor" down to
 * "Prof. Ngozi O…", which is the one word you were trying to read. Now the name
 * keeps its full width up to `NAME_ROOM`, and is only cut past that or when the
 * row itself is narrower; the affiliation takes whatever is left and is the
 * part that gives way.
 */
const NAME_ROOM = 'max-w-[min(28ch,100%)]'

function NameThenPlace({
  name,
  place,
  nameClass,
}: {
  name: ReactNode
  place: string | undefined
  nameClass?: string
}) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className={cn(NAME_ROOM, 'shrink-0 truncate', nameClass)}>{name}</span>
      {place ? <span className="min-w-0 flex-1 truncate text-xs text-text-3">{place}</span> : null}
    </span>
  )
}

export function PeoplePanel({ applicationId }: { applicationId: string }) {
  const { people, forApplication, addPerson, filePerson, unfilePerson, removePerson } = useVault()
  const { toast } = useToast()
  const here = forApplication(applicationId).people
  const others = useMemo(
    () => people.filter((p) => !p.applicationIds.includes(applicationId)),
    [people, applicationId],
  )

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [role, setRole] = useState<ContactRole>('recommender')

  const roleOf = (p: Person) => p.roles?.[applicationId]
  const asRole = (r: ContactRole | undefined) =>
    r === undefined ? 'named' : `named as ${CONTACT_ROLE_LABEL[r].toLowerCase()}`

  const close = () => {
    setOpen(false)
    setQuery('')
  }

  const addExisting = (p: Person) => {
    const { ok, restore } = filePerson(p.id, applicationId, role)
    close()
    if (!ok) {
      toast({ title: 'Could not add them', description: p.name, tone: 'danger' })
      return
    }
    toast({ title: `${p.name} ${asRole(role)}`, action: { label: 'Undo', onClick: restore } })
  }

  const addNew = (name: string) => {
    const trimmed = name.trim()
    if (trimmed === '') return
    close()
    try {
      const created = addPerson({
        name: trimmed,
        applicationIds: [applicationId],
        roles: { [applicationId]: role },
      })
      toast({
        title: `${trimmed} added and ${asRole(role)}`,
        description: 'Their details can be filled in from the Vault.',
        // Removing the person they just created is exactly the gesture undone.
        action: { label: 'Undo', onClick: () => removePerson(created.id) },
      })
    } catch {
      toast({ title: 'Could not add them', description: trimmed, tone: 'danger' })
    }
  }

  const changeRole = (p: Person, next: ContactRole | null) => {
    const { restore } = filePerson(p.id, applicationId, next)
    toast({
      title:
        next === null
          ? `${p.name}: no role`
          : `${p.name} is now ${CONTACT_ROLE_LABEL[next].toLowerCase()}`,
      action: { label: 'Undo', onClick: restore },
    })
  }

  const takeOff = (p: Person) => {
    const { restore } = unfilePerson(p.id, applicationId)
    toast({
      title: `${p.name} taken off this application`,
      description: 'They are still in the Vault, and on their other applications.',
      action: { label: 'Undo', onClick: restore },
    })
  }

  // Only offered when nobody already in the Vault has this exact name, so a
  // quick "Anita" picks Anita rather than minting a second one.
  const typed = query.trim()
  const offerNew = typed !== '' && !people.some((p) => p.name.toLowerCase() === typed.toLowerCase())

  return (
    <Panel>
      <PanelTitle hint={here.length > 0 ? `${here.length} on this application` : undefined}>
        People
      </PanelTitle>

      {here.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title="Nobody on this yet"
          description="Name the people writing your letters and the people you deal with there. Recommenders show up on the list you can send them from the Vault."
        />
      ) : (
        <ul className="flex flex-col">
          {here.map((p) => {
            const r = roleOf(p)
            return (
              <li
                key={p.id}
                className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-hairline py-2 last:border-b-0"
              >
                <div className="min-w-0 flex-1 basis-40">
                  <NameThenPlace
                    name={
                      <Link
                        to={vaultPath({ tool: 'people', focus: p.id })}
                        // The full name on hover, for the rare one past the room.
                        title={p.name}
                        className="text-sm text-text-1 underline-offset-2 hover:underline"
                      >
                        {p.name}
                      </Link>
                    }
                    place={p.affiliation}
                  />
                  {p.role || p.email ? (
                    <div className="truncate text-xs text-text-3">
                      {[p.role, p.email].filter(Boolean).join(' · ')}
                    </div>
                  ) : null}
                </div>
                {/* The role and the × travel together: on a narrow row they wrap
                    as one group under the name, never with the × on its own. */}
                <div className="flex shrink-0 items-center gap-1">
                  <label className="sr-only" htmlFor={`role-${p.id}`}>
                    {`${p.name}'s role on this application`}
                  </label>
                  <select
                    id={`role-${p.id}`}
                    value={r ?? ''}
                    onChange={(e) =>
                      changeRole(p, e.target.value === '' ? null : (e.target.value as ContactRole))
                    }
                    className={cn(
                      'h-8 shrink-0 rounded-md border border-hairline bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
                      r === undefined ? 'text-text-3' : 'text-text-1',
                    )}
                  >
                    {CONTACT_ROLE_VALUES.map((v) => (
                      <option key={v} value={v}>
                        {CONTACT_ROLE_LABEL[v]}
                      </option>
                    ))}
                    <option value="">No role</option>
                  </select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-text-3"
                    aria-label={`Take ${p.name} off this application`}
                    title="Take off this application"
                    onClick={() => takeOff(p)}
                  >
                    <X className="size-3.5" strokeWidth={1.8} aria-hidden />
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) setOpen(true)
          else close()
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="mt-3">
            <Plus className="size-3.5" strokeWidth={2} aria-hidden />
            Add person
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-0">
          {/* The role first, because it is the one thing a name does not say. */}
          <div
            role="radiogroup"
            aria-label="Add them as"
            className="flex gap-1 border-b border-hairline p-2"
          >
            {CONTACT_ROLE_VALUES.map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={role === v}
                onClick={() => setRole(v)}
                className={cn(
                  'flex-1 rounded-md border px-2 py-1 text-xs transition-colors',
                  role === v
                    ? 'border-accent text-text-1'
                    : 'border-transparent text-text-3 hover:text-text-2',
                )}
              >
                {CONTACT_ROLE_LABEL[v]}
              </button>
            ))}
          </div>
          <Command>
            <CommandInput
              placeholder="Search people, or type a new name…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>
                {offerNew ? null : 'Nobody else in the Vault matches that.'}
              </CommandEmpty>
              {others.length > 0 ? (
                <CommandGroup heading="In the Vault">
                  {others.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={`${p.name} ${p.role ?? ''} ${p.affiliation ?? ''} ${p.id}`}
                      onSelect={() => addExisting(p)}
                    >
                      <UserRound
                        className="size-3.5 shrink-0 text-text-3"
                        strokeWidth={1.8}
                        aria-hidden
                      />
                      <span title={p.name} className="min-w-0 flex-1">
                        <NameThenPlace
                          name={p.name}
                          place={[p.affiliation, p.role].filter(Boolean).join(' · ') || undefined}
                        />
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
              {offerNew ? (
                <CommandGroup heading="New">
                  {/* `value` is the typed text itself, so cmdk always matches it. */}
                  <CommandItem value={`${typed} __new`} onSelect={() => addNew(typed)}>
                    <UserPlus
                      className="size-3.5 shrink-0 text-text-3"
                      strokeWidth={1.8}
                      aria-hidden
                    />
                    <span className="truncate">Add “{typed}” as a new person</span>
                  </CommandItem>
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </Panel>
  )
}
