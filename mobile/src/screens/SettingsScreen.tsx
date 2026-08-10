import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Button, IconButton } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { SettingRow, TextField, Toggle } from '@/components/ui/Field'
import { Columns, Screen } from '@/components/ui/Screen'
import { Segment } from '@/components/ui/Segment'
import { Sheet } from '@/components/ui/Sheet'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { NEW_LABEL_TONES } from '@/data/labels'
import type { LabelTone } from '@/data/labels'
import { useLabels } from '@/lib/labels-context'
import { useStoreAdmin } from '@/lib/store-context'
import { useToast } from '@/lib/toast-context'
import type { RootStackParamList } from '@/navigation/types'
import { useTheme } from '@/theme/theme-context'
import type { ThemePref } from '@/theme/theme-context'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'

const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const satisfies readonly { value: ThemePref; label: string }[]

const DATA_SETS = [
  { value: 'demo', label: 'Demo data' },
  { value: 'empty', label: 'Empty' },
] as const

/** Which destructive data action is waiting on a confirmation. */
type PendingData = 'demo' | 'empty' | 'reset'

export function SettingsScreen() {
  const c = useColors()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { pref, setPref } = useTheme()
  const { exportJSON, reset, clearAll, isEmpty } = useStoreAdmin()
  const { toast } = useToast()

  // All three start off. They were on by default in a panel whose own copy says
  // nothing is connected — and in an app whose promise is that your data stays
  // on your device, a switch that claims to be writing files somewhere is the
  // single most consequential thing a person could be wrong about.
  const [autoSync, setAutoSync] = useState(false)
  const [snapshots, setSnapshots] = useState(false)
  const [watchFolder, setWatchFolder] = useState(false)
  const [pending, setPending] = useState<PendingData | null>(null)

  const dataSet = isEmpty ? 'empty' : 'demo'

  const onExport = async () => {
    // There is no downloads folder to write to on a phone, and no file picker
    // wired up. The clipboard is the honest export here: it is the one channel
    // that reaches another app without this build claiming a filesystem it has
    // not asked for.
    await Clipboard.setStringAsync(exportJSON())
    toast({
      title: 'Copied to the clipboard',
      description: 'The whole store as JSON — paste it into a note or a file to keep it.',
    })
  }

  const applyPending = () => {
    if (pending === 'empty') {
      clearAll()
      toast({
        title: 'Everything cleared',
        description:
          'Every record is gone, your profile included. Load the demo data again from here.',
        tone: 'danger',
      })
      return
    }
    reset()
    toast({
      title: pending === 'reset' ? 'Demo data reset' : 'Demo data loaded',
      description:
        'The seeded applications, timeline, vault, postings and profile are back as they shipped.',
    })
  }

  const pendingCopy: Record<PendingData, { title: string; description: string; confirm: string }> =
    {
      empty: {
        title: 'Clear every record?',
        description:
          'Applications, the timeline, the vault, saved postings and your profile all go, including anything you added this session. There is no undo — export first if you want them back. Your keywords are kept, but nothing is left carrying them.',
        confirm: 'Clear everything',
      },
      demo: {
        title: 'Load the demo data?',
        description:
          'The seeded records come back, tagged with the keywords they shipped with. Anything you have added this session is replaced, not merged, and there is no undo.',
        confirm: 'Load demo data',
      },
      reset: {
        title: 'Reset to the demo data?',
        description:
          'Every edit, addition and deletion from this session is discarded and the seeded records come back exactly as they shipped. Your keyword list itself is left alone. There is no undo.',
        confirm: 'Reset data',
      },
    }

  return (
    <Screen title="Settings" subtitle="Connections, sync and your data">
      {/* Setting groups. The confirm sheet stays outside — it is an overlay, not a panel. Side by side on a tablet. */}
      <Columns>
        <Panel>
          <PanelTitle hint="optional">Save to a file on this device</PanelTitle>
          <Txt size="sm" tone="secondary" style={{ marginBottom: space[3] }}>
            jojo works fully without this. Set up later and it also keeps a copy of your records in
            a file you own, so they survive closing the app. Nothing connects to these fields yet.
          </Txt>
          <View style={{ gap: space[3] }}>
            <TextField label="Address" mono defaultValue="http://localhost:7423" editable={false} />
            {/* "Bridge" is load-bearing since Transfer arrived: that screen also
                shows a "Pairing code", and it means something else entirely — one
                pairs this app with a helper process on a machine, the other pairs
                this device with a second one. */}
            <TextField
              label="Bridge pairing code"
              mono
              defaultValue="••••-••••-4F2A"
              editable={false}
            />
          </View>

          <View style={{ marginTop: space[2] }}>
            {/* Named for what happens to the user's records, not for the
                mechanism. "Auto sync" describes an implementation; "save as I
                work" describes the thing being promised. */}
            <SettingRow
              label="Save as I work"
              description="Write every change straight to that file"
              control={
                <Toggle value={autoSync} onValueChange={setAutoSync} label="Save as I work" />
              }
            />
            <SettingRow
              label="Keep a copy of what I sent"
              description="A timestamped snapshot of each submitted application"
              control={
                <Toggle
                  value={snapshots}
                  onValueChange={setSnapshots}
                  label="Keep a copy of what I sent"
                />
              }
            />
            <SettingRow
              label="Notice when my documents change"
              description="Pick up edits to your CV and statements automatically"
              control={
                <Toggle
                  value={watchFolder}
                  onValueChange={setWatchFolder}
                  label="Notice when my documents change"
                />
              }
            />
          </View>
        </Panel>

        <Panel>
          <PanelTitle hint="OpenAI-compatible">Local model</PanelTitle>
          <Txt size="sm" tone="secondary" style={{ marginBottom: space[3] }}>
            Point at any local server: vLLM, Ollama or LM Studio.
          </Txt>
          <View style={{ gap: space[3] }}>
            <TextField
              label="Endpoint"
              mono
              defaultValue="http://localhost:8000/v1"
              editable={false}
            />
            <TextField label="Model" mono defaultValue="llama-3.1-8b-instruct" editable={false} />
          </View>
          <View style={styles.testRow}>
            <Button
              label="Test connection"
              variant="outline"
              blocker="This build makes no network requests, so there is nothing to reach the endpoint with"
            />
            <Chip tone="gray">Not connected</Chip>
          </View>
        </Panel>

        <Panel>
          <PanelTitle>Appearance</PanelTitle>
          <SettingRow
            label="Theme"
            description="System follows your device setting"
            control={null}
          />
          <Segment label="Theme" options={THEMES} value={pref} onChange={setPref} />
        </Panel>

        <Panel>
          <PanelTitle>Your data</PanelTitle>
          <View style={styles.dataRow}>
            <Button label="Export as JSON" icon="upload" variant="outline" onPress={onExport} />
            <Button
              label="Import"
              icon="download"
              variant="outline"
              blocker="The store can be read but not yet replaced, so an import would have nowhere to land"
            />
          </View>
          <Txt size="xs" tone="muted" style={{ marginTop: space[2] }}>
            The export covers applications, the timeline, the vault, saved postings and your
            profile. Keywords live in their own store and are not in it yet — the panel below
            manages those.
          </Txt>

          <View style={{ marginTop: space[3] }}>
            <SettingRow
              label="Records"
              description={
                isEmpty
                  ? 'Every list is empty, so every screen is showing its first-run state.'
                  : 'The seeded search — twelve applications, a timeline, a stocked vault.'
              }
              control={null}
            />
            <Segment
              label="Records"
              options={DATA_SETS}
              value={dataSet}
              // The segment reflects the store rather than a local flag, so it
              // does not flip until the confirmation behind it has been taken.
              onChange={(next) => setPending(next === 'empty' ? 'empty' : 'demo')}
            />

            <Divider style={{ marginVertical: space[3] }} />

            <SettingRow
              label="Move to another device"
              description="Pair with a second device and hand over everything. A demonstration in this build — nothing is transmitted."
              onPress={() => navigation.navigate('Transfer')}
            />
            <SettingRow
              label="Reset the demo data"
              description="Puts back everything as it shipped, discarding this session's edits."
              control={
                <Button
                  label="Reset"
                  icon="rotate-ccw"
                  variant="outline"
                  blocker={isEmpty ? 'Switch Records back to Demo data first' : undefined}
                  onPress={() => setPending('reset')}
                />
              }
            />
          </View>

          <View
            style={[
              styles.warning,
              { backgroundColor: c.warningSoft, borderColor: c.warningBorder },
            ]}
          >
            <Txt size="sm" tone="warning">
              Nothing is written to disk in this build — the store lives in memory for as long as
              the app is open, so a restart puts the demo data back and takes your changes with it.
              Export before you close it.
            </Txt>
          </View>
        </Panel>

        <KeywordManager />
      </Columns>

      <ConfirmSheet
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending ? pendingCopy[pending].title : 'Change the data?'}
        description={pending ? pendingCopy[pending].description : ''}
        confirmLabel={pending ? pendingCopy[pending].confirm : 'Continue'}
        tone="danger"
        onConfirm={applyPending}
      />
    </Screen>
  )
}

/* ----------------------------- keyword manager ---------------------------- */

const TONE_LABEL: Record<LabelTone, string> = {
  teal: 'Teal',
  amber: 'Amber',
  red: 'Red',
  green: 'Green',
  gray: 'Grey',
}

/**
 * The keyword list itself — rename, recolour, delete.
 *
 * Keywords are the user's own system and are shared by applications, reminders
 * and everything in the Vault, so they are managed once here rather than per
 * screen. Deleting one takes it off every record; `restore` puts all of that
 * back, which is why this is an undo rather than a confirmation.
 */
function KeywordManager() {
  const c = useColors()
  const { labels, addLabel, renameLabel, removeLabel, setTone, countFor } = useLabels()
  const { toast } = useToast()
  const [editing, setEditing] = useState<(typeof labels)[number] | null>(null)
  const [draftName, setDraftName] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  const onDelete = (id: string, name: string) => {
    const used = countFor(id)
    const { restore } = removeLabel(id)
    toast({
      title: `${name} deleted`,
      description: used > 0 ? `Taken off ${used} record${used === 1 ? '' : 's'}.` : undefined,
      tone: 'danger',
      action: { label: 'Undo', onPress: restore },
    })
  }

  return (
    <Panel>
      <PanelTitle
        hint="shared by applications, reminders and the Vault"
        right={<Button label="New" icon="plus" variant="outline" onPress={() => setAdding(true)} />}
      >
        Keywords
      </PanelTitle>

      {labels.map((l, i) => (
        <View key={l.id}>
          {i > 0 ? <Divider /> : null}
          <View style={styles.keywordRow}>
            <Chip tone={l.tone} shape="capsule">
              {l.name}
            </Chip>
            <Txt size="xs" tone="muted" style={{ flex: 1 }}>
              Used on {countFor(l.id)} {countFor(l.id) === 1 ? 'record' : 'records'}
            </Txt>
            <IconButton
              icon="edit-2"
              label={`Rename ${l.name}`}
              onPress={() => {
                setDraftName(l.name)
                setEditing(l)
              }}
            />
            <IconButton
              icon="trash-2"
              tone="danger"
              label={`Delete ${l.name}`}
              onPress={() => onDelete(l.id, l.name)}
            />
          </View>
        </View>
      ))}

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Edit ${editing.name}` : 'Edit keyword'}
        description="Renaming leaves the id alone, so every record carrying this keyword follows."
        footer={
          <>
            <Button label="Cancel" variant="ghost" size="md" onPress={() => setEditing(null)} />
            <Button
              label="Save"
              size="md"
              onPress={() => {
                if (!editing) return
                // Refused rather than merged when the name is taken: two chips
                // reading the same word are indistinguishable, and merging would
                // quietly rewrite every record carrying either one.
                const ok = renameLabel(editing.id, draftName)
                if (!ok) {
                  toast({
                    title: 'That name is taken',
                    description: 'Another keyword already answers to it.',
                    tone: 'danger',
                  })
                  return
                }
                setEditing(null)
              }}
            />
          </>
        }
      >
        <View style={{ gap: space[3.5], paddingBottom: space[2] }}>
          <TextField label="Name" value={draftName} onChangeText={setDraftName} />
          <View>
            <Txt size="xs" tone="secondary" style={{ marginBottom: space[2] }}>
              Colour
            </Txt>
            <View style={styles.tones}>
              {NEW_LABEL_TONES.map((tone) => (
                <Pressable
                  key={tone}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: editing?.tone === tone }}
                  accessibilityLabel={TONE_LABEL[tone]}
                  onPress={() => editing && setTone(editing.id, tone)}
                  style={[
                    styles.toneOption,
                    {
                      borderColor: editing?.tone === tone ? c.accent : c.hairline,
                    },
                  ]}
                >
                  <Chip tone={tone} shape="capsule" size="sm">
                    {TONE_LABEL[tone]}
                  </Chip>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Sheet>

      <Sheet
        open={adding}
        onClose={() => setAdding(false)}
        title="New keyword"
        description="Keywords are yours. The same one works on an application, a reminder, a file and a link."
        footer={
          <>
            <Button label="Cancel" variant="ghost" size="md" onPress={() => setAdding(false)} />
            <Button
              label="Add"
              size="md"
              onPress={() => {
                const name = newName.trim()
                if (!name) return
                addLabel(name)
                setNewName('')
                setAdding(false)
                toast({ title: `${name} added` })
              }}
            />
          </>
        }
      >
        <View style={{ paddingBottom: space[2] }}>
          <TextField
            label="Name"
            value={newName}
            autoFocus
            placeholder="e.g. Waiting on them"
            onChangeText={setNewName}
          />
        </View>
      </Sheet>
    </Panel>
  )
}

const styles = StyleSheet.create({
  testRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginTop: space[3] },
  dataRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  warning: {
    marginTop: space[4],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    paddingHorizontal: space[3.5],
    paddingVertical: space[3],
  },
  keywordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingVertical: space[2],
  },
  tones: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  toneOption: { borderWidth: 1.5, borderRadius: radius.full, padding: 3 },
})
