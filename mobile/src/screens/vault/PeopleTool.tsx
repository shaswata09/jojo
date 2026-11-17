import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Linking, StyleSheet, View } from 'react-native'
import { ApplicationPickerSheet } from '@/components/common/ApplicationPickerSheet'
import { FiledUnderLinks } from '@/components/common/FiledUnderLinks'
import { Button, IconButton } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { FormField, TextField } from '@/components/ui/Field'
import { MenuSheet } from '@/components/ui/Menu'
import { SearchInput } from '@/components/ui/SearchInput'
import { Sheet } from '@/components/ui/Sheet'
import { Divider, Panel } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { capitalize } from '@/lib/text'
import { matchesQuery } from '@/lib/search'
import { useApplications, useVault } from '@/lib/store-context'
import { useToast } from '@/lib/toast-context'
import { displayName } from '@jojo/service/data/seed'
import type { Person } from '@jojo/service/core/model'
import { s } from '@/theme/styles'
import { space } from '@/theme/tokens'
import { report } from '@/lib/analytics'
import { useDomain } from '@/i18n/domain'
import { FocusTarget } from '@/components/ui/FocusTarget'

/**
 * The people a job search is actually made of, on a phone.
 *
 * The web tool's header carries the argument for the record existing at all —
 * that a referee, a chair and a recruiter had nowhere to live except inside the
 * prose of a reminder, and that "Chase the third reference letter for Texas
 * Tech" is what a fixture set writes when the model has no person in it.
 *
 * WHAT IS DIFFERENT HERE is the shape of editing. The web tool opens an inline
 * form above the list; a 390pt screen has no room for a seven-field form and a
 * list at the same time, so this is a sheet — the same one every other record on
 * this platform is edited in. The rows are otherwise the same rows, and a
 * person filed on the phone shows up on the web app's record and the other way
 * round, because both go through `vault.person.*` and neither owns the data.
 *
 * THE EMAIL AND PHONE ARE LIVE. A row that shows an address a thumb cannot act
 * on is a row that has to be copied out by hand, which on a phone is the whole
 * cost of the interaction — so they open the mail app and the dialler.
 */
export function PeopleTool() {
  const { t } = useTranslation('vault')
  const { people, addPerson, updatePerson, removePerson } = useVault()
  const { toast } = useToast()

  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Person | 'new' | null>(null)
  const [menuFor, setMenuFor] = useState<Person | null>(null)

  const shown = useMemo(
    () => people.filter((p) => matchesQuery(query, p.name, p.role, p.affiliation, p.email, p.note)),
    [people, query],
  )

  const onDelete = (person: Person) => {
    const { restore } = removePerson(person.id)
    toast({
      title: t('people.toast.removed'),
      description: person.name,
      action: { label: t('common.undo'), onPress: restore },
    })
  }

  return (
    <>
      <Panel>
        <View style={[s.row, { gap: space[2], marginBottom: space[3] }]}>
          <View style={s.fill}>
            <SearchInput
              label={t('people.search.label')}
              value={query}
              onChange={setQuery}
              placeholder={t('people.search.placeholder')}
            />
          </View>
          <Button label={t('people.add')} icon="plus" size="md" onPress={() => setEditing('new')} />
        </View>

        {shown.length === 0 ? (
          <EmptyState
            icon="user"
            title={
              people.length === 0 ? t('people.empty.zeroTitle') : t('people.empty.noMatchTitle')
            }
            description={
              people.length === 0
                ? t('people.empty.zeroDescription')
                : t('people.empty.noMatchDescription')
            }
          />
        ) : (
          shown.map((p, i) => (
            <FocusTarget key={p.id} id={p.id}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.row}>
                <View style={s.fill}>
                  <Txt size="sm">{p.name}</Txt>
                  {p.role || p.affiliation ? (
                    <Txt size="xs" tone="muted">
                      {[p.role, p.affiliation].filter(Boolean).join(' · ')}
                    </Txt>
                  ) : null}

                  <View style={[s.row, { flexWrap: 'wrap', columnGap: space[3] }]}>
                    {p.email ? (
                      <Txt
                        size="xs"
                        tone="info"
                        mono
                        onPress={() => {
                          void Linking.openURL(`mailto:${p.email ?? ''}`)
                        }}
                      >
                        {p.email}
                      </Txt>
                    ) : null}
                    {p.phone ? (
                      <Txt
                        size="xs"
                        tone="info"
                        mono
                        onPress={() => {
                          void Linking.openURL(`tel:${(p.phone ?? '').replace(/\s+/g, '')}`)
                        }}
                      >
                        {p.phone}
                      </Txt>
                    ) : null}
                  </View>

                  {p.note ? (
                    <Txt size="xs" tone="secondary" style={{ marginTop: space[1] }}>
                      {p.note}
                    </Txt>
                  ) : null}

                  {p.applicationIds.length > 0 ? (
                    <View style={{ marginTop: space[1] }}>
                      <FiledUnderLinks applicationIds={p.applicationIds} />
                    </View>
                  ) : null}
                </View>

                <IconButton
                  icon="more-horizontal"
                  label={t('people.optionsFor', { name: p.name })}
                  onPress={() => setMenuFor(p)}
                />
              </View>
            </FocusTarget>
          ))
        )}
      </Panel>

      <MenuSheet
        open={menuFor !== null}
        onClose={() => setMenuFor(null)}
        title={menuFor?.name ?? ''}
        description={menuFor?.role}
        actions={
          menuFor
            ? [
                {
                  id: 'edit',
                  label: t('common.edit'),
                  icon: 'edit-2',
                  onPress: () => setEditing(menuFor),
                },
                {
                  id: 'delete',
                  label: t('common.delete'),
                  icon: 'trash-2',
                  tone: 'danger',
                  onPress: () => onDelete(menuFor),
                },
              ]
            : []
        }
      />

      {editing !== null ? (
        <PersonSheet
          person={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(draft) => {
            if (editing !== 'new') updatePerson(editing.id, draft)
            else {
              addPerson(draft)
              void report('vault_item_added', { kind: 'person' })
            }
            setEditing(null)
            toast({ title: t('people.toast.saved'), description: draft.name })
          }}
        />
      ) : null}
    </>
  )
}

type Draft = Omit<Person, 'id'>

/**
 * One sheet for adding and for editing, because they ask the same questions.
 *
 * Only the name is required, and Save is disabled until there is one — the
 * button never claims to have kept a person the store would refuse.
 */
function PersonSheet({
  person,
  onSave,
  onClose,
}: {
  person: Person | null
  onSave: (draft: Draft) => void
  onClose: () => void
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
  const { t } = useTranslation('vault')
  const domain = useDomain()
  const [picking, setPicking] = useState(false)
  const { byId } = useApplications()

  // The same sentence the toasts and the web picker use, so the three cannot
  // disagree about where two names becomes 'three applications'.
  const chosen = draft.applicationIds.map((id) => byId.get(id)).filter((a) => a !== undefined)
  const pickerLabel =
    chosen.length === 0
      ? t('people.editor.noApplication')
      : capitalize(domain.filedUnder(chosen.map(displayName)))

  const set = (key: keyof Draft) => (value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }
  const named = draft.name.trim().length > 0

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        size="tall"
        // Taller than the screen with a field or two open; scrolls rather
        // than clipping the last field and its Save under the footer.
        scroll
        title={person ? t('people.editor.editTitle') : t('people.editor.addTitle')}
        description={t('people.editor.description')}
        footer={
          <>
            <Button label={t('common.cancel')} variant="ghost" size="md" onPress={onClose} />
            <Button
              label={person ? t('people.editor.save') : t('people.editor.addTitle')}
              size="md"
              disabled={!named}
              onPress={() => {
                onSave({ ...draft, name: draft.name.trim() })
              }}
            />
          </>
        }
      >
        <View style={{ gap: space[3], paddingBottom: space[2] }}>
          <TextField
            label={t('people.editor.name')}
            required
            value={draft.name}
            autoComplete="name"
            placeholder={t('people.editor.namePlaceholder')}
            onChangeText={set('name')}
          />
          <TextField
            label={t('people.editor.role')}
            value={draft.role ?? ''}
            placeholder={t('people.editor.rolePlaceholder')}
            onChangeText={set('role')}
          />
          <TextField
            label={t('people.editor.affiliation')}
            value={draft.affiliation ?? ''}
            placeholder={t('people.editor.affiliationPlaceholder')}
            hint={t('people.editor.affiliationHint')}
            onChangeText={set('affiliation')}
          />
          <TextField
            label={t('people.editor.email')}
            mono
            value={draft.email ?? ''}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="n.okafor@rice.edu"
            onChangeText={set('email')}
          />
          <TextField
            label={t('people.editor.phone')}
            mono
            value={draft.phone ?? ''}
            keyboardType="phone-pad"
            placeholder="+1 555 0134"
            onChangeText={set('phone')}
          />
          <FormField label={t('people.editor.namedOn')} hint={t('people.editor.namedOnHint')}>
            <Button
              label={pickerLabel}
              variant="outline"
              size="md"
              onPress={() => setPicking(true)}
            />
          </FormField>
          <TextField
            label={t('common.note')}
            multiline
            value={draft.note ?? ''}
            placeholder={t('people.editor.notePlaceholder')}
            onChangeText={set('note')}
          />
        </View>
      </Sheet>

      <ApplicationPickerSheet
        open={picking}
        values={draft.applicationIds}
        title={t('people.editor.namedOn')}
        onClose={() => setPicking(false)}
        onChange={(ids) => setDraft((prev) => ({ ...prev, applicationIds: ids }))}
      />
    </>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[2],
    paddingVertical: space[3],
    borderRadius: 8,
  },
})
