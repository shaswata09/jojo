import type { ChangeEvent } from 'react'
import { X } from 'lucide-react'
import { Chip } from '@/components/common/Chip'
import { Field, SettingRow } from '@/components/common/Field'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Switch } from '@/components/ui/switch'
import type { ProfileText } from '@/data/profile'
import type { ProfileFormState } from './use-profile-form'
import { ChipAdder } from './ChipAdder'
import { RoleTags } from './RoleTags'
import { withAdded, without } from './profile-lists'

type Setter = (key: keyof ProfileText) => (event: ChangeEvent<HTMLInputElement>) => void

/**
 * Interests and targets: match terms, role tags, the two target fields and
 * the academia / industry switches.
 *
 * Chips and switches commit on click, and are deliberately outside the save
 * bar's model. It is the same rule the keyword picker follows everywhere else
 * in the app: a control whose whole affordance is the change it makes has
 * already told the user it took effect, and asking them to confirm it again
 * from a bar at the foot of the page reads as the click not having landed.
 */
export function InterestsPanel({
  profile,
  update,
  draft,
  set,
}: Pick<ProfileFormState, 'profile' | 'update'> & { draft: ProfileText; set: Setter }) {
  const { matchTerms, roles, includeAcademia, includeIndustry } = profile

  const addTerm = (typed: string) => {
    const next = withAdded(matchTerms, typed)
    if (next) update({ matchTerms: next })
  }

  return (
    <Panel>
      <PanelTitle hint="drives scout matching">Interests and targets</PanelTitle>

      <div className="mb-4">
        {/* Renamed from "keywords", which is taken. A keyword in this app is
            something you file a record under and filter by; these are the
            terms the scout scores a posting against, and the two lists have
            never had anything to do with each other. */}
        <p className="mb-1 text-xs text-text-2">Match terms</p>
        <p className="mb-2 text-xs text-text-3">
          Research areas and phrasings the scout looks for. Separate from the keywords you file
          records under.
        </p>
        <ul className="flex flex-wrap gap-1.5">
          {matchTerms.map((term) => (
            <li key={term}>
              <Chip tone="teal" className="pr-1">
                {term}
                <button
                  type="button"
                  onClick={() => update({ matchTerms: without(matchTerms, term) })}
                  aria-label={`Remove ${term}`}
                  className="ml-0.5 rounded-sm p-0.5 hover:bg-accent-border/40"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </Chip>
            </li>
          ))}
          <li>
            <ChipAdder label="New match term" placeholder="Add a match term" onAdd={addTerm} />
          </li>
        </ul>
      </div>

      <RoleTags roles={roles} update={update} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label="Target roles"
          value={draft.targetRoles}
          placeholder="e.g. Assistant professor (TT) · Research scientist"
          onChange={set('targetRoles')}
        />
        <Field
          label="Preferred regions"
          value={draft.regions}
          placeholder="e.g. Texas · remote"
          onChange={set('regions')}
        />
      </div>

      <div className="mt-4">
        <SettingRow
          label="Include academia postings"
          control={
            <Switch
              checked={includeAcademia}
              onCheckedChange={(v) => update({ includeAcademia: v })}
              aria-label="Include academia postings"
            />
          }
        />
        <SettingRow
          label="Include industry postings"
          control={
            <Switch
              checked={includeIndustry}
              onCheckedChange={(v) => update({ includeIndustry: v })}
              aria-label="Include industry postings"
            />
          }
        />
      </div>
    </Panel>
  )
}
