import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Feather } from '@react-native-vector-icons/feather/static'
import { Button, IconButton } from '@/components/ui/Button'
import { MenuSheet } from '@/components/ui/Menu'
import type { MenuAction } from '@/components/ui/Menu'
import { Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { SnippetPreviewSheet } from '@/components/vault/SnippetPreviewSheet'
import type { TailorCandidate } from '@jojo/service/core/tailoring'
import { supersededToast } from '@jojo/service/react/undo'
import { useTailoring } from '@/lib/tailor-agent'
import type { TailoredSnippet } from '@/lib/tailor-agent'
import { useToast } from '@/lib/toast-context'
import type { RootStackParamList } from '@/navigation/types'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/**
 * The person's own documents, rewritten for this posting.
 *
 * The phone's half of web's `detail/TailoredPanel.tsx`: the same chooser, the
 * same progress line, the same list, drawn with sheets where the web has
 * popovers. Everything that decides — which documents are on offer, what a
 * tailored snippet is, the run — is `@jojo/service/react/use-tailoring` and
 * `use-tailor`, shared with the web.
 *
 * The phone cannot stream, so there is no word count moving under the progress
 * line; the step names what is happening and Cancel is always within reach,
 * because a document on the local box is minutes rather than seconds.
 *
 * Each tailored document is a CARD carrying what it is — which document, which
 * model, when — and none of what it says. Preview opens the words in a sheet
 * over the record; see web's twin for why a page of prose does not belong in a
 * panel between the dates and the notes.
 */

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function TailoredPanel({ applicationId }: { applicationId: string }) {
  const c = useColors()
  const t = useTailoring(applicationId)
  const { toast } = useToast()
  const [choosing, setChoosing] = useState(false)
  // By id, not by value: the snippet is read off the graph on every render.
  const [previewing, setPreviewing] = useState<string | null>(null)
  const preview = t.tailored.find((x) => x.id === previewing) ?? null

  /*
   * Queued, not awaited. The work belongs to the registry above the navigator —
   * see `kg/react/jobs.ts` — so this returns at once and the card becomes a
   * view of a job that outlives it. The toast when it finishes is raised by the
   * provider, wherever the person has got to by then.
   */
  const begin = (candidate: TailorCandidate) => {
    t.start(candidate)
  }

  const busy = t.running !== null

  const chooser: MenuAction[] = t.candidates.map((cand) => ({
    id: cand.id,
    label: `${capitalise(cand.label)}${cand.already ? ' · tailored before' : ''}`,
    hint: cand.name,
    icon: 'edit-3',
    onPress: () => {
      void begin(cand)
    },
  }))

  return (
    <Panel>
      <PanelTitle
        hint={
          t.blocked === null ? 'Rewritten for this posting, with the changes marked.' : undefined
        }
        right={
          t.blocked === null && t.candidates.length > 0 && !busy ? (
            <Button
              size="sm"
              variant="outline"
              icon="edit-3"
              label="Tailor"
              onPress={() => {
                setChoosing(true)
              }}
            />
          ) : undefined
        }
      >
        Tailored materials
      </PanelTitle>

      {t.blocked === 'no-posting' && (
        <Txt size="sm" tone="secondary">
          There is no saved posting behind this application, so there is nothing to tailor your
          documents for. Add the application from its link, or capture the listing, and this offers
          to.
        </Txt>
      )}
      {t.blocked === 'no-model' && (
        <Txt size="sm" tone="secondary">
          Tailoring a document needs a model. Connect one under More → Settings.
        </Txt>
      )}
      {t.blocked === 'no-documents' && (
        <Txt size="sm" tone="secondary">
          Nothing to tailor yet. Put your CV, statements or a cover letter in the Vault and they
          appear here.
        </Txt>
      )}

      {busy && (
        <View style={{ gap: space[2] }}>
          {/* The job's own step, so this line reads the same on every screen —
              and is still here when the person comes back to the record. */}
          <Txt size="sm" tone="secondary">
            {t.running?.state === 'queued' ? 'Queued' : (t.running?.step ?? 'Working')}…
          </Txt>
          <View style={{ alignItems: 'flex-start' }}>
            <Button size="sm" variant="ghost" label="Cancel" onPress={t.cancel} />
          </View>
        </View>
      )}

      {t.error !== null && !busy && (
        <Txt size="sm" color={c.danger}>
          {t.error}
        </Txt>
      )}

      {/* Doubts, not failures: the document was written and saved. These were
          computed and then dropped for as long as a run reported only
          ok-or-why, so a reply that marked nothing said nothing. */}
      {t.notes.length > 0 &&
        !busy &&
        t.notes.map((note) => (
          <Txt key={note} size="sm" tone="secondary">
            {note}
          </Txt>
        ))}

      {t.tailored.length === 0 &&
        t.blocked === null &&
        t.candidates.length > 0 &&
        !busy &&
        t.error === null && (
          <Txt size="sm" tone="secondary">
            Nothing tailored yet. Press Tailor, choose a document, and jojo writes a version for
            this posting with what it changed marked.
          </Txt>
        )}

      {t.tailored.length > 0 && (
        <View style={{ gap: space[3] }}>
          {t.tailored.map((s) => (
            <TailoredCard
              key={s.id}
              snippet={s}
              onPreview={() => {
                setPreviewing(s.id)
              }}
              onDelete={() => {
                const gone = t.remove(s.id)
                if (!gone) return
                const { result, restore } = gone
                toast({
                  title: result.ok ? `${s.title} deleted` : 'That did not delete',
                  ...(result.ok
                    ? {
                        description: 'Gone from this application and from the Vault.',
                        tone: 'danger' as const,
                        ...(restore
                          ? {
                              action: {
                                label: 'Undo',
                                onPress: () => {
                                  const done = restore()
                                  if (done.superseded.length > 0) {
                                    const said = supersededToast(done)
                                    toast({
                                      title: said.title,
                                      ...(said.description === undefined
                                        ? {}
                                        : { description: said.description }),
                                      tone: 'danger',
                                    })
                                  }
                                },
                              },
                            }
                          : {}),
                      }
                    : { description: result.errors[0]?.message ?? '', tone: 'danger' as const }),
                })
              }}
            />
          ))}
        </View>
      )}

      <SnippetPreviewSheet
        snippet={
          preview === null
            ? null
            : {
                id: preview.id,
                title: preview.title,
                body: preview.body,
                subtitle: `${preview.tag} · from ${preview.from} · ${preview.model}${preview.when ? ` · ${preview.when}` : ''}`,
                // Everything this panel lists was written by a model, by
                // construction: `tailoredFor` filters on the record's stamp.
                marked: true,
              }
        }
        onClose={() => {
          setPreviewing(null)
        }}
      />

      <MenuSheet
        open={choosing}
        onClose={() => {
          setChoosing(false)
        }}
        title="Tailor a document"
        description="Takes a minute or two on a local model."
        actions={chooser}
      />
    </Panel>
  )
}

function TailoredCard({
  snippet: s,
  onPreview,
  onDelete,
}: {
  snippet: TailoredSnippet
  onPreview: () => void
  onDelete: () => void
}) {
  const c = useColors()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [menu, setMenu] = useState(false)

  const actions: MenuAction[] = [
    { id: 'preview', label: 'Preview', icon: 'eye', onPress: onPreview },
    {
      id: 'open',
      label: 'Open in the Vault',
      icon: 'external-link',
      onPress: () =>
        navigation.navigate('Tabs', { screen: 'Vault', params: { tool: 'snippets', focus: s.id } }),
    },
    { id: 'delete', label: 'Delete', icon: 'trash-2', tone: 'danger', onPress: onDelete },
  ]

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: c.hairline,
        borderRadius: 12,
        paddingVertical: space[2],
        paddingHorizontal: space[3],
      }}
    >
      {/*
       * TWO ROWS, and the second one is the whole card wide. They were one,
       * and the provenance shared its column with the ⋯ button: the button is
       * a fixed width and the words are not, so on a phone the words were the
       * half that disappeared. See the web twin.
       *
       * The whole card opens it — on a touch screen the card IS the target,
       * and the menu is a nested pressable, which wins the touch over it.
       */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Preview ${s.title}`}
        onPress={onPreview}
        style={{ gap: 2 }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[2],
            minHeight: 44,
          }}
        >
          <Feather name="file-text" size={16} color={c.text3} />
          <Txt size="sm" weight="medium" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
            {s.title}
          </Txt>
          <IconButton
            icon="more-horizontal"
            label={`More actions for ${s.title}`}
            onPress={() => {
              setMenu(true)
            }}
          />
        </View>
        {/* One line, because it reads as one sentence and now has the room. */}
        <Txt size="xs" tone="muted" numberOfLines={1}>
          {s.tag} · from {s.from} · {s.model}
          {s.when ? ` · ${s.when}` : ''}
        </Txt>
      </Pressable>

      <MenuSheet
        open={menu}
        onClose={() => {
          setMenu(false)
        }}
        title={s.title}
        actions={actions}
      />
    </View>
  )
}
