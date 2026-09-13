import { useState } from 'react'
import { View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Button, IconButton } from '@/components/ui/Button'
import { Marked, MarksLegend } from '@/components/ui/Marked'
import { MenuSheet } from '@/components/ui/Menu'
import type { MenuAction } from '@/components/ui/Menu'
import { Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { stripMarks } from '@jojo/service/core/marks'
import type { TailorCandidate } from '@jojo/service/core/tailoring'
import { supersededToast } from '@jojo/service/react/undo'
import { TAILOR_STEP_LABEL } from '@jojo/service/react/use-tailor'
import { useTailoring } from '@/lib/tailor-agent'
import type { TailoredSnippet } from '@/lib/tailor-agent'
import { useToast } from '@/lib/toast-context'
import { useCopy } from '@/lib/use-copy'
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
 * The phone cannot stream, so there is no draft appearing under the progress
 * line; the step names what is happening and Cancel is always within reach,
 * because a document on the local box is minutes rather than seconds.
 */

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function TailoredPanel({ applicationId }: { applicationId: string }) {
  const c = useColors()
  const t = useTailoring(applicationId)
  const { toast } = useToast()
  const [choosing, setChoosing] = useState(false)

  const begin = async (candidate: TailorCandidate) => {
    const outcome = await t.start(candidate)
    if (!outcome.ok) return
    toast({
      title: `${outcome.title} saved`,
      description:
        outcome.notes.length > 0
          ? outcome.notes.join(' ')
          : 'Filed under this application, with the changes marked. Copy strips the marks.',
      ...(outcome.restore
        ? {
            action: {
              label: 'Undo',
              onPress: () => {
                const done = outcome.restore?.()
                if (done && done.superseded.length > 0) {
                  const said = supersededToast(done)
                  toast({
                    title: said.title,
                    ...(said.description === undefined ? {} : { description: said.description }),
                    tone: 'danger',
                  })
                }
              },
            },
          }
        : {}),
    })
  }

  const busy = t.step !== null

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
          <Txt size="sm" tone="secondary">
            {t.step === null ? '' : TAILOR_STEP_LABEL[t.step]}
            {t.target ? ` · ${t.target}` : ''}…
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
            <TailoredRow
              key={s.id}
              snippet={s}
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
          <MarksLegend />
        </View>
      )}

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

function TailoredRow({ snippet: s, onDelete }: { snippet: TailoredSnippet; onDelete: () => void }) {
  const c = useColors()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { copy, isCopied } = useCopy()
  const [open, setOpen] = useState(false)
  const [menu, setMenu] = useState(false)

  const actions: MenuAction[] = [
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
        padding: space[3],
        gap: space[2],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2] }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size="sm" weight="medium">
            {s.title}
          </Txt>
          <Txt size="xs" tone="muted">
            {s.tag} · from {s.from} · {s.model}
            {s.when ? ` · ${s.when}` : ''}
          </Txt>
        </View>
        <IconButton
          icon={isCopied(s.id) ? 'check' : 'copy'}
          label="Copy without the marks"
          onPress={() => {
            void copy(stripMarks(s.body), s.id)
          }}
        />
        <IconButton
          icon="more-horizontal"
          label={`More actions for ${s.title}`}
          onPress={() => {
            setMenu(true)
          }}
        />
      </View>

      <View style={open ? undefined : { maxHeight: 220, overflow: 'hidden' }}>
        <Marked body={s.body} />
      </View>
      <View style={{ alignItems: 'flex-start' }}>
        <Button
          size="sm"
          variant="ghost"
          label={open ? 'Show less' : 'Show all'}
          onPress={() => {
            setOpen((v) => !v)
          }}
        />
      </View>

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
