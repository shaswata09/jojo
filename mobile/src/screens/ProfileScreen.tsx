import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TODAY } from '@/lib/today'
import { StyleSheet, View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { useNavigation, useRoute } from '@react-navigation/native'
import type { RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { FileEditor } from '@/components/common/FileEditor'
import { Button, IconButton } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { SettingRow, TextField, Toggle } from '@/components/ui/Field'
import { Columns, Screen } from '@/components/ui/Screen'
import { Sheet } from '@/components/ui/Sheet'
import { FocusTarget } from '@/components/ui/FocusTarget'
import { Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import type { ProfileText } from '@jojo/service/data/profile'
import { displayName } from '@jojo/service/data/seed'
import { useApplications, useProfile, useVault } from '@/lib/store-context'
import { useToast } from '@/lib/toast-context'
import type { RootStackParamList } from '@/navigation/types'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'
import { BackgroundPanel } from '@/components/profile/BackgroundPanel'
import { useDomain } from '@/i18n/domain'
import { toTab } from '@/navigation/to-tab'

/** The bucket a profile document belongs to, in the Vault's own vocabulary. */
const DOCUMENTS_BUCKET = 'Applications' as const

export function ProfileScreen() {
  const { t } = useTranslation('screens')
  const domain = useDomain()
  const c = useColors()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  // A search result arriving: which row to scroll to and light (`FocusTarget`).
  const route = useRoute<RouteProp<RootStackParamList, 'Profile'>>()

  /**
   * The saved record lives in the store; only the typing is screen state.
   *
   * The difference between the two is the whole feature: it is what makes the
   * save bar appear, what Discard restores, and what stops Save writing a record
   * identical to the one already there.
   */
  const { profile, update } = useProfile()
  const saved = profile.text
  const [draft, setDraft] = useState(saved)
  const dirty = (Object.keys(saved) as (keyof ProfileText)[]).some((k) => draft[k] !== saved[k])

  /**
   * Chips and switches commit on tap, and are deliberately outside the save
   * bar's model. A control whose whole affordance is the change it makes has
   * already told the user it took effect.
   */
  const { matchTerms, roles, includeAcademia, includeIndustry } = profile
  const [termDraft, setTermDraft] = useState('')
  const [addingTerm, setAddingTerm] = useState(false)
  const [roleDraft, setRoleDraft] = useState('')
  const [addingRole, setAddingRole] = useState(false)

  const { files, addFile } = useVault()
  const { get, all } = useApplications()
  const { toast } = useToast()
  const [adding, setAdding] = useState(false)

  /**
   * A view over the Vault, never a second list. A CV recorded in one place used
   * to leave the other stale, and the "used by 12 applications" counts beside
   * them were decoration, since nothing ever counted anything.
   */
  const documents = files.filter((f) => f.bucket === DOCUMENTS_BUCKET)

  const set = (key: keyof ProfileText) => (value: string) =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  const onSave = () => {
    update({ text: draft })
    toast({
      title: t('profile.savedTitle'),
      description: t('profile.savedDescription'),
    })
  }

  const addTerm = () => {
    const term = termDraft.trim()
    if (term && !matchTerms.includes(term)) update({ matchTerms: [...matchTerms, term] })
    setTermDraft('')
    setAddingTerm(false)
  }

  const addRole = () => {
    const role = roleDraft.trim()
    if (role && !roles.includes(role)) update({ roles: [...roles, role] })
    setRoleDraft('')
    setAddingRole(false)
  }

  return (
    <Screen
      title={t('profile.title')}
      subtitle={t('profile.subtitle')}
      wide
      focus={route.params?.focus}
      onArrived={() => navigation.setParams({ focus: undefined })}
    >
      {/* Profile sections. The edit sheet stays outside — it is an overlay, not a panel. Side by side on a tablet. */}
      <Columns>
        <Panel focusId="profile.basics">
          <PanelTitle>{t('profile.basics.title')}</PanelTitle>
          {/* Every field carries a placeholder, which only matters on an empty
              store: with the records cleared this used to render a stranger's name
              and email as real values, in fields a reader would reasonably take
              for their own answers. Grey examples ask a question; black text
              answers one. */}
          <View style={{ gap: space[3] }}>
            <TextField
              focusId="profile.basics.fullName"
              label={t('profile.basics.fullName')}
              value={draft.fullName}
              placeholder={t('profile.basics.fullNamePlaceholder')}
              onChangeText={set('fullName')}
            />
            <TextField
              focusId="profile.basics.position"
              label={t('profile.basics.position')}
              value={draft.position}
              placeholder={t('profile.basics.positionPlaceholder')}
              onChangeText={set('position')}
            />
            <TextField
              focusId="profile.basics.location"
              label={t('profile.basics.location')}
              value={draft.location}
              placeholder={t('profile.basics.locationPlaceholder')}
              onChangeText={set('location')}
            />
            <TextField
              focusId="profile.basics.email"
              label={t('profile.basics.email')}
              value={draft.email}
              mono
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="you@university.edu"
              onChangeText={set('email')}
            />
          </View>
        </Panel>

        <Panel focusId="profile.links">
          <PanelTitle>{t('profile.links.title')}</PanelTitle>
          <View style={{ gap: space[3] }}>
            <TextField
              focusId="profile.links.website"
              label={t('profile.links.website')}
              value={draft.website}
              mono
              autoCapitalize="none"
              keyboardType="url"
              placeholder="https://your-site.dev"
              onChangeText={set('website')}
            />
            <TextField
              focusId="profile.links.scholar"
              label="Google Scholar"
              value={draft.scholar}
              mono
              autoCapitalize="none"
              keyboardType="url"
              placeholder="https://scholar.google.com/citations?user=…"
              onChangeText={set('scholar')}
            />
            <TextField
              focusId="profile.links.github"
              label="GitHub"
              value={draft.github}
              mono
              autoCapitalize="none"
              keyboardType="url"
              placeholder="https://github.com/you"
              onChangeText={set('github')}
            />
            <TextField
              focusId="profile.links.linkedin"
              label="LinkedIn"
              value={draft.linkedin}
              mono
              autoCapitalize="none"
              keyboardType="url"
              placeholder="https://linkedin.com/in/you"
              onChangeText={set('linkedin')}
            />
          </View>
        </Panel>

        <Panel focusId="profile.interests">
          <PanelTitle hint={t('profile.interests.hint')}>{t('profile.interests.title')}</PanelTitle>

          {/* Renamed from "keywords", which is taken. A keyword in this app is
              something you file a record under and filter by; these are the terms
              the scout scores a posting against, and the two lists have never had
              anything to do with each other. */}
          <FocusTarget id="profile.interests.matchTerms">
            <Txt size="xs" tone="secondary">
              {t('profile.interests.matchTerms')}
            </Txt>
            <Txt size="xs" tone="muted" style={{ marginTop: 2, marginBottom: space[2] }}>
              {t('profile.interests.matchTermsDescription')}
            </Txt>

            <View style={styles.terms}>
              {matchTerms.map((term) => (
                <View key={term} style={styles.termRow}>
                  <Chip tone="teal" shape="capsule">
                    {term}
                  </Chip>
                  <IconButton
                    icon="x"
                    size={30}
                    label={t('profile.remove', { name: term })}
                    onPress={() => update({ matchTerms: matchTerms.filter((x) => x !== term) })}
                  />
                </View>
              ))}
              <Button
                label={t('profile.add')}
                icon="plus"
                variant="outline"
                onPress={() => setAddingTerm(true)}
              />
            </View>
          </FocusTarget>

          {/* The one required field on every application, and until now a list
              of five this app chose. Removing one here leaves the applications
              carrying it exactly where they are — `roleVocabulary` keeps a tag
              that is in use visible whether or not it is still on the list. */}
          <FocusTarget id="profile.interests.roleTags" style={{ marginTop: space[4] }}>
            <Txt size="xs" tone="secondary" weight="medium">
              {t('profile.interests.roleTags')}
            </Txt>
            <Txt size="xs" tone="muted" style={{ marginTop: 2, marginBottom: space[2] }}>
              {t('profile.interests.roleTagsDescription')}
            </Txt>

            <View style={styles.terms}>
              {roles.map((role) => (
                <View key={role} style={styles.termRow}>
                  <Chip shape="capsule">
                    {role} {all.filter((a) => a.roleTag === role).length}
                  </Chip>
                  <IconButton
                    icon="x"
                    size={30}
                    label={t('profile.remove', { name: role })}
                    onPress={() => update({ roles: roles.filter((x) => x !== role) })}
                  />
                </View>
              ))}
              <Button
                label={t('profile.add')}
                icon="plus"
                variant="outline"
                onPress={() => setAddingRole(true)}
              />
            </View>
          </FocusTarget>

          <View style={{ gap: space[3], marginTop: space[4] }}>
            <TextField
              focusId="profile.interests.targetRoles"
              label={t('profile.interests.targetRoles')}
              value={draft.targetRoles}
              placeholder={t('profile.interests.targetRolesPlaceholder')}
              onChangeText={set('targetRoles')}
            />
            <TextField
              focusId="profile.interests.regions"
              label={t('profile.interests.regions')}
              value={draft.regions}
              placeholder={t('profile.interests.regionsPlaceholder')}
              onChangeText={set('regions')}
            />
          </View>

          <View style={{ marginTop: space[2] }}>
            <SettingRow
              focusId="profile.interests.academia"
              label={t('profile.interests.academia')}
              control={
                <Toggle
                  value={includeAcademia}
                  onValueChange={(v) => update({ includeAcademia: v })}
                  label={t('profile.interests.academia')}
                />
              }
            />
            <SettingRow
              focusId="profile.interests.industry"
              label={t('profile.interests.industry')}
              control={
                <Toggle
                  value={includeIndustry}
                  onValueChange={(v) => update({ includeIndustry: v })}
                  label={t('profile.interests.industry')}
                />
              }
            />
          </View>
        </Panel>

        {/* Above Documents, because it is what the documents are FOR. Somebody
            opening this screen after an import wants what was taken from the
            file, not the file. */}
        <BackgroundPanel />

        <Panel focusId="profile.documents">
          <PanelTitle
            hint={t('profile.documents.hint', { bucket: DOCUMENTS_BUCKET })}
            right={
              <Button
                label={t('profile.add')}
                icon="plus"
                variant="outline"
                onPress={() => setAdding(true)}
              />
            }
          >
            {t('profile.documents.title')}
          </PanelTitle>

          {documents.length === 0 ? (
            <EmptyState
              icon="file-text"
              title={t('profile.documents.emptyTitle')}
              description={t('profile.documents.emptyDescription', { bucket: DOCUMENTS_BUCKET })}
              action={
                <>
                  <Button
                    label={t('profile.documents.add')}
                    icon="plus"
                    onPress={() => setAdding(true)}
                  />
                  <Button
                    label={t('profile.documents.openVault')}
                    variant="outline"
                    onPress={() => toTab(navigation, 'Vault', { tool: 'files' })}
                  />
                </>
              }
            />
          ) : (
            <View style={{ gap: space[2.5] }}>
              {documents.map((f) => {
                // The edge is cleared, not followed, when an application is
                // deleted — so a file can name an id whose record has gone.
                // Plural, since `FILED_UNDER` is many: one CV goes to every
                // application you send it to.
                const filedUnder = f.applicationIds.map(get).filter((x) => x !== undefined)
                return (
                  <View
                    key={f.id}
                    style={[styles.document, { backgroundColor: c.well, borderColor: c.hairline }]}
                  >
                    <View style={s.row}>
                      <Feather name="file-text" size={16} color={c.accent} />
                      <Txt size="sm" mono style={s.fill} numberOfLines={1}>
                        {f.name}
                      </Txt>
                    </View>
                    <Txt size="xs" tone="muted">
                      {t('profile.documents.meta', {
                        size: f.size,
                        ago: domain.ago(f.savedOn, TODAY),
                      })}
                    </Txt>
                    {f.note ? (
                      <Txt size="xs" tone="muted" numberOfLines={2}>
                        {f.note}
                      </Txt>
                    ) : null}
                    {filedUnder.length > 0 ? (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1.5] }}>
                        {filedUnder.map((application) => (
                          <Chip key={application.id} tone="teal" size="sm">
                            {displayName(application)}
                          </Chip>
                        ))}
                      </View>
                    ) : null}
                  </View>
                )
              })}
            </View>
          )}

          <Txt size="xs" tone="muted" style={{ marginTop: space[3] }}>
            {t('profile.documents.footer', { bucket: DOCUMENTS_BUCKET })}
          </Txt>
        </Panel>

        {/**
         * The save bar. Rendered only while there is something to save, because a
         * bar that is always there stops being read.
         */}
        {dirty ? (
          // Only while there are edits; a search result cannot land on it.
          <Panel focusId={null}>
            {/* Was "saving keeps them for this visit, not to disk", which was
                false — the profile is stored — and argued against pressing
                Save. Web corrected the same line. */}
            <Txt size="sm" tone="secondary">
              {t('profile.unsaved')}
            </Txt>
            <View style={styles.saveRow}>
              <Button
                label={t('profile.discard')}
                variant="outline"
                size="md"
                onPress={() => setDraft(saved)}
              />
              <Button label={t('profile.save')} size="md" onPress={onSave} />
            </View>
          </Panel>
        ) : null}

        {adding ? (
          <FileEditor
            defaultBucket={DOCUMENTS_BUCKET}
            onClose={() => setAdding(false)}
            onSave={(draft) => {
              addFile(draft)
              setAdding(false)
              toast({
                title: t('profile.documents.addedTitle'),
                description: t('profile.documents.addedDescription', { bucket: draft.bucket }),
              })
            }}
          />
        ) : null}
      </Columns>

      <Sheet
        open={addingTerm}
        onClose={() => setAddingTerm(false)}
        title={t('profile.termSheet.title')}
        description={t('profile.termSheet.description')}
        footer={
          <>
            <Button
              label={t('shared.cancel')}
              variant="ghost"
              size="md"
              onPress={() => setAddingTerm(false)}
            />
            <Button label={t('profile.add')} size="md" onPress={addTerm} />
          </>
        }
      >
        <View style={{ paddingBottom: space[2] }}>
          <TextField
            focusId={null}
            label={t('profile.termSheet.label')}
            value={termDraft}
            autoFocus
            placeholder={t('profile.termSheet.placeholder')}
            onChangeText={setTermDraft}
            onSubmitEditing={addTerm}
          />
        </View>
      </Sheet>

      <Sheet
        open={addingRole}
        onClose={() => setAddingRole(false)}
        title={t('profile.roleSheet.title')}
        description={t('profile.roleSheet.description')}
        footer={
          <>
            <Button
              label={t('shared.cancel')}
              variant="ghost"
              size="md"
              onPress={() => setAddingRole(false)}
            />
            <Button label={t('profile.add')} size="md" onPress={addRole} />
          </>
        }
      >
        <View style={{ paddingBottom: space[2] }}>
          <TextField
            focusId={null}
            label={t('profile.roleSheet.label')}
            value={roleDraft}
            autoFocus
            placeholder={t('profile.roleSheet.placeholder')}
            onChangeText={setRoleDraft}
            onSubmitEditing={addRole}
          />
        </View>
      </Sheet>
    </Screen>
  )
}

const styles = StyleSheet.create({
  terms: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] },
  termRow: { flexDirection: 'row', alignItems: 'center' },
  document: {
    gap: space[1],
    padding: space[3],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
  },
  saveRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: space[2], marginTop: space[3] },
})
