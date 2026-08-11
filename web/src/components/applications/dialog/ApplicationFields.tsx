import { useId, useState } from 'react'
import type { RefObject } from 'react'
import { ChevronsUpDown } from 'lucide-react'
import type { Errors, FormState } from '@/components/applications/dialog/form-state'
import { Field, FormField, TextareaField } from '@/components/common/Field'
import { KeywordPicker } from '@/components/common/KeywordPicker'
import { Segment } from '@/components/common/Segment'
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
import { ROLES, SOURCES, STAGES } from '@/data/seed'
import type { RoleTag, Source } from '@/data/seed'
import { cn } from '@/lib/utils'

const STAGE_OPTIONS = STAGES.map((s) => ({ value: s.id, label: s.label }))

const SOURCE_OPTIONS: { value: Source | 'none'; label: string }[] = [
  { value: 'none', label: 'Not set' },
  ...SOURCES.map((s) => ({ value: s, label: s })),
]

/** The five role tags, as a searchable combobox rather than a sixth segment. */
function RoleTagField({
  ref,
  value,
  error,
  onSelect,
}: {
  ref: RefObject<HTMLButtonElement | null>
  value: RoleTag | ''
  error?: string
  onSelect: (role: RoleTag) => void
}) {
  const [rolesOpen, setRolesOpen] = useState(false)
  // A <button> is a labelable element, so pointing the field's label at the
  // trigger both names it and makes the label click through to it.
  const roleTagId = useId()

  return (
    <FormField label="Role tag" required error={error} htmlFor={roleTagId}>
      <Popover open={rolesOpen} onOpenChange={setRolesOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={ref}
            id={roleTagId}
            type="button"
            variant="outline"
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={rolesOpen}
            aria-invalid={error ? true : undefined}
            className="w-full justify-between font-normal"
          >
            <span className={cn(!value && 'text-text-3')}>{value || 'Pick a role tag'}</span>
            <ChevronsUpDown aria-hidden className="size-3.5 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) p-0"
          // The list is five items — the field it belongs to should stay
          // visible while you pick from it.
          collisionPadding={12}
        >
          <Command>
            <CommandInput placeholder="Search role tags…" />
            <CommandList>
              <CommandEmpty>No role tag matches.</CommandEmpty>
              <CommandGroup>
                {ROLES.map((role) => (
                  <CommandItem
                    key={role}
                    value={role}
                    data-checked={role === value}
                    onSelect={() => {
                      onSelect(role)
                      setRolesOpen(false)
                    }}
                  >
                    {role}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </FormField>
  )
}

/**
 * The eleven fields of the application form, in reading order.
 *
 * Placeholders name the shape of the answer, never a plausible one. They used to
 * reproduce the Rice record field for field — "Rice", "Assistant professor,
 * statistics", "Houston, TX", its posting URL — so the empty create form read as
 * a filled duplicate of a record the user already had, and the only way to tell
 * was that the text was grey.
 */
export function ApplicationFields({
  form,
  errors,
  set,
  revalidate,
  keywords,
  onKeywordsChange,
  onRoleTagSelect,
  orgRef,
  roleRef,
  roleTagRef,
  deadlineRef,
  urlRef,
}: {
  form: FormState
  errors: Errors
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void
  revalidate: () => void
  keywords: string[]
  onKeywordsChange: (next: string[]) => void
  onRoleTagSelect: (role: RoleTag) => void
  orgRef: RefObject<HTMLInputElement | null>
  roleRef: RefObject<HTMLInputElement | null>
  roleTagRef: RefObject<HTMLButtonElement | null>
  deadlineRef: RefObject<HTMLInputElement | null>
  urlRef: RefObject<HTMLInputElement | null>
}) {
  return (
    <div className="-mx-1 grid max-h-[min(58vh,30rem)] gap-x-3 gap-y-3.5 overflow-y-auto px-1 pb-1 sm:grid-cols-2">
      <Field
        ref={orgRef}
        label="Organisation"
        required
        autoComplete="off"
        placeholder="Employer or institution"
        value={form.org}
        error={errors.org}
        onChange={(e) => set('org', e.target.value)}
        onBlur={revalidate}
      />
      <Field
        ref={roleRef}
        label="Role title"
        required
        autoComplete="off"
        placeholder="e.g. Senior data analyst"
        value={form.role}
        error={errors.role}
        onChange={(e) => set('role', e.target.value)}
        onBlur={revalidate}
      />

      <RoleTagField
        ref={roleTagRef}
        value={form.roleTag}
        error={errors.roleTag}
        onSelect={onRoleTagSelect}
      />

      <Field
        ref={deadlineRef}
        label="Deadline"
        type="date"
        value={form.deadline}
        error={errors.deadline}
        hint="Puts a dated reminder on the calendar."
        onChange={(e) => set('deadline', e.target.value)}
        onBlur={revalidate}
      />

      {/* Full width, equal columns.
          Both tracks were `w-max` inside a scroller, so they sized to
          their own labels and stopped 55px and 58px short of the right
          edge every other field reaches — two ragged ends 3px apart from
          each other, which reads as a rendering fault rather than a
          choice. Sizing the options off the track instead of the other
          way round also retires the horizontal scrollbar the six stages
          grew at 390px. */}
      <FormField label="Stage" required className="sm:col-span-2">
        <Segment
          label="Stage"
          options={STAGE_OPTIONS}
          value={form.stage}
          onChange={(stage) => set('stage', stage)}
          className="w-full [&>button]:min-w-0 [&>button]:flex-1 [&>button]:px-1"
        />
      </FormField>

      <FormField label="Source" className="sm:col-span-2">
        <Segment
          label="Source"
          options={SOURCE_OPTIONS}
          value={form.source}
          onChange={(source) => set('source', source)}
          className="w-full [&>button]:min-w-0 [&>button]:flex-1 [&>button]:px-1"
        />
      </FormField>

      <Field
        label="Location"
        autoComplete="off"
        placeholder="City, or Remote"
        value={form.location}
        onChange={(e) => set('location', e.target.value)}
      />
      <Field
        label="Comp"
        autoComplete="off"
        placeholder="e.g. $96k + equity"
        value={form.comp}
        onChange={(e) => set('comp', e.target.value)}
      />

      <Field
        ref={urlRef}
        label="Posting URL"
        type="url"
        inputMode="url"
        autoComplete="off"
        placeholder="https://…"
        className="sm:col-span-2"
        value={form.url}
        error={errors.url}
        onChange={(e) => set('url', e.target.value)}
        onBlur={revalidate}
      />

      <TextareaField
        label="Note"
        rows={3}
        placeholder="What still has to happen before this goes out."
        className="sm:col-span-2"
        value={form.note}
        onChange={(e) => set('note', e.target.value)}
      />

      <FormField label="Keywords" className="sm:col-span-2">
        <KeywordPicker value={keywords} onChange={onKeywordsChange} />
      </FormField>
    </div>
  )
}
