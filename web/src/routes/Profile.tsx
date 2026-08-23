import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Link } from 'react-router'
import { Download, FileText, Plus, Upload, X } from 'lucide-react'
import { Chip } from '@/components/common/Chip'
import { EmptyState } from '@/components/common/EmptyState'
import { Field, SettingRow } from '@/components/common/Field'
import { PageHeader, PageOption } from '@/components/common/PageHeader'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import type { ProfileText } from '@/data/profile'
import { displayName } from '@/data/seed'
import { agoLabel } from '@/data/timeline'
import { useApplications } from '@jojo/service/react/use-applications'
import { useProfile } from '@jojo/service/react/use-profile'
import { useVault } from '@jojo/service/react/use-vault'
import { kindOfFile, sizeLabel } from '@/lib/files'
import { useTitle, vaultPath } from '@/lib/links'
import { useToast } from '@/lib/toast-context'
import { useVaultBlobs } from '@/lib/vault-blobs'
import { TODAY } from '@/lib/today'
import { useUndoable } from '@/lib/undo'

/** The bucket a profile document belongs to, in the Vault's own vocabulary. */
const DOCUMENTS_BUCKET = 'Applications' as const

export function Profile() {
  useTitle('Profile')
  // Page option: the profile drives scoring, so seeing that spelled out helps
  // the first time and is noise thereafter.
  const [showScoringHelp, setShowScoringHelp] = useState(true)

  /**
   * The saved record lives in the store; only the typing is route state.
   *
   * The audit found the whole page held in `useState`, which meant Save wrote
   * to something react-router threw away on the next click — the field reverted
   * while the toast said it had been kept for the visit. `saved` is now the
   * store's copy, and the draft below is the only thing that dies with the
   * route, which is what an unsaved edit is supposed to do.
   *
   * The difference between the two is the whole feature: it is what makes the
   * save bar appear, what Discard restores, and what stops Save writing a
   * record identical to the one already there.
   */
  const { profile, update } = useProfile()
  const saved = profile.text
  const [draft, setDraft] = useState(saved)
  const dirty = (Object.keys(saved) as (keyof ProfileText)[]).some((k) => draft[k] !== saved[k])

  /**
   * Chips and switches commit on click, and are deliberately outside the save
   * bar's model. It is the same rule the keyword picker follows everywhere else
   * in the app: a control whose whole affordance is the change it makes has
   * already told the user it took effect, and asking them to confirm it again
   * from a bar at the foot of the page reads as the click not having landed.
   */
  const { matchTerms, includeAcademia, includeIndustry } = profile
  const [addingTerm, setAddingTerm] = useState(false)
  const [termDraft, setTermDraft] = useState('')

  const { files, addFile } = useVault()
  const blobs = useVaultBlobs()
  const { get } = useApplications()
  const { toast } = useToast()
  const undoable = useUndoable()
  const fileInput = useRef<HTMLInputElement>(null)

  /**
   * A view over the Vault, never a second list.
   *
   * The audit found this panel keeping its own array of documents while the
   * Vault kept another: a CV uploaded in one place left the other stale, and
   * the "used by 12 applications" counts beside them were decoration, since
   * nothing ever counted anything. One collection, filtered to the bucket that
   * means "what I send with an application".
   */
  const documents = files.filter((f) => f.bucket === DOCUMENTS_BUCKET)

  const set = (key: keyof ProfileText) => (event: ChangeEvent<HTMLInputElement>) =>
    setDraft((prev) => ({ ...prev, [key]: event.target.value }))

  /**
   * The one write on the page that had no Undo.
   *
   * It is the write that most needs one: ten fields go in behind a single
   * button, and the page's own `draft` is not reset by the save — so an Undo
   * puts the stored record back while leaving what was typed on screen, which
   * is a save bar the user can simply press again. Pressing Save with nothing
   * changed commits nothing, and `restore` is `null` there rather than a button
   * that would do nothing.
   */
  const onSave = () => {
    const { restore } = undoable(() => update({ text: draft }))
    toast({
      title: 'Profile saved',
      // Was "kept for this visit — the profile is not written to disk yet",
      // which stopped being true when the store went to IndexedDB. A save toast
      // that undersells the save is the one kind of false modesty that costs
      // something: it is the sentence that sends someone off to retype it
      // somewhere they trust more.
      description: 'Written to this browser and kept.',
      action: restore ? { label: 'Undo', onClick: restore } : undefined,
    })
  }

  const onPicked = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? [])
    // Cleared straight away, so re-picking the same file fires `change` again.
    // Without it, correcting a mistake by choosing the same document twice
    // looks like the second attempt did nothing.
    event.target.value = ''
    if (picked.length === 0) return

    let stored = 0
    for (const file of picked) {
      const record = addFile({
        name: file.name,
        kind: kindOfFile(file.name, file.type),
        bucket: DOCUMENTS_BUCKET,
        size: sizeLabel(file.size),
      })
      // The document itself, not just the three facts about it.
      //
      // This used to file the name, size and kind and drop the bytes on the
      // floor — correct when nothing in jojo stored a document, and a silent
      // inconsistency once the Vault did: the same CV kept its contents when
      // dropped on the Vault and lost them when uploaded here, which is the
      // screen a person is most likely to upload a CV from.
      if (await blobs.put(record.id, file)) stored += 1
    }

    toast(
      stored === picked.length
        ? {
            title: picked.length === 1 ? 'Document added' : `${picked.length} documents added`,
            description: `Filed in the Vault under ${DOCUMENTS_BUCKET} and saved in this browser. Nothing was uploaded anywhere.`,
          }
        : {
            title: `${picked.length - stored} could not be saved`,
            description:
              'The rows are filed, but this browser refused to store the documents — usually because its storage is full. Free some space and upload them again.',
            tone: 'danger',
          },
    )
  }

  const addTerm = () => {
    const term = termDraft.trim()
    if (term && !matchTerms.includes(term)) update({ matchTerms: [...matchTerms, term] })
    setTermDraft('')
    setAddingTerm(false)
  }

  return (
    <>
      <PageHeader
        title="My profile"
        subtitle={
          showScoringHelp
            ? 'What the scout and assistant use to match and draft. None of it leaves your device.'
            : 'Basics, documents and match terms'
        }
        settings={
          <PageOption
            label="Explain what this feeds"
            hint="The longer subtitle about scoring and privacy"
            control={
              <Switch
                checked={showScoringHelp}
                onCheckedChange={setShowScoringHelp}
                aria-label="Explain what this feeds"
              />
            }
          />
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
        <Panel>
          <PanelTitle>Basics</PanelTitle>
          {/* Every field carries a placeholder, which only matters on an empty
              store: with the records cleared this page used to render a
              stranger's name and email as real values, in inputs a reader would
              reasonably take for their own answers. Grey examples ask a
              question; black text answers one. */}
          <div className="space-y-3">
            <Field
              label="Full name"
              value={draft.fullName}
              autoComplete="name"
              placeholder="e.g. Alex Rahman"
              onChange={set('fullName')}
            />
            <Field
              label="Current position"
              value={draft.position}
              placeholder="e.g. PhD candidate, Computer Science"
              onChange={set('position')}
            />
            <Field
              label="Location"
              value={draft.location}
              placeholder="e.g. Lubbock, TX (open to relocate)"
              onChange={set('location')}
            />
            <Field
              label="Email"
              type="email"
              value={draft.email}
              autoComplete="email"
              mono
              placeholder="you@university.edu"
              onChange={set('email')}
            />
          </div>
        </Panel>

        <Panel>
          <PanelTitle>Links</PanelTitle>
          <div className="space-y-3">
            <Field
              label="Website"
              type="url"
              value={draft.website}
              mono
              placeholder="https://your-site.dev"
              onChange={set('website')}
            />
            <Field
              label="Google Scholar"
              type="url"
              value={draft.scholar}
              mono
              placeholder="https://scholar.google.com/citations?user=…"
              onChange={set('scholar')}
            />
            <Field
              label="GitHub"
              type="url"
              value={draft.github}
              mono
              placeholder="https://github.com/you"
              onChange={set('github')}
            />
            <Field
              label="LinkedIn"
              type="url"
              value={draft.linkedin}
              mono
              placeholder="https://linkedin.com/in/you"
              onChange={set('linkedin')}
            />
          </div>
        </Panel>
      </div>

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
                    onClick={() => update({ matchTerms: matchTerms.filter((x) => x !== term) })}
                    aria-label={`Remove ${term}`}
                    className="ml-0.5 rounded-sm p-0.5 hover:bg-accent-border/40"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </Chip>
              </li>
            ))}
            <li>
              {addingTerm ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    addTerm()
                  }}
                >
                  <Input
                    autoFocus
                    value={termDraft}
                    aria-label="New match term"
                    placeholder="Add a match term"
                    className="h-7 w-44 text-xs"
                    onChange={(event) => setTermDraft(event.target.value)}
                    // Enter fires submit first, so blur only ever abandons a
                    // term nobody finished typing.
                    onBlur={() => setAddingTerm(false)}
                  />
                </form>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setAddingTerm(true)}>
                  <Plus className="size-3" strokeWidth={2} aria-hidden />
                  Add
                </Button>
              )}
            </li>
          </ul>
        </div>

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

      <Panel>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <PanelTitle className="mb-0" hint={`the Vault's ${DOCUMENTS_BUCKET} bucket`}>
            Documents
          </PanelTitle>
          <div className="flex gap-2">
            {/* The button is the affordance; the input is only the mechanism, so
                it is hidden rather than styled. `hidden` and not `sr-only`:
                there is nothing here for a screen reader to operate that the
                button beside it does not already do. */}
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.odt,.rtf,.ppt,.pptx,.key,.txt,.md"
              className="hidden"
              onChange={(e) => void onPicked(e)}
            />
            <Button variant="ghost" size="sm" onClick={() => fileInput.current?.click()}>
              <Upload className="size-3.5" strokeWidth={1.8} aria-hidden />
              Upload
            </Button>
            {/* Not a disabled "Export all": nothing on this page holds a
                document's contents, so the only honest export is the record
                export, and it lives one click away. */}
            <Button variant="ghost" size="sm" asChild>
              <Link to="/settings">
                <Download className="size-3.5" strokeWidth={1.8} aria-hidden />
                Export in Settings
              </Link>
            </Button>
          </div>
        </div>

        {documents.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No documents yet"
            description={`Add your CV and statements — they are filed in the Vault under ${DOCUMENTS_BUCKET}, where the rest of the app can reach them.`}
            action={
              <Button size="sm" onClick={() => fileInput.current?.click()}>
                <Upload className="size-3.5" strokeWidth={1.8} aria-hidden />
                Upload a document
              </Button>
            }
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {documents.map((f) => {
              // The edge is cleared, not followed, when an application is
              // deleted — so a file can name an id whose record has gone.
              const application = f.applicationId ? get(f.applicationId) : undefined
              return (
                <li key={f.id} className="rounded-lg border border-hairline bg-well p-3">
                  <div className="flex items-center gap-2">
                    <FileText
                      className="size-4 shrink-0 text-accent"
                      strokeWidth={1.7}
                      aria-hidden
                    />
                    <span className="truncate font-mono text-sm">{f.name}</span>
                  </div>
                  <p className="tabular mt-1.5 text-xs text-text-3">
                    {f.size} · saved {agoLabel(f.savedOn, TODAY)}
                  </p>
                  {f.note ? (
                    <p className="mt-1 line-clamp-2 text-xs text-text-3">{f.note}</p>
                  ) : null}
                  {application ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Chip tone="teal" size="sm">
                        {displayName(application)}
                      </Chip>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}

        <p className="mt-4 text-xs text-text-3">
          The same files as the Vault's{' '}
          <Link
            to={vaultPath({ tool: 'files' })}
            className="text-text-2 underline underline-offset-2 hover:text-text-1"
          >
            Files tool
          </Link>
          , filtered to {DOCUMENTS_BUCKET}. Upload keeps a document's name, size and type — never
          its contents.
        </p>
      </Panel>

      {/**
       * Sticky at the foot rather than pinned under the header: the fields it
       * governs run the length of the page, and a bar that scrolls away is a
       * bar nobody presses. Mounted always, empty while clean, so the live
       * region exists before the message lands in it — a region that appears
       * with its own content already inside is not announced.
       */}
      <div aria-live="polite" className="sticky bottom-3 z-10 sm:bottom-5">
        {dirty ? (
          <div className="surface flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3">
            {/* Was "saving keeps them for this visit, not to disk". The bar
                exists to make someone press Save; describing the save as
                worthless was an argument against it. */}
            <p className="text-sm text-text-2">
              Unsaved changes — saving writes them to this browser.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setDraft(saved)}>
                Discard
              </Button>
              <Button size="sm" onClick={onSave}>
                Save
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
}
