import { useState } from 'react'
import { TODAY } from '@/lib/today'
import { StyleSheet, View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { FileEditor } from '@/components/common/FileEditor'
import { Button, IconButton } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { SettingRow, TextField, Toggle } from '@/components/ui/Field'
import { Columns, Screen } from '@/components/ui/Screen'
import { Sheet } from '@/components/ui/Sheet'
import { Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import type { ProfileText } from '@jojo/service/data/profile'
import { displayName } from '@jojo/service/data/seed'
import { agoLabel } from '@jojo/service/data/timeline'
import { useApplications, useProfile, useVault } from '@/lib/store-context'
import { useToast } from '@/lib/toast-context'
import type { RootStackParamList } from '@/navigation/types'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'
import { BackgroundPanel } from '@/components/profile/BackgroundPanel'

/** The bucket a profile document belongs to, in the Vault's own vocabulary. */
const DOCUMENTS_BUCKET = 'Applications' as const

export function ProfileScreen() {
  const c = useColors()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()

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
      title: 'Profile saved',
      description: 'Saved on this device.',
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
      title="My profile"
      subtitle="What the scout and assistant use to match and draft. None of it leaves your device."
    >
      {/* Profile sections. The edit sheet stays outside — it is an overlay, not a panel. Side by side on a tablet. */}
      <Columns>
        <Panel>
          <PanelTitle>Basics</PanelTitle>
          {/* Every field carries a placeholder, which only matters on an empty
              store: with the records cleared this used to render a stranger's name
              and email as real values, in fields a reader would reasonably take
              for their own answers. Grey examples ask a question; black text
              answers one. */}
          <View style={{ gap: space[3] }}>
            <TextField
              label="Full name"
              value={draft.fullName}
              placeholder="e.g. Alex Rivera"
              onChangeText={set('fullName')}
            />
            <TextField
              label="Current position"
              value={draft.position}
              placeholder="e.g. PhD candidate, Computer Science"
              onChangeText={set('position')}
            />
            <TextField
              label="Location"
              value={draft.location}
              placeholder="e.g. Santa Clara, CA"
              onChangeText={set('location')}
            />
            <TextField
              label="Email"
              value={draft.email}
              mono
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="you@university.edu"
              onChangeText={set('email')}
            />
          </View>
        </Panel>

        <Panel>
          <PanelTitle>Links</PanelTitle>
          <View style={{ gap: space[3] }}>
            <TextField
              label="Website"
              value={draft.website}
              mono
              autoCapitalize="none"
              keyboardType="url"
              placeholder="https://your-site.dev"
              onChangeText={set('website')}
            />
            <TextField
              label="Google Scholar"
              value={draft.scholar}
              mono
              autoCapitalize="none"
              keyboardType="url"
              placeholder="https://scholar.google.com/citations?user=…"
              onChangeText={set('scholar')}
            />
            <TextField
              label="GitHub"
              value={draft.github}
              mono
              autoCapitalize="none"
              keyboardType="url"
              placeholder="https://github.com/you"
              onChangeText={set('github')}
            />
            <TextField
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

        <Panel>
          <PanelTitle hint="drives scout matching">Interests and targets</PanelTitle>

          {/* Renamed from "keywords", which is taken. A keyword in this app is
              something you file a record under and filter by; these are the terms
              the scout scores a posting against, and the two lists have never had
              anything to do with each other. */}
          <Txt size="xs" tone="secondary">
            Match terms
          </Txt>
          <Txt size="xs" tone="muted" style={{ marginTop: 2, marginBottom: space[2] }}>
            Research areas and phrasings the scout looks for. Separate from the keywords you file
            records under.
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
                  label={`Remove ${term}`}
                  onPress={() => update({ matchTerms: matchTerms.filter((x) => x !== term) })}
                />
              </View>
            ))}
            <Button label="Add" icon="plus" variant="outline" onPress={() => setAddingTerm(true)} />
          </View>

          {/* The one required field on every application, and until now a list
              of five this app chose. Removing one here leaves the applications
              carrying it exactly where they are — `roleVocabulary` keeps a tag
              that is in use visible whether or not it is still on the list. */}
          <Txt size="xs" tone="secondary" weight="medium" style={{ marginTop: space[4] }}>
            Role tags
          </Txt>
          <Txt size="xs" tone="muted" style={{ marginTop: 2, marginBottom: space[2] }}>
            The kinds of role you are tracking. Every application is filed under one, and the role
            filter and the per-role figures read it.
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
                  label={`Remove ${role}`}
                  onPress={() => update({ roles: roles.filter((x) => x !== role) })}
                />
              </View>
            ))}
            <Button label="Add" icon="plus" variant="outline" onPress={() => setAddingRole(true)} />
          </View>

          <View style={{ gap: space[3], marginTop: space[4] }}>
            <TextField
              label="Target roles"
              value={draft.targetRoles}
              placeholder="e.g. Assistant professor (TT) · Research scientist"
              onChangeText={set('targetRoles')}
            />
            <TextField
              label="Preferred regions"
              value={draft.regions}
              placeholder="e.g. Texas · remote"
              onChangeText={set('regions')}
            />
          </View>

          <View style={{ marginTop: space[2] }}>
            <SettingRow
              label="Include academia postings"
              control={
                <Toggle
                  value={includeAcademia}
                  onValueChange={(v) => update({ includeAcademia: v })}
                  label="Include academia postings"
                />
              }
            />
            <SettingRow
              label="Include industry postings"
              control={
                <Toggle
                  value={includeIndustry}
                  onValueChange={(v) => update({ includeIndustry: v })}
                  label="Include industry postings"
                />
              }
            />
          </View>
        </Panel>

        {/* Above Documents, because it is what the documents are FOR. Somebody
            opening this screen after an import wants what was taken from the
            file, not the file. */}
        <BackgroundPanel />

        <Panel>
          <PanelTitle
            hint={`the Vault's ${DOCUMENTS_BUCKET} bucket`}
            right={
              <Button label="Add" icon="plus" variant="outline" onPress={() => setAdding(true)} />
            }
          >
            Documents
          </PanelTitle>

          {documents.length === 0 ? (
            <EmptyState
              icon="file-text"
              title="No documents yet"
              description={`Add your CV and statements — they are filed in the Vault under ${DOCUMENTS_BUCKET}, where the rest of the app can reach them.`}
              action={
                <>
                  <Button label="Add a document" icon="plus" onPress={() => setAdding(true)} />
                  <Button
                    label="Open the Vault"
                    variant="outline"
                    onPress={() =>
                      navigation.navigate('Tabs', { screen: 'Vault', params: { tool: 'files' } })
                    }
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
                      {f.size} · saved {agoLabel(f.savedOn, TODAY)}
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
            The same files as the Vault&apos;s Files tool, filtered to {DOCUMENTS_BUCKET}. A record
            keeps a document&apos;s name, size and type — never its contents.
          </Txt>
        </Panel>

        {/**
         * The save bar. Rendered only while there is something to save, because a
         * bar that is always there stops being read.
         */}
        {dirty ? (
          <Panel>
            <Txt size="sm" tone="secondary">
              Unsaved changes — saving keeps them for this visit, not to disk.
            </Txt>
            <View style={styles.saveRow}>
              <Button label="Discard" variant="outline" size="md" onPress={() => setDraft(saved)} />
              <Button label="Save" size="md" onPress={onSave} />
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
                title: 'Document added',
                description: `Filed in the Vault under ${draft.bucket}. The name, size and type are kept — the file itself is not read.`,
              })
            }}
          />
        ) : null}
      </Columns>

      <Sheet
        open={addingTerm}
        onClose={() => setAddingTerm(false)}
        title="Add a match term"
        description="A research area or a phrasing the scout should look for in a posting."
        footer={
          <>
            <Button label="Cancel" variant="ghost" size="md" onPress={() => setAddingTerm(false)} />
            <Button label="Add" size="md" onPress={addTerm} />
          </>
        }
      >
        <View style={{ paddingBottom: space[2] }}>
          <TextField
            label="Match term"
            value={termDraft}
            autoFocus
            placeholder="e.g. distributed training"
            onChangeText={setTermDraft}
            onSubmitEditing={addTerm}
          />
        </View>
      </Sheet>

      <Sheet
        open={addingRole}
        onClose={() => setAddingRole(false)}
        title="Add a role tag"
        description="A kind of role you are tracking. It becomes one of the choices on every application."
        footer={
          <>
            <Button label="Cancel" variant="ghost" size="md" onPress={() => setAddingRole(false)} />
            <Button label="Add" size="md" onPress={addRole} />
          </>
        }
      >
        <View style={{ paddingBottom: space[2] }}>
          <TextField
            label="Role tag"
            value={roleDraft}
            autoFocus
            placeholder="e.g. Data scientist"
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
