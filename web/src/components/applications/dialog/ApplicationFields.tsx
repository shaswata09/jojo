import { useId, useState } from 'react'
import type { RefObject } from 'react'
import { ChevronsUpDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Errors, FormState } from '@/components/applications/dialog/form-state'
import { Field, FormField } from '@/components/common/Field'
import { KeywordPicker } from '@/components/common/KeywordPicker'
import { RichNoteField } from '@/components/common/RichTextEditorField'
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
import { SOURCES, STAGES } from '@/data/seed'
import { useRoleVocabulary } from '@jojo/service/react/use-roles'
import type { RoleTag, Source } from '@/data/seed'
import { cn } from '@/lib/utils'
import { useDomain } from '@/i18n/domain'

/** `Not set` is the one label here that is not a stored value, so it is passed in. */
const sourceOptions = (notSet: string): { value: Source | 'none'; label: string }[] => [
  { value: 'none', label: notSet },
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
  const { t } = useTranslation('applications')
  const vocabulary = useRoleVocabulary()
  const [rolesOpen, setRolesOpen] = useState(false)
  // A <button> is a labelable element, so pointing the field's label at the
  // trigger both names it and makes the label click through to it.
  const roleTagId = useId()

  return (
    <FormField label={t('fields.roleTag')} required error={error} htmlFor={roleTagId}>
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
            <span className={cn(!value && 'text-text-3')}>{value || t('fields.pickRoleTag')}</span>
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
          <Command label={t('fields.searchRoleTags')}>
            <CommandInput placeholder={t('fields.searchRoleTagsPlaceholder')} />
            <CommandList>
              <CommandEmpty>{t('fields.noRoleTag')}</CommandEmpty>
              <CommandGroup>
                {vocabulary.map((role) => (
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
  noteFormat,
  onNoteFormatChange,
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
  /**
   * The note's formatting, encoded (`encodeFormat`), and where an edit to it
   * goes. Beside `form` rather than in it so the note's TEXT stays the plain
   * `form.note` every other reader of the form already uses; the dialog that
   * owns the form decides where the formatting is held and saves it with the
   * rest. Absent, the note opens plain and the formatting is not reported.
   */
  noteFormat?: string | undefined
  onNoteFormatChange?: (format: string) => void
}) {
  const { t } = useTranslation('applications')
  const domain = useDomain()
  return (
    // `-mx-4 px-4` cancels `DialogContent`'s own `p-4` and puts it straight
    // back inside — `StatsCard` and `OwedThisWeek`'s trick, so the fields keep
    // their inset and only the scrollbar moves out to the dialog's edge. It
    // was `-mx-1 px-1`, which left the bar floating 12px short of it.
    //
    // `grid-cols-1` at the base, not the implicit `auto` track: that one sized
    // to the widest field's min-content — the stage segment's six labels — and
    // at 360px grew past the dialog, 17px in English and 145px in German.
    <div className="-mx-4 grid max-h-[min(58vh,30rem)] grid-cols-1 gap-x-3 gap-y-3.5 overflow-y-auto px-4 pb-1 sm:grid-cols-2">
      <Field
        ref={orgRef}
        label={t('fields.org')}
        required
        autoComplete="off"
        placeholder={t('fields.orgPlaceholder')}
        value={form.org}
        error={errors.org}
        onChange={(e) => set('org', e.target.value)}
        onBlur={revalidate}
      />
      <Field
        ref={roleRef}
        label={t('fields.role')}
        required
        autoComplete="off"
        placeholder={t('fields.rolePlaceholder')}
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
        label={t('fields.deadline')}
        type="date"
        value={form.deadline}
        error={errors.deadline}
        hint={t('fields.deadlineHint')}
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
          grew at 390px. The labels wrap, and break inside a word when
          they must ("Vorstellungsgespräch"), so a narrow phone narrows the
          options rather than the options widening the form. */}
      <FormField label={t('fields.stage')} required className="sm:col-span-2">
        <Segment
          label={t('fields.stage')}
          options={STAGES.map((s) => ({ value: s.id, label: domain.stage(s.id) }))}
          value={form.stage}
          onChange={(stage) => set('stage', stage)}
          className="w-full [&>button]:min-w-0 [&>button]:flex-1 [&>button]:px-1 [&>button]:wrap-anywhere [&>button]:hyphens-auto"
        />
      </FormField>

      <FormField label={t('fields.source')} className="sm:col-span-2">
        <Segment
          label={t('fields.source')}
          options={sourceOptions(t('fields.notSet'))}
          value={form.source}
          onChange={(source) => set('source', source)}
          className="w-full [&>button]:min-w-0 [&>button]:flex-1 [&>button]:px-1 [&>button]:wrap-anywhere [&>button]:hyphens-auto"
        />
      </FormField>

      <Field
        label={t('fields.location')}
        autoComplete="off"
        placeholder={t('fields.locationPlaceholder')}
        value={form.location}
        onChange={(e) => set('location', e.target.value)}
      />
      <Field
        label={t('fields.comp')}
        autoComplete="off"
        placeholder={t('fields.compPlaceholder')}
        value={form.comp}
        onChange={(e) => set('comp', e.target.value)}
      />

      <Field
        ref={urlRef}
        label={t('fields.postingUrl')}
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
      <Field
        label={t('fields.postingId')}
        hint={t('fields.postingIdHint')}
        autoComplete="off"
        placeholder={t('fields.postingIdPlaceholder')}
        className="sm:col-span-2"
        value={form.postingId}
        onChange={(e) => set('postingId', e.target.value)}
      />
      {/* Usually filled by the stage move to Submitted, which asks for it; here
          so a reference typed wrong there — or one that arrived by email later
          — can be corrected. */}
      <Field
        label={t('fields.confirmationRef')}
        hint={t('fields.confirmationRefHint')}
        autoComplete="off"
        placeholder={t('fields.confirmationRefPlaceholder')}
        className="sm:col-span-2"
        value={form.confirmationRef}
        onChange={(e) => set('confirmationRef', e.target.value)}
      />

      {/* The rich text editor, as on the record's own note panel (Q268): the
          text goes into the form as it always did, and the formatting beside
          it is handed to the dialog, which saves both in one call. */}
      <RichNoteField
        label={t('fields.note')}
        placeholder={t('fields.notePlaceholder')}
        className="sm:col-span-2"
        text={form.note}
        format={noteFormat}
        onChange={(text, format) => {
          set('note', text)
          onNoteFormatChange?.(format)
        }}
      />

      <FormField label={t('fields.keywords')} className="sm:col-span-2">
        <KeywordPicker value={keywords} onChange={onKeywordsChange} />
      </FormField>
    </div>
  )
}
