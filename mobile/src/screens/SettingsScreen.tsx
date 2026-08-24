import { useState } from 'react'
import { useModelSettings } from '@/lib/model-settings-context'
import { listModels } from '@/lib/llm'
import { testReader } from '@/lib/markitdown'
import { MARKITDOWN } from '@jojo/service/agent/markitdown'
import { normaliseEndpoint, serverAt } from '@jojo/service/core/model-server'
import type { ModelServer } from '@jojo/service/core/model-server'
import { PROVIDERS, cleanKey, providerMeta } from '@jojo/service/core/provider'
import type { ProviderId } from '@jojo/service/core/provider'
import { forgetDocuments } from '@/lib/documents'
import { s } from '@/theme/styles'
import { AuditLog } from '@/components/common/AuditLog'
import { Pressable, StyleSheet, View } from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Button, IconButton } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { SettingRow, TextField, Toggle } from '@/components/ui/Field'
import { MenuSheet } from '@/components/ui/Menu'
import { Columns, Screen } from '@/components/ui/Screen'
import { Segment } from '@/components/ui/Segment'
import { Sheet } from '@/components/ui/Sheet'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { LABEL_TONE_VALUES } from '@jojo/service/core/model'
import type { LabelTone } from '@jojo/service/data/labels'
import { useLabels } from '@/lib/labels-context'
import { useStoreAdmin, useVault } from '@/lib/store-context'
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

  /*
   * The model connection.
   *
   * `model` is the state that carries the meaning here: it is empty until a
   * server has named itself, and everything else keys off that. An address is
   * something the user can type; a model id is something only the server knows,
   * so a filled Model field is the app's record that this address answered.
   *
   * It starts from what was stored, which is why a returning user is connected
   * without pressing anything — the stored value got there by a successful test
   * in an earlier session, and nothing else can write it.
   */
  const { settings, servers, save, remember, rename, forget } = useModelSettings()
  const [endpoint, setEndpoint] = useState(settings.endpoint)
  const [model, setModel] = useState(settings.model)
  /*
   * `null` means "not edited in this session", which is different from "" —
   * a distinction a live run on the web forced, and which matters more here.
   * The saved list arrives from AsyncStorage a tick after the first render, so
   * a plain string seeded at mount would be seeded from an empty list; and an
   * empty Saved-as field for a server the user had named renames it back to the
   * model id on blur. The stored name is the truth and this is an edit buffer
   * over it, which also means it simply fills in when the list lands.
   */
  const [nameEdit, setNameEdit] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [choosing, setChoosing] = useState(false)
  /** Everything that differs between providers, looked up once per render. */
  const provider = providerMeta(settings.provider)

  /*
   * The document reader, beside the model but separate from it.
   *
   * Two programs, and a person may well run one without the other: the model
   * answers questions and MarkItDown opens documents.
   */
  const { reader, setReader } = useModelSettings()
  const [readerAt, setReaderAt] = useState(reader)
  const [readerTesting, setReaderTesting] = useState(false)
  const [readerFailure, setReaderFailure] = useState<string | null>(null)
  const [readerOk, setReaderOk] = useState(reader.length > 0)

  const onTestReader = async () => {
    setReaderTesting(true)
    setReaderFailure(null)
    const result = await testReader(readerAt)
    setReaderTesting(false)
    setReaderOk(result.ok)
    if (result.ok) setReader(readerAt.trim())
    else setReaderFailure(result.reason)
  }

  const connected = model.trim().length > 0
  const saved = serverAt(servers, endpoint)
  const name = nameEdit ?? saved?.name ?? model

  /**
   * A new address invalidates the model, so typing one clears it.
   *
   * Without this, editing the endpoint after a successful test leaves the old
   * server's model id sitting in an enabled field — and the next request goes to
   * the new address asking for a model it has never heard of, which fails with a
   * message about the model rather than about the change the user just made.
   */
  const onEndpointChange = (next: string) => {
    setEndpoint(next)
    if (normaliseEndpoint(next) !== normaliseEndpoint(endpoint)) {
      setModel('')
      setNameEdit(null)
      setFailure(null)
    }
  }

  /**
   * Switching provider, which rewrites the address rather than keeping it.
   *
   * A fixed-endpoint provider ignores whatever is stored anyway, and carrying
   * `http://localhost:11434` across into a Claude request would fail for a
   * reason nobody could guess from the screen. The model goes with it for the
   * reason `onEndpointChange` clears it: an id one server named means nothing
   * to the next one.
   */
  const onProvider = (next: ProviderId) => {
    const meta = providerMeta(next)
    setEndpoint(meta.endpoint)
    setModel('')
    setNameEdit(null)
    setFailure(null)
    save({ ...settings, provider: next, endpoint: meta.endpoint, model: '' })
  }

  /** Puts a saved server back in the fields. Already verified, so connected. */
  const onLoad = (server: ModelServer) => {
    setEndpoint(server.endpoint)
    setModel(server.model)
    setNameEdit(null)
    setFailure(null)
    setPicking(false)
    save({ ...settings, endpoint: server.endpoint, model: server.model })
  }

  /**
   * Asks the server what it serves, and fills the Model field with the answer.
   *
   * This is the whole reason the field is disabled until now. A vLLM model id is
   * the full HuggingFace path — `meta-llama/Meta-Llama-3.1-8B-Instruct` — which
   * nobody types correctly from memory, and getting it wrong fails at the first
   * request with a 404 rather than here.
   */
  const onTest = async () => {
    setTesting(true)
    setFailure(null)
    const result = await listModels({ ...settings, endpoint: endpoint.trim() })
    setTesting(false)
    if (!result.ok) {
      setFailure(result.reason)
      setModel('')
      return
    }
    // The first is the one to use. vLLM serves exactly one model and lists it;
    // Ollama and LM Studio list everything they hold, most-recent first.
    const found = result.models[0] ?? ''
    const label = saved?.name ?? found
    setModel(found)
    setNameEdit(null)
    save({ ...settings, endpoint: endpoint.trim(), model: found })
    // Saved under the model's own name unless this address already had one the
    // user chose. That is the "auto-saved" half: connecting is the act, and
    // keeping the address is a consequence of it rather than a second button.
    remember({ name: label, endpoint, model: found })
  }

  /** Renaming the entry on this card renames the row in the list. */
  const onRename = () => {
    if (!saved) return
    rename(saved.id, name)
    // Back to reading the stored value, which `renameServer` may have replaced
    // with the model id if the user blanked the field.
    setNameEdit(null)
  }
  const { exportJSON, reset, clearAll, isEmpty } = useStoreAdmin()
  // Only for the paths below: the copies behind the file rows have to be named
  // before the rows go, and the rows are the only record of where they are.
  const { files } = useVault()
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

  // Not async any more: `setString` is synchronous where `setStringAsync` was
  // not, and this is only ever an onPress. Keeping the keyword would have left
  // a promise nobody awaits and a signature that claims work it no longer does.
  const onExport = () => {
    // There is no downloads folder to write to on a phone, and no file picker
    // wired up. The clipboard is the honest export here: it is the one channel
    // that reaches another app without this build claiming a filesystem it has
    // not asked for.
    Clipboard.setString(exportJSON())
    toast({
      title: 'Copied to the clipboard',
      description: 'The whole store as JSON — paste it into a note or a file to keep it.',
    })
  }

  /**
   * Wiping the store, and the bytes the store was pointing at.
   *
   * THE DOCUMENTS ARE THE PART THAT WAS MISSING. A file row can hold a real
   * document copied into this app's sandbox, and the graph only ever holds its
   * path (D27). Emptying the graph therefore took the rows and left every copy
   * on the device — reclaimable by uninstalling the app and by nothing else —
   * while the confirmation the user had just read said the vault was going.
   * That is the shape of defect this codebase treats as worst: not a crash, a
   * sentence on screen that is not true.
   *
   * All three actions below take every record with them and none of them has an
   * Undo, which is the condition that makes deleting bytes safe here and unsafe
   * on a single row — see `onDelete` in `screens/vault/FilesTool.tsx`.
   *
   * Read BEFORE the store call, because `files` is the projection this render
   * closed over: after `clearAll()` it is still the old array, but relying on
   * that would be relying on a render boundary rather than on a local. Not
   * awaited, because the unlinks are best-effort and the store is already
   * empty on screen — see `forgetDocuments`, which never rejects.
   */
  const applyPending = () => {
    const attached = files.map((f) => f.uri)

    if (pending === 'empty') {
      clearAll()
      void forgetDocuments(attached)
      toast({
        title: 'Everything cleared',
        description:
          'Every record is gone, your profile included, and any documents you attached have been deleted from this device. Load the demo data again from here.',
        tone: 'danger',
      })
      return
    }
    reset()
    void forgetDocuments(attached)
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
          'Applications, the timeline, the vault, saved postings and your profile all go, including anything you added this session, and any documents you attached are deleted from this device with them. There is no undo — export first if you want them back. Your keywords are kept, but nothing is left carrying them.',
        confirm: 'Clear everything',
      },
      demo: {
        title: 'Load the demo data?',
        description:
          'The seeded records come back, tagged with the keywords they shipped with. Anything you have added this session is replaced, not merged, and any documents you attached are deleted from this device. There is no undo.',
        confirm: 'Load demo data',
      },
      reset: {
        title: 'Reset to the demo data?',
        description:
          'Every edit, addition and deletion from this session is discarded and the seeded records come back exactly as they shipped, so any documents you attached are deleted from this device. Your keyword list itself is left alone. There is no undo.',
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
            a file you own, so they survive closing the app. Nothing here is connected yet.
          </Txt>
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
          {/* Was "Local model", and that stopped being true the moment this
              panel could reach Claude. A heading that names one of the two
              answers is a heading that is wrong half the time. */}
          <PanelTitle
            right={
              <IconButton
                icon="link"
                label="Saved servers"
                onPress={() => setPicking(true)}
                disabled={servers.length === 0}
              />
            }
          >
            Model
          </PanelTitle>
          <Txt size="sm" tone="secondary" style={{ marginBottom: space[3] }}>
            A model on a machine you can reach, or one you pay for. Local is the default because it
            is the only arrangement where your records never leave this device.
          </Txt>

          {/* The provider first, because every field under it depends on the
              answer: a local server needs an address, a cloud one needs a key
              and has its address already.

              A sheet rather than the segmented control the rest of this screen
              uses. Six options, one of them labelled "A local server (vLLM, LM
              Studio, llama.cpp)", do not fit a 390pt track — scrolled sideways
              they become a row you have to swipe to discover, which is the one
              thing a picker must not be. */}
          <SettingRow
            label="Provider"
            description={provider.label}
            onPress={() => setChoosing(true)}
          />
          {provider.cloud ? (
            <Txt size="xs" tone="warning" style={{ marginBottom: space[3] }}>
              Everything you ask goes to {provider.label} and is billed to your account. jojo is
              local-first; this is the one part that is not.
            </Txt>
          ) : null}
          <View style={{ gap: space[3] }}>
            {/* Not offered at all when the provider's address is fixed. An
                editable field over a value the request builder is going to
                ignore is a field that can only mislead. */}
            {provider.fixedEndpoint ? null : (
              <TextField
                label="Endpoint"
                mono
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                value={endpoint}
                placeholder={provider.endpoint || 'http://localhost:8000/v1'}
                hint={
                  provider.dialect === 'ollama'
                    ? 'The host and port. No /v1 — jojo uses Ollama’s own endpoint so it can ask it not to truncate.'
                    : 'The base URL, ending in /v1.'
                }
                onChangeText={onEndpointChange}
              />
            )}

            {/* Written straight to the settings document, which lives in
                AsyncStorage BESIDE the graph rather than inside it — so a
                backup, which is nodes, edges and documents, cannot carry a key
                even by accident. `textContentType="none"` is the other half of
                keeping it there: iOS offers to save anything in a secure field
                to the keychain, and a provider key is not the user's password. */}
            {provider.needsKey ? (
              <TextField
                label="API key"
                mono
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                textContentType="none"
                value={settings.apiKey ?? ''}
                placeholder="sk-…"
                hint="Kept on this device only. It is never put in a backup and never sent anywhere but the provider."
                onChangeText={(next) => {
                  save({ ...settings, apiKey: cleanKey(next) })
                }}
              />
            ) : null}
            {/* Empty and unusable until a server has answered. The model id is
                the server's to state, not the user's to guess, and a field
                offering to take a guess is a field inviting a 404 later. */}
            <TextField
              label="Model"
              mono
              autoCapitalize="none"
              autoCorrect={false}
              value={model}
              editable={connected}
              placeholder={connected ? '' : 'Found when you test the connection'}
              hint={
                connected
                  ? 'What the server reported. Change it if you serve more than one.'
                  : undefined
              }
              onChangeText={setModel}
              onBlur={() => {
                save({ ...settings, endpoint: endpoint.trim(), model: model.trim() })
              }}
            />
            {/* Only once there is something to name. Before that it would be a
                label for a connection that does not exist. */}
            {connected ? (
              <TextField
                label="Saved as"
                autoCapitalize="none"
                autoCorrect={false}
                value={name}
                placeholder={model}
                hint="What this server is called in the list. Defaults to the model."
                onChangeText={setNameEdit}
                onBlur={onRename}
              />
            ) : null}
            {/*
              The three address chips that used to sit here are gone. They
              existed to save somebody remembering whether Ollama is 11434 or
              11343 — and the provider row above now sets the address as a
              consequence of choosing the provider, which is the same help
              arriving earlier. Two controls writing one field is how they end
              up disagreeing.
            */}
          </View>
          <View style={styles.testRow}>
            <Button
              label={testing ? 'Testing…' : connected ? 'Test again' : 'Test connection'}
              variant="outline"
              disabled={testing || endpoint.trim().length === 0}
              blocker={endpoint.trim().length === 0 ? 'Fill in an endpoint first.' : undefined}
              onPress={onTest}
            />
            {connected ? (
              <Chip tone="green">Connected</Chip>
            ) : failure ? (
              <Chip tone="red">No answer</Chip>
            ) : (
              <Chip tone="gray">Not connected</Chip>
            )}
          </View>
          {/* The server's own words, not a paraphrase. A wrong port and a path
              missing its /v1 fail differently, and only the endpoint knows
              which happened. */}
          {failure ? (
            <Txt size="xs" tone="danger" style={{ marginTop: space[2] }}>
              {failure}
            </Txt>
          ) : connected ? (
            <Txt size="xs" tone="muted" style={{ marginTop: space[2] }}>
              Kept on this device. The assistant will use this model.
            </Txt>
          ) : null}
        </Panel>

        <Panel>
          <PanelTitle hint="optional">Read my documents</PanelTitle>
          <Txt size="sm" tone="secondary" style={{ marginBottom: space[3] }}>
            The assistant can only see a document’s name until something turns it into text. Run{' '}
            {MARKITDOWN.name} on a machine this phone can reach and it can read what is inside your
            PDFs, Word files, decks and spreadsheets.
          </Txt>
          <TextField
            label="Address"
            mono
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={readerAt}
            placeholder={MARKITDOWN.defaultEndpoint}
            hint="Where markitdown-mcp is listening. The path ends in /mcp."
            onChangeText={(next) => {
              setReaderAt(next)
              setReaderOk(false)
              setReaderFailure(null)
            }}
          />
          <View style={{ marginTop: space[3], gap: space[1] }}>
            <Txt size="xs" tone="muted">
              Not running it yet?
            </Txt>
            <Txt size="xs" tone="secondary" mono>
              {MARKITDOWN.install}
            </Txt>
            <Txt size="xs" tone="secondary" mono>
              {MARKITDOWN.serve}
            </Txt>
          </View>
          <View style={styles.testRow}>
            <Button
              label={readerTesting ? 'Testing…' : readerOk ? 'Test again' : 'Test connection'}
              variant="outline"
              disabled={readerTesting || readerAt.trim().length === 0}
              blocker={readerAt.trim().length === 0 ? 'Fill in an address first.' : undefined}
              onPress={onTestReader}
            />
            {readerOk ? (
              <Chip tone="green">Connected</Chip>
            ) : readerFailure ? (
              <Chip tone="red">No answer</Chip>
            ) : (
              <Chip tone="gray">Not connected</Chip>
            )}
          </View>
          {readerFailure ? (
            <Txt size="xs" tone="danger" style={{ marginTop: space[2] }}>
              {readerFailure}
            </Txt>
          ) : readerOk ? (
            <Txt size="xs" tone="muted" style={{ marginTop: space[2] }}>
              Documents are sent to that address and nowhere else. Nothing is uploaded.
            </Txt>
          ) : null}
          {/* The notice the licence asks for, where the choice is made. */}
          <Divider style={{ marginVertical: space[3] }} />
          <Txt size="xs" tone="muted">
            {MARKITDOWN.name} is a separate program, not part of jojo. {MARKITDOWN.copyright}{' '}
            {MARKITDOWN.licence}. jojo is not affiliated with Microsoft.
          </Txt>
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
            {/* The blocker has changed twice and both previous reasons are now
                false, so it is worth saying which one this is.

                "The store can be read but not yet replaced" was wrong because
                `repo.replaceAll` exists. "Reading a backup needs a validator
                able to refuse a file it does not understand" was right when it
                was written and is not any more: `core/backup.ts`'s `readBackup`
                is that validator, `repo/restore.ts` is the restore, and the
                Transfer screen already runs both on every backup that arrives
                over the network.

                What is missing now is only the FILE half — a picker that hands
                this app a .json from wherever the person keeps it. That is a
                `@react-native-documents/picker` call away and is genuinely not
                built, rather than being a reason not to build it. */}
            <Button
              label="Import"
              icon="download"
              variant="outline"
              blocker="Reading a backup file needs the document picker wired to it, which is not built — a transfer from your computer already restores one"
            />
          </View>
          {/* This paragraph said keywords "live in their own store and are not in
              it yet". They have not lived in their own store since D14 — a
              keyword is a node and tagging is a TAGS edge — and `exportJSON` in
              `@jojo/service/react/use-admin` has carried both `keywords` and
              `keywordsByRecord` ever since. The sentence told people their
              backup was lossier than it is, on the screen whose whole job is
              saying what is in the file, and it is the same claim the service
              layer's own comment records as having stopped being true. */}
          <Txt size="xs" tone="muted" style={{ marginTop: space[2] }}>
            The export covers applications, the timeline, the vault, saved postings, your keywords
            and what they tag, and your profile. It is the whole store.
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
              Your records are saved on this device and survive closing the app. Nothing leaves it:
              there is no account, no sync and no network call. Export writes a copy to the
              clipboard if you want one somewhere else.
            </Txt>
          </View>
        </Panel>

        <KeywordManager />

        <AuditLog />
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

      <ProviderPicker
        open={choosing}
        current={settings.provider}
        onClose={() => setChoosing(false)}
        onPick={onProvider}
      />

      <SavedServers
        open={picking}
        servers={servers}
        current={normaliseEndpoint(endpoint)}
        onClose={() => setPicking(false)}
        onLoad={onLoad}
        onForget={forget}
      />
    </Screen>
  )
}

/* ------------------------------- providers -------------------------------- */

/**
 * Who is going to answer, as a sheet of six.
 *
 * The list is `PROVIDERS` verbatim — order included, which puts the two that
 * cost nothing and send nothing at the top, where a local-first app should put
 * them. Nothing about a provider is restated here; the hint under each row is
 * read off the same table the request builder consults, so a seventh provider
 * added in `@jojo/service/core/provider` appears with the right caption and
 * nobody has to remember this file exists.
 */
function ProviderPicker({
  open,
  current,
  onClose,
  onPick,
}: {
  open: boolean
  current: string
  onClose: () => void
  onPick: (next: ProviderId) => void
}) {
  return (
    <MenuSheet
      open={open}
      onClose={onClose}
      title="Provider"
      description="Choosing one sets its address for you. The cloud ones need a key and bill you per question."
      actions={PROVIDERS.map((p) => ({
        id: p.id,
        label: p.label,
        hint: p.cloud
          ? 'Your words go to this company, and are billed to you'
          : p.needsKey
            ? 'On a machine you control. Needs a key.'
            : 'On a machine you control. Nothing leaves it.',
        checked: p.id === current,
        onPress: () => {
          onPick(p.id)
        },
      }))}
    />
  )
}

/* ------------------------------ saved servers ----------------------------- */

/**
 * The addresses this device has connected to before.
 *
 * The point of the list is the port. Everyone who runs a local model knows what
 * they are running and nobody remembers whether it came up on 8000 or 11434, so
 * the cost of using a model you already have running is retyping a URL — which
 * is exactly the friction that stops people connecting one at all.
 *
 * Only servers that answered get in here. Nothing is written on typing, so a
 * row in this list is a claim that the address worked at least once, and Load is
 * safe to treat as connected without a fresh round trip.
 *
 * Delete is immediate and unconfirmed, which is deliberate: it forgets an
 * address, and the recovery is typing it again. A confirmation sheet on top of
 * the sheet already open would cost more than the mistake does.
 */
function SavedServers({
  open,
  servers,
  current,
  onClose,
  onLoad,
  onForget,
}: {
  open: boolean
  servers: readonly ModelServer[]
  current: string
  onClose: () => void
  onLoad: (server: ModelServer) => void
  onForget: (id: string) => void
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Saved servers"
      description="Addresses that have answered on this device."
      footer={<Button label="Done" onPress={onClose} />}
    >
      <View>
        {servers.length === 0 ? (
          <Txt size="sm" tone="muted">
            Nothing saved yet. Test a connection and the address is kept here.
          </Txt>
        ) : (
          servers.map((server, i) => (
            <View key={server.id}>
              {i > 0 ? <Divider /> : null}
              <View style={[s.row, { paddingVertical: space[2] }]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Load ${server.name}`}
                  style={s.fill}
                  onPress={() => {
                    onLoad(server)
                  }}
                >
                  <View style={s.row}>
                    <Txt size="sm" weight="medium" numberOfLines={1} style={s.fill}>
                      {server.name}
                    </Txt>
                    {/* Which one is in the fields right now. Two saved servers
                        on the same machine differ by a port, and a list of
                        near-identical URLs with nothing marked is a list you
                        have to read character by character. */}
                    {server.endpoint === current ? <Chip tone="green">In use</Chip> : null}
                  </View>
                  <Txt size="xs" tone="muted" mono numberOfLines={1}>
                    {server.endpoint}
                  </Txt>
                  <Txt size="xs" tone="muted" numberOfLines={1}>
                    {server.model}
                  </Txt>
                </Pressable>
                <IconButton
                  icon="trash-2"
                  label={`Forget ${server.name}`}
                  tone="danger"
                  onPress={() => {
                    onForget(server.id)
                  }}
                />
              </View>
            </View>
          ))
        )}
      </View>
    </Sheet>
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
            {/*
              The VOCABULARY, not the rotation.

              This read `NEW_LABEL_TONES` from the deleted `@/data/labels` — the
              array that decides which colour the NEXT auto-created keyword gets.
              The two arrays hold the same five tones in different orders, so the
              misuse was invisible: a picker offering all five is right by
              accident as long as the rotation happens to be complete, and stops
              being right the day somebody shortens the rotation to three.
              `LABEL_TONE_VALUES` is what `s.enum` validates a tone against in
              `core/validate.ts`, so this offers exactly what will save.

              Visible consequence, and the only one in this step: the swatches
              reorder from teal-green-amber-red-grey to teal-amber-red-green-grey.
            */}
            <View style={styles.tones}>
              {LABEL_TONE_VALUES.map((tone) => (
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
