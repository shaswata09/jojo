import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useModelSettings } from '@/lib/model-settings-context'
import { listModels } from '@/lib/llm'
import { testReader } from '@/lib/markitdown'
import { MARKITDOWN } from '@jojo/service/agent/markitdown'
import {
  DEFAULT_THINKING,
  normaliseEndpoint,
  sendsThinking,
  serverAt,
  serversFor,
} from '@jojo/service/core/model-server'
import type { ModelServer, Thinking } from '@jojo/service/core/model-server'
import { cloudTerms } from '@jojo/service/core/cloud-terms'
import {
  PROVIDERS,
  cleanKey,
  isLoopbackEndpoint,
  parseContextWindow,
  providerMeta,
  type ProviderMeta,
} from '@jojo/service/core/provider'
import type { ProviderId } from '@jojo/service/core/provider'
import { copyExport } from '@/lib/clipboard-export'
import { bucket } from '@jojo/service/core/analytics'
import { buildPhoneBackup } from '@/lib/phone-backup'
import {
  importOutcomeToast,
  pathOfUri,
  pickFailure,
  planImport,
  planImportBase64,
  type ImportPlan,
} from '@/lib/import-backup'
import { applyPlan } from '@/lib/restore-received'
import type { RestorePlan } from '@jojo/service/core/backup'
import { keepLocalCopy, pick, types } from '@react-native-documents/picker'
import ReactNativeBlobUtil from 'react-native-blob-util'
import { useGraph, useKg } from '@jojo/service/react/kg-context'
import { forgetDocuments } from '@/lib/documents'
import { s } from '@/theme/styles'
import { AuditLog } from '@/components/common/AuditLog'
import { CrashPanel } from '@/components/common/CrashPanel'
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import { useNavigation, useRoute } from '@react-navigation/native'
import type { RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Button, IconButton } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { SettingRow, TextField } from '@/components/ui/Field'
import { LanguageRow } from '@/components/settings/LanguageRow'
import { MenuSheet } from '@/components/ui/Menu'
import { Columns, Screen } from '@/components/ui/Screen'
import { Segment } from '@/components/ui/Segment'
import { Sheet } from '@/components/ui/Sheet'
import { FocusTarget } from '@/components/ui/FocusTarget'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { LABEL_TONE_VALUES } from '@jojo/service/core/model'
import { useLabels } from '@/lib/labels-context'
import { useStoreAdmin, useVault } from '@/lib/store-context'
import { useToast } from '@/lib/toast-context'
import type { RootStackParamList } from '@/navigation/types'
import { useTheme } from '@/theme/theme-context'
import type { ThemePref } from '@/theme/theme-context'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'
import { TourTarget } from '@/components/tour/TourTarget'
import { report } from '@/lib/analytics'
import { reportableProvider } from '@jojo/service/core/analytics'
import { useDomain } from '@/i18n/domain'

// The option tables below are values only; their labels are catalog keys
// under `settings.*`, translated where the segment is drawn.
const THEMES = ['light', 'dark', 'system'] as const satisfies readonly ThemePref[]

const DATA_SETS = ['demo', 'empty'] as const

/** Which destructive data action is waiting on a confirmation. */
type PendingData = 'demo' | 'empty' | 'reset'

/**
 * The reasoning choices offered, the web form's three. `server-default` is the
 * benchmark's escape hatch and not a choice a person can make here.
 */
const REASONING = ['on', 'low', 'off'] as const satisfies readonly Thinking[]

export function SettingsScreen() {
  const { t, i18n } = useTranslation('screens')
  const domain = useDomain()
  const themes = THEMES.map((value) => ({ value, label: t(`settings.themes.${value}`) }))
  const dataSets = DATA_SETS.map((value) => ({ value, label: t(`settings.dataSets.${value}`) }))
  const reasoning = REASONING.map((value) => ({ value, label: t(`settings.reasoning.${value}`) }))
  const c = useColors()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  // A search result arriving: which row to scroll to and light (`FocusTarget`).
  const route = useRoute<RouteProp<RootStackParamList, 'Settings'>>()
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
  /*
   * An edit buffer: the stored value is a number and the field is text, so a
   * half-typed "3" would otherwise have the app plan against 3 tokens for as
   * long as it takes to type the rest. Committed on blur.
   */
  const [windowEdit, setWindowEdit] = useState(
    settings.contextWindow === undefined ? '' : String(settings.contextWindow),
  )
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
   * The saved rows for THIS provider only — same rule as the web panel.
   *
   * The stored list spans every provider this device has reached, and offering
   * all of it here would put a local vLLM box in the NVIDIA picker, where
   * choosing it swaps the endpoint, the dialect and the key underneath a form
   * that still says NVIDIA.
   */
  const shown = serversFor(servers, provider.id)

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
    if (result.ok) {
      setReader(readerAt.trim())
      void report('reader_connected', { via: 'direct' })
    } else setReaderFailure(result.reason)
  }

  const connected = model.trim().length > 0
  // The model too: a saved row is one MODEL at one address now, so a hosted
  // provider has several rows sharing an endpoint and the name belongs to the
  // one being edited rather than to whichever of them was stored first.
  const saved = serverAt(servers, endpoint, model)
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
    void report('model_connected', { provider: reportableProvider(settings.provider) })
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
  // The rows an export has to carry, and the clock it stamps. `now()` rather
  // than `new Date()` for the reason `kg-context` gives: one clock, injected,
  // so nothing in this tree disagrees about when something happened.
  const graph = useGraph()
  const { now, repo } = useKg()
  // Only for the paths below: the copies behind the file rows have to be named
  // before the rows go, and the rows are the only record of where they are.
  const { files } = useVault()
  const { toast } = useToast()

  // All three start off. They were on by default in a panel whose own copy says
  // nothing is connected — and in an app whose promise is that your data stays
  // on your device, a switch that claims to be writing files somewhere is the
  // single most consequential thing a person could be wrong about.
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
    //
    // Through `copyExport` rather than straight at `setString`, because the
    // clipboard drops an oversized payload WITHOUT telling anybody — Android's
    // module swallows the `TransactionTooLargeException` — and this used to
    // raise "Copied to the clipboard" either way. See `lib/clipboard-export.ts`
    // for the buffer, the measure and why refusing is the safe direction.
    //
    // WHAT IS COPIED IS A BACKUP, not the projections on their own. It used to
    // be `exportJSON()`, and that string is a file this app REFUSES: run it
    // through `core/backup.ts`'s `readBackup` — the same reader the Transfer
    // screen puts every arriving file through — and it comes back
    // `backup/not-a-backup`, "this is an older export that holds only the
    // readable summary, not the data needed to restore". So the phone's one
    // outbound route wrote something only the phone's own eyes could use, on
    // the screen whose Clear-every-record confirmation tells people to export
    // first. Driven end to end after the change: `readBackup` accepts this
    // envelope and `repo/restore.ts` puts the records back.
    //
    // Built in `lib/phone-backup.ts` rather than here, and the move is the
    // regression test: this is a component, D20 bans mounting one, so while the
    // envelope was assembled inside this `onPress` nothing in the repo could
    // ask `readBackup` whether it accepted the result — which for two releases
    // it did not. `phone-backup.test.ts` asserts that round trip now, and keeps
    // the old projections-only payload beside it as the case that must stay
    // refused.
    const backup = buildPhoneBackup({
      exportedAt: now(),
      nodes: graph.nodes(),
      edges: graph.edges(),
      // Parsed back out of `exportJSON()` rather than rebuilt: that function is
      // the one spelling of what the readable half contains, and a second
      // projection list in this file is exactly the drift that put a wrong
      // sentence about keywords under this button.
      readable: JSON.parse(exportJSON()) as unknown,
    })
    const said = copyExport(backup, (text) => Clipboard.setString(text), Platform.OS === 'android')
    toast(said)
    // The web's event, from the phone: counted only when the copy landed.
    if (said.tone !== 'danger') {
      void report('backup_used', { direction: 'export', records: bucket(graph.nodes().length) })
    }
  }

  /*
   * IMPORT — a backup file, or the phone's own export pasted back.
   *
   * The button was disabled with a sentence saying the picker was not wired,
   * and Export's clipboard backup had no way back in at all. Both now end at
   * the transfer receive's own question, "Replace everything on this phone?",
   * and at the same `applyPlan` — with `handover: false`, because a file the
   * person kept is not a device holding a copy.
   *
   * What is said to the person is decided in `lib/import-backup.ts`, where it
   * can be tested; these handlers only move bytes between the picker, the disk
   * and those functions.
   */
  const [importing, setImporting] = useState<RestorePlan | null>(null)
  const [restoring, setRestoring] = useState(false)

  const refuseImport = (description: string) =>
    toast({ title: t('settings.import.refused'), description, tone: 'danger' })

  const offerImport = (planned: ImportPlan) => {
    if (!planned.ok) {
      refuseImport(planned.message)
      return
    }
    setImporting(planned.plan)
  }

  const onImportFile = async () => {
    try {
      // All files as well: some Android file managers report a .json as
      // octet-stream, which would grey it out. The reader refuses what is not
      // a backup, with a sentence, so offering everything costs nothing.
      const [picked] = await pick({ type: [types.json, types.plainText, types.allFiles] })
      // A copy first, as `pickDocuments` does: on Android the picker hands back
      // a `content://` uri whose read grant belongs to the activity, and
      // `keepLocalCopy` is the module's own way to turn it into a path.
      const [copy] = await keepLocalCopy({
        files: [{ uri: picked.uri, fileName: picked.name ?? 'backup.json' }],
        destination: 'cachesDirectory',
      })
      if (copy.status !== 'success') {
        refuseImport(t('settings.import.fileFailed', { reason: copy.copyError }))
        return
      }
      const path = pathOfUri(copy.localUri)
      try {
        offerImport(planImportBase64(await ReactNativeBlobUtil.fs.readFile(path, 'base64')))
      } finally {
        // The plan holds what it needs; the cached copy of a whole backup does
        // not get to outlive the question.
        void ReactNativeBlobUtil.fs.unlink(path).catch(() => undefined)
      }
    } catch (error) {
      const reason = pickFailure(error)
      if (reason !== null) refuseImport(reason)
    }
  }

  const onPasteBackup = async () => {
    try {
      offerImport(planImport(await Clipboard.getString(), 'clipboard'))
    } catch (error) {
      refuseImport(
        t('settings.import.clipboardFailed', {
          reason: error instanceof Error ? error.message : String(error),
        }),
      )
    }
  }

  /*
   * Called from `ConfirmSheet`'s confirm button, which runs `onClose()` first —
   * so the plan comes in as an argument from the render that showed the sheet,
   * not from state `onClose` has just cleared. `onClose` only clears; it never
   * declines anything destructive (see `lib/receive-decision.ts` for the panel
   * where it did).
   */
  const applyImport = (plan: RestorePlan) => {
    setRestoring(true)
    applyPlan(repo, plan, now(), { handover: false })
      .then((done) => {
        toast(importOutcomeToast(done))
        // A transfer is counted once, by the computer; a backup brought in by
        // hand is this phone's own event.
        if (done.ok)
          void report('backup_used', { direction: 'restore', records: bucket(done.nodes) })
      })
      .catch((error: unknown) =>
        toast({
          title: t('settings.import.unfinished'),
          description: error instanceof Error ? error.message : String(error),
          tone: 'danger',
        }),
      )
      .finally(() => setRestoring(false))
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
        title: t('settings.data.cleared'),
        description: t('settings.data.clearedDescription'),
        tone: 'danger',
      })
      return
    }
    reset()
    void forgetDocuments(attached)
    toast({
      title: pending === 'reset' ? t('settings.data.resetDone') : t('settings.data.loaded'),
      description: t('settings.data.loadedDescription'),
    })
  }

  const pendingCopy: Record<PendingData, { title: string; description: string; confirm: string }> =
    {
      empty: {
        title: t('settings.confirm.empty.title'),
        description: t('settings.confirm.empty.description'),
        confirm: t('settings.confirm.empty.confirm'),
      },
      demo: {
        title: t('settings.confirm.demo.title'),
        description: t('settings.confirm.demo.description'),
        confirm: t('settings.confirm.demo.confirm'),
      },
      reset: {
        title: t('settings.confirm.reset.title'),
        description: t('settings.confirm.reset.description'),
        confirm: t('settings.confirm.reset.confirm'),
      },
    }

  return (
    <Screen
      title={t('settings.title')}
      subtitle={t('settings.subtitle')}
      wide
      focus={route.params?.focus}
      onArrived={() => navigation.setParams({ focus: undefined })}
    >
      {/* Setting groups. The confirm sheet stays outside — it is an overlay, not a panel. Side by side on a tablet. */}
      <Columns>
        <TourTarget id="device">
          <Panel focusId="settings.device">
            {/*
             * WHERE THE BYTES ARE, rather than three switches that did nothing.
             *
             * This panel held `autoSync`, `snapshots` and `watchFolder` — bare
             * `useState` with no reader anywhere. They flipped, looked live,
             * were never persisted and were wired to nothing, under a heading
             * promising records that "survive closing the app". Web deleted the
             * same three and names them in `DocumentsPanel` as the defect it was
             * written to remove; the phone kept them.
             *
             * A switch that does nothing is worse than an absent feature: it is
             * a promise the app has already broken by the time anybody notices.
             */}
            <PanelTitle hint={t('settings.device.hint')}>{t('settings.device.title')}</PanelTitle>
            <Txt size="sm" tone="secondary" style={{ marginBottom: space[3] }}>
              {t('settings.device.body')}
            </Txt>
            {/* Both ways out. The phone is still always the side that listens —
              a browser cannot accept an inbound connection — but since
              2026-11-15 the computer can connect and PULL the phone's backup,
              so Transfer sends from here as well as receiving. */}
            <Txt size="sm" tone="secondary">
              {t('settings.device.copyOut')}
            </Txt>
          </Panel>
        </TourTarget>

        <TourTarget id="model">
          <Panel focusId="settings.model">
            {/* Was "Local model", and that stopped being true the moment this
              panel could reach Claude. A heading that names one of the two
              answers is a heading that is wrong half the time. */}
            <PanelTitle
              right={
                <IconButton
                  icon="link"
                  label={t('settings.servers.title')}
                  onPress={() => setPicking(true)}
                  disabled={shown.length === 0}
                />
              }
            >
              {t('settings.model.title')}
            </PanelTitle>
            <Txt size="sm" tone="secondary" style={{ marginBottom: space[3] }}>
              {t('settings.model.intro')}
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
              focusId="settings.model.provider"
              label={t('settings.provider.title')}
              description={domain.provider(provider.id)}
              onPress={() => setChoosing(true)}
            />
            {provider.cloud ? <CloudTerms provider={provider} /> : null}
            <View style={{ gap: space[3] }}>
              {/* Not offered at all when the provider's address is fixed. An
                editable field over a value the request builder is going to
                ignore is a field that can only mislead. */}
              {provider.fixedEndpoint ? null : (
                <TextField
                  focusId="settings.model.endpoint"
                  label={t('settings.model.endpoint')}
                  mono
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  value={endpoint}
                  // A LAN address, not `localhost`. A placeholder is a
                  // suggestion, and this one is on a phone: `localhost` here is
                  // the phone, which is not running the model.
                  placeholder="http://192.168.1.20:8000/v1"
                  hint={
                    /*
                     * The loopback warning outranks the dialect note, because one
                     * is a detail about a URL that will work and the other is the
                     * reason a URL cannot.
                     *
                     * Ollama's default endpoint is `http://localhost:11434`, and
                     * it is right on a desktop browser and wrong here — the
                     * request goes to the phone, fails to connect, and reads
                     * exactly like a server that is switched off. Somebody who
                     * followed the setup copy has then done everything correctly
                     * and been told it does not work.
                     */
                    isLoopbackEndpoint(endpoint || provider.endpoint)
                      ? t('settings.model.loopback')
                      : provider.dialect === 'ollama'
                        ? t('settings.model.endpointOllama')
                        : t('settings.model.endpointHint')
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
                  focusId="settings.model.apiKey"
                  label={t('settings.model.apiKey')}
                  mono
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  textContentType="none"
                  value={settings.apiKey ?? ''}
                  placeholder="sk-…"
                  hint={t('settings.model.apiKeyHint')}
                  onChangeText={(next) => {
                    save({ ...settings, apiKey: cleanKey(next) })
                  }}
                />
              ) : null}
              {/* Empty and unusable until a server has answered. The model id is
                the server's to state, not the user's to guess, and a field
                offering to take a guess is a field inviting a 404 later. */}
              <TextField
                focusId="settings.model.id"
                label={t('settings.model.title')}
                mono
                autoCapitalize="none"
                autoCorrect={false}
                value={model}
                editable={connected}
                placeholder={connected ? '' : t('settings.model.modelPlaceholder')}
                hint={connected ? t('settings.model.modelHint') : undefined}
                onChangeText={setModel}
                onBlur={() => {
                  save({ ...settings, endpoint: endpoint.trim(), model: model.trim() })
                }}
              />
              {/* Only once there is something to name. Before that it would be a
                label for a connection that does not exist. */}
              {connected ? (
                <TextField
                  focusId="settings.model.savedAs"
                  label={t('settings.model.savedAs')}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={name}
                  placeholder={model}
                  hint={t('settings.model.savedAsHint')}
                  onChangeText={setNameEdit}
                  onBlur={onRename}
                />
              ) : null}
              {/*
               * The window, which had no control at all until now.
               *
               * `contextOf` has always read `settings.contextWindow` and fallen
               * back to the provider's default, and nothing in either app could
               * write it — so every Ollama user planned against 4,096 tokens
               * whatever their `num_ctx` actually was, and the agent compacted
               * history it had room for. The default is a floor Ollama ships,
               * not a measurement of anybody's deployment.
               *
               * Empty means "use the default", which is a real choice: for Ollama
               * it also stops jojo sending `num_ctx` at all, letting the server
               * size itself against its own VRAM rather than failing to load at a
               * number the user guessed.
               */}
              <TextField
                focusId="settings.model.context"
                label={t('settings.model.context')}
                mono
                keyboardType="number-pad"
                autoCorrect={false}
                value={windowEdit}
                placeholder={String(provider.defaultContext)}
                hint={
                  provider.dialect === 'ollama'
                    ? t('settings.model.contextOllama', {
                        tokens: provider.defaultContext.toLocaleString(i18n.language),
                      })
                    : t('settings.model.contextHint', {
                        tokens: provider.defaultContext.toLocaleString(i18n.language),
                      })
                }
                onChangeText={(next) => {
                  setWindowEdit(next.replace(/[^0-9]/g, ''))
                }}
                onBlur={() => {
                  const keep = parseContextWindow(windowEdit)
                  setWindowEdit(keep === undefined ? '' : String(keep))
                  const { contextWindow: _dropped, ...rest } = settings
                  save({ ...rest, ...(keep === undefined ? {} : { contextWindow: keep }) })
                }}
              />
              {/* Reasoning, as on the web form — and only where a mode puts
                something on the wire. See `REASONING`. */}
              {sendsThinking(provider.id, 'on') ? (
                <>
                  <SettingRow
                    focusId="settings.model.reasoning"
                    label={t('settings.model.reasoning')}
                    description={t('settings.model.reasoningDescription')}
                    control={null}
                  />
                  <Segment
                    label={t('settings.model.reasoning')}
                    options={reasoning}
                    value={
                      settings.thinking === undefined || settings.thinking === 'server-default'
                        ? DEFAULT_THINKING
                        : settings.thinking
                    }
                    onChange={(next) => {
                      save({ ...settings, thinking: next })
                    }}
                  />
                </>
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
            <FocusTarget id="settings.model.test" style={styles.testRow}>
              <Button
                label={
                  testing
                    ? t('settings.test.testing')
                    : connected
                      ? t('settings.test.again')
                      : t('settings.test.test')
                }
                variant="outline"
                disabled={testing || endpoint.trim().length === 0}
                blocker={
                  endpoint.trim().length === 0 ? t('settings.model.endpointFirst') : undefined
                }
                onPress={onTest}
              />
              {connected ? (
                <Chip tone="green">{t('settings.test.connected')}</Chip>
              ) : failure ? (
                <Chip tone="red">{t('settings.test.noAnswer')}</Chip>
              ) : (
                <Chip tone="gray">{t('settings.test.notConnected')}</Chip>
              )}
            </FocusTarget>
            {/* The server's own words, not a paraphrase. A wrong port and a path
              missing its /v1 fail differently, and only the endpoint knows
              which happened. */}
            {failure ? (
              <Txt size="xs" tone="danger" style={{ marginTop: space[2] }}>
                {failure}
              </Txt>
            ) : connected ? (
              <Txt size="xs" tone="muted" style={{ marginTop: space[2] }}>
                {t('settings.model.kept')}
              </Txt>
            ) : null}
          </Panel>
        </TourTarget>

        <TourTarget id="reader">
          <Panel focusId="settings.reader">
            <PanelTitle hint={t('settings.reader.hint')}>{t('settings.reader.title')}</PanelTitle>
            {/* The honest split, because the old copy asked for a server before
              anything could be read and that is no longer true. Saying what
              already works is what stops somebody setting up a reader they do
              not need — and naming PDF plainly is what stops the opposite. */}
            <Txt size="sm" tone="secondary" style={{ marginBottom: space[3] }}>
              {t('settings.reader.already')}
            </Txt>
            <Txt size="sm" tone="secondary" style={{ marginBottom: space[3] }}>
              <Trans
                t={t}
                i18nKey="settings.reader.pdf"
                values={{ name: MARKITDOWN.name }}
                components={{ strong: <Txt size="sm" tone="primary" /> }}
              />
            </Txt>
            <TextField
              focusId="settings.reader.address"
              label={t('settings.reader.address')}
              mono
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              value={readerAt}
              placeholder={MARKITDOWN.defaultEndpoint}
              hint={t('settings.reader.addressHint')}
              onChangeText={(next) => {
                setReaderAt(next)
                setReaderOk(false)
                setReaderFailure(null)
              }}
            />
            <View style={{ marginTop: space[3], gap: space[1] }}>
              <Txt size="xs" tone="muted">
                {t('settings.reader.notRunning')}
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
                label={
                  readerTesting
                    ? t('settings.test.testing')
                    : readerOk
                      ? t('settings.test.again')
                      : t('settings.test.test')
                }
                variant="outline"
                disabled={readerTesting || readerAt.trim().length === 0}
                blocker={
                  readerAt.trim().length === 0 ? t('settings.reader.addressFirst') : undefined
                }
                onPress={onTestReader}
              />
              {readerOk ? (
                <Chip tone="green">{t('settings.test.connected')}</Chip>
              ) : readerFailure ? (
                <Chip tone="red">{t('settings.test.noAnswer')}</Chip>
              ) : (
                <Chip tone="gray">{t('settings.test.notConnected')}</Chip>
              )}
            </View>
            {readerFailure ? (
              <Txt size="xs" tone="danger" style={{ marginTop: space[2] }}>
                {readerFailure}
              </Txt>
            ) : readerOk ? (
              <Txt size="xs" tone="muted" style={{ marginTop: space[2] }}>
                {t('settings.reader.ok')}
              </Txt>
            ) : null}
            {/* The notice the licence asks for, where the choice is made. */}
            <Divider style={{ marginVertical: space[3] }} />
            <Txt size="xs" tone="muted">
              {t('settings.reader.notice', {
                name: MARKITDOWN.name,
                copyright: MARKITDOWN.copyright,
                licence: MARKITDOWN.licence,
              })}
            </Txt>
          </Panel>
        </TourTarget>

        <Panel focusId="settings.appearance">
          <PanelTitle>{t('settings.appearance.title')}</PanelTitle>
          <SettingRow
            focusId="settings.appearance.theme"
            label={t('settings.appearance.theme')}
            description={t('settings.appearance.themeDescription')}
            control={null}
          />
          <Segment
            label={t('settings.appearance.theme')}
            options={themes}
            value={pref}
            onChange={setPref}
          />
          <LanguageRow />
        </Panel>

        <Panel focusId="settings.data">
          <PanelTitle>{t('settings.data.title')}</PanelTitle>
          <FocusTarget id="settings.data.backup" style={styles.dataRow}>
            <Button
              label={t('settings.data.export')}
              icon="upload"
              variant="outline"
              onPress={onExport}
            />
            {/* Was disabled behind three successive blockers; the last said the
                picker was not wired, and it is now. A .json or .txt backup from
                wherever the person keeps it, or Export's own clipboard backup
                pasted back — both through the same plan, question and restore
                as a transfer. Disabled only while a restore is writing. */}
            <Button
              label={t('settings.data.import')}
              icon="download"
              variant="outline"
              disabled={restoring}
              onPress={() => void onImportFile()}
            />
            <Button
              label={t('settings.data.paste')}
              icon="clipboard"
              variant="outline"
              disabled={restoring}
              onPress={() => void onPasteBackup()}
            />
          </FocusTarget>
          {/* This paragraph said keywords "live in their own store and are not in
              it yet". They have not lived in their own store since D14 — a
              keyword is a node and tagging is a TAGS edge — and `exportJSON` in
              `@jojo/service/react/use-admin` has carried both `keywords` and
              `keywordsByRecord` ever since. The sentence told people their
              backup was lossier than it is, on the screen whose whole job is
              saying what is in the file, and it is the same claim the service
              layer's own comment records as having stopped being true. */}
          {/* And the second sentence now says what the file is FOR. It used to
              end "It is the whole store", which was true of what a person could
              read in it and false of what the app could do with it: the reader
              on the Transfer screen refused this export as "not a backup". The
              copy is worth as much as the format here — somebody clearing every
              record is told to export first, and they are entitled to know that
              the attached documents themselves stay on the phone. */}
          <Txt size="xs" tone="muted" style={{ marginTop: space[2] }}>
            {t('settings.data.exportNote')}
          </Txt>

          <View style={{ marginTop: space[3] }}>
            <SettingRow
              focusId="settings.data.records"
              label={t('settings.data.records')}
              description={
                isEmpty ? t('settings.data.recordsEmpty') : t('settings.data.recordsDemo')
              }
              control={null}
            />
            <Segment
              label={t('settings.data.records')}
              options={dataSets}
              value={dataSet}
              // The segment reflects the store rather than a local flag, so it
              // does not flip until the confirmation behind it has been taken.
              onChange={(next) => setPending(next === 'empty' ? 'empty' : 'demo')}
            />

            <Divider style={{ marginVertical: space[3] }} />

            <SettingRow
              focusId="settings.data.move"
              label={t('settings.data.move')}
              description={t('settings.data.moveDescription')}
              onPress={() => navigation.navigate('Transfer')}
            />
            <SettingRow
              focusId="settings.data.reset"
              label={t('settings.data.reset')}
              description={t('settings.data.resetDescription')}
              control={
                <Button
                  label={t('settings.data.resetButton')}
                  icon="rotate-ccw"
                  variant="outline"
                  blocker={isEmpty ? t('settings.data.resetBlocker') : undefined}
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
              {t('settings.data.warning')}
            </Txt>
          </View>
        </Panel>

        <KeywordManager />

        {/* Below the data panel on purpose: it is the same subject — what jojo
            keeps and what leaves the phone — and the panel above now has to be
            read alongside it rather than instead of it. */}
        <CrashPanel />

        <AuditLog />
      </Columns>

      <ConfirmSheet
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending ? pendingCopy[pending].title : t('settings.confirm.fallbackTitle')}
        description={pending ? pendingCopy[pending].description : ''}
        confirmLabel={pending ? pendingCopy[pending].confirm : t('settings.confirm.continue')}
        tone="danger"
        onConfirm={applyPending}
      />

      {/* The transfer receive's own gate, word for word: what is arriving and
          what it replaces. */}
      <ConfirmSheet
        open={importing !== null}
        onClose={() => setImporting(null)}
        title={t('settings.import.replaceTitle')}
        description={
          importing === null
            ? ''
            : t('settings.import.replaceDescription', {
                described: domain.backup(importing),
                replaces: domain.replaces(importing, 'phone'),
              })
        }
        confirmLabel={t('settings.import.replace')}
        tone="danger"
        onConfirm={() => {
          if (importing !== null) applyImport(importing)
        }}
      />

      <ProviderPicker
        open={choosing}
        current={settings.provider}
        onClose={() => setChoosing(false)}
        onPick={onProvider}
      />

      <SavedServers
        open={picking}
        servers={shown}
        current={{ endpoint: normaliseEndpoint(endpoint), model }}
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
  const { t } = useTranslation('screens')
  const domain = useDomain()
  return (
    <MenuSheet
      open={open}
      onClose={onClose}
      title={t('settings.provider.title')}
      description={t('settings.provider.description')}
      actions={PROVIDERS.map((p) => ({
        id: p.id,
        label: domain.provider(p.id),
        hint: p.cloud
          ? t('settings.provider.cloud')
          : p.needsKey
            ? t('settings.provider.localKey')
            : t('settings.provider.local'),
        checked: p.id === current,
        onPress: () => {
          onPick(p.id)
        },
      }))}
    />
  )
}

/**
 * What choosing this provider actually commits you to. The phone's copy of the
 * web panel's `CloudTerms`, and deliberately the same words.
 *
 * The warning this replaces said "and is billed to your account" for every cloud
 * provider, which is FALSE of NVIDIA's free tier — telling somebody they are
 * being charged for something free, on the screen where they decide whether to
 * use it, is not a small inaccuracy. The web app had already split that into two
 * facts; the phone had not, so it kept saying it.
 *
 * NVIDIA gets different words rather than louder ones: its free tier is licensed
 * for evaluation and NOT production, and forbids uploading personal data — which
 * is most of what the assistant sends. Every other provider here sells
 * production use, which is what the bill buys.
 */
function CloudTerms({ provider }: { provider: ProviderMeta }) {
  const { t } = useTranslation('screens')
  const { colors: c } = useTheme()
  const terms = cloudTerms(provider)
  const name = provider.label.split(' \u2014')[0]
  // Without the parenthetical, for the possessive and the links.
  const short = name.replace(/\s*\([^)]*\)\s*$/, '')

  const open = (url: string) => {
    void Linking.openURL(url).catch(() => {
      /* No browser, or the user cancelled. Nothing here is recoverable and
         nothing is lost — the text above says the same thing. */
    })
  }

  return (
    <View
      style={{
        marginBottom: space[3],
        padding: space[3],
        borderRadius: 10,
        borderWidth: 1,
        borderColor: c.warningBorder,
        backgroundColor: c.warningSoft,
        gap: space[2],
      }}
    >
      <Txt size="xs" weight="semibold" tone="warning">
        {terms.headline}
      </Txt>

      {/* Rendered from `@jojo/service/core/cloud-terms`, not written here. This
          file used to hold the prose and a comment saying it was deliberately
          the same words as web's; it was three sentences short, including the
          one about NVIDIA's licence to store and reproduce what is sent. */}
      {terms.paragraphs.map((paragraph, i) => (
        <Txt key={i} size="xs" tone="secondary">
          {paragraph.map((segment, j) => (
            <Txt key={j} size="xs" tone={segment.emphasis === true ? 'primary' : 'secondary'}>
              {segment.text}
            </Txt>
          ))}
        </Txt>
      ))}

      <Txt size="xs" tone="muted">
        {terms.liability.map((segment, j) => (
          <Txt key={j} size="xs" tone={segment.emphasis === true ? 'secondary' : 'muted'}>
            {segment.text}
          </Txt>
        ))}
      </Txt>

      <View style={[s.row, { gap: space[4] }]}>
        <Txt size="xs" tone="info" onPress={() => open(provider.termsUrl)}>
          {t('settings.cloud.terms', { name: short })}
        </Txt>
        <Txt size="xs" tone="info" onPress={() => open(provider.privacyUrl)}>
          {t('settings.cloud.privacy')}
        </Txt>
      </View>
    </View>
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
  /*
   * The address AND the model: a hosted provider has several saved rows sharing
   * one endpoint, so comparing addresses alone marked every NVIDIA model "In
   * use" at once. Same fix as the web panel.
   */
  current: { endpoint: string; model: string }
  onClose: () => void
  onLoad: (server: ModelServer) => void
  onForget: (id: string) => void
}) {
  const { t } = useTranslation('screens')
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('settings.servers.title')}
      description={t('settings.servers.description')}
      footer={<Button label={t('settings.servers.done')} onPress={onClose} />}
    >
      <View>
        {servers.length === 0 ? (
          <Txt size="sm" tone="muted">
            {t('settings.servers.empty')}
          </Txt>
        ) : (
          servers.map((server, i) => (
            <View key={server.id}>
              {i > 0 ? <Divider /> : null}
              <View style={[s.row, { paddingVertical: space[2] }]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.servers.load', { name: server.name })}
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
                    {server.endpoint === current.endpoint && server.model === current.model ? (
                      <Chip tone="green">{t('settings.servers.inUse')}</Chip>
                    ) : null}
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
                  label={t('settings.servers.forget', { name: server.name })}
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

/*
 * The names come from the model now, not from here.
 *
 * This file said `teal: 'Teal'` and the web app said `teal: 'Blue'` — the same
 * stored colour with a different name on each screen, which is the kind of
 * disagreement nobody notices until they are looking at both. `TONE_LABEL` in
 * `core/model.ts` is beside the union it names, so the palette is described
 * once and spoken the same way in both apps — through `domain.tone`, in the
 * language on screen.
 */

/**
 * The keyword list itself — rename, recolour, delete.
 *
 * Keywords are the user's own system and are shared by applications, reminders
 * and everything in the Vault, so they are managed once here rather than per
 * screen. Deleting one takes it off every record; `restore` puts all of that
 * back, which is why this is an undo rather than a confirmation.
 */
function KeywordManager() {
  const { t } = useTranslation('screens')
  const domain = useDomain()
  const c = useColors()
  const { labels, addLabel, renameLabel, removeLabel, setTone, countFor } = useLabels()
  const { toast } = useToast()
  const [editing, setEditing] = useState<(typeof labels)[number] | null>(null)
  const [draftName, setDraftName] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  /*
   * Asked BEFORE, with the count, rather than reported after with an undo.
   *
   * Deleting a keyword takes it off every record it was on, and the count was
   * only shown afterwards in a toast that scrolls away. Web has asked first,
   * with the number, since it was written — and this is a heavier action than
   * the ones on this screen that already confirm.
   */
  const [deleting, setDeleting] = useState<{ id: string; name: string; used: number } | null>(null)

  const onDelete = (id: string, name: string) => {
    setDeleting({ id, name, used: countFor(id) })
  }

  const confirmDelete = () => {
    const target = deleting
    if (target === null) return
    setDeleting(null)
    const { restore } = removeLabel(target.id)
    toast({
      title: t('rowActions.deletedTitle', { name: target.name }),
      description:
        target.used > 0 ? t('settings.keywords.takenOff', { count: target.used }) : undefined,
      tone: 'danger',
      action: { label: t('shared.undo'), onPress: restore },
    })
  }

  return (
    <Panel focusId="settings.keywords">
      <PanelTitle
        hint={t('settings.keywords.hint')}
        right={
          <Button
            label={t('applications.new')}
            icon="plus"
            variant="outline"
            onPress={() => setAdding(true)}
          />
        }
      >
        {t('settings.keywords.title')}
      </PanelTitle>

      {labels.map((l, i) => (
        <View key={l.id}>
          {i > 0 ? <Divider /> : null}
          <View style={styles.keywordRow}>
            <Chip tone={l.tone} ink={l.ink} shape="capsule">
              {l.name}
            </Chip>
            <Txt size="xs" tone="muted" style={{ flex: 1 }}>
              {t('settings.keywords.usedOn', { count: countFor(l.id) })}
            </Txt>
            <IconButton
              icon="edit-2"
              label={t('settings.keywords.rename', { name: l.name })}
              onPress={() => {
                setDraftName(l.name)
                setEditing(l)
              }}
            />
            <IconButton
              icon="trash-2"
              tone="danger"
              label={t('jobScout.pipelines.delete', { name: l.name })}
              onPress={() => onDelete(l.id, l.name)}
            />
          </View>
        </View>
      ))}

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={
          editing
            ? t('settings.keywords.editTitle', { name: editing.name })
            : t('settings.keywords.editGeneric')
        }
        description={t('settings.keywords.editDescription')}
        footer={
          <>
            <Button
              label={t('shared.cancel')}
              variant="ghost"
              size="md"
              onPress={() => setEditing(null)}
            />
            <Button
              label={t('profile.save')}
              size="md"
              onPress={() => {
                if (!editing) return
                // Refused rather than merged when the name is taken: two chips
                // reading the same word are indistinguishable, and merging would
                // quietly rewrite every record carrying either one.
                const ok = renameLabel(editing.id, draftName)
                if (!ok) {
                  toast({
                    title: t('settings.keywords.taken'),
                    description: t('settings.keywords.takenDescription'),
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
          <TextField
            focusId={null}
            label={t('jobScout.editor.name')}
            value={draftName}
            onChangeText={setDraftName}
          />
          <View>
            <Txt size="xs" tone="secondary" style={{ marginBottom: space[2] }}>
              {t('settings.keywords.colour')}
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
                  /*
                   * `checked` as well as `selected` — the same fix `ui/Segment`
                   * carries, and for the same reason. Android reads a radio's
                   * state from `accessibilityState.checked`, so with only
                   * `selected` TalkBack announces every tone, the chosen one
                   * included, as "not checked". iOS uses `selected`, so both go.
                   */
                  accessibilityState={{
                    selected: editing?.tone === tone,
                    checked: editing?.tone === tone,
                  }}
                  accessibilityLabel={domain.tone(tone)}
                  onPress={() => editing && setTone(editing.id, tone)}
                  style={[
                    styles.toneOption,
                    {
                      borderColor: editing?.tone === tone ? c.accent : c.hairline,
                    },
                  ]}
                >
                  <Chip tone={tone} shape="capsule" size="sm">
                    {domain.tone(tone)}
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
        title={t('settings.keywords.newTitle')}
        description={t('settings.keywords.newDescription')}
        footer={
          <>
            <Button
              label={t('shared.cancel')}
              variant="ghost"
              size="md"
              onPress={() => setAdding(false)}
            />
            <Button
              label={t('profile.add')}
              size="md"
              onPress={() => {
                const name = newName.trim()
                if (!name) return
                addLabel(name)
                setNewName('')
                setAdding(false)
                toast({ title: t('settings.keywords.added', { name }) })
              }}
            />
          </>
        }
      >
        <View style={{ paddingBottom: space[2] }}>
          <TextField
            focusId={null}
            label={t('jobScout.editor.name')}
            value={newName}
            autoFocus
            placeholder={t('settings.keywords.placeholder')}
            onChangeText={setNewName}
          />
        </View>
      </Sheet>

      {/* Named, and counted. "Delete Rust?" is a different question from
          "Delete Rust — it is on 14 records?", and only the second one can be
          answered. */}
      <ConfirmSheet
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={deleting === null ? '' : t('rowActions.confirmTitle', { name: deleting.name })}
        description={
          deleting === null
            ? ''
            : deleting.used > 0
              ? t('settings.keywords.confirmUsed', { count: deleting.used })
              : t('settings.keywords.confirmUnused')
        }
        confirmLabel={t('shared.delete')}
        tone="danger"
        onConfirm={confirmDelete}
      />
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
