import { useMemo, useState } from 'react'
import { ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { MenuSheet } from '@/components/ui/Menu'
import { Sheet } from '@/components/ui/Sheet'
import { Txt } from '@/components/ui/Text'
import { displayName } from '@jojo/service/data/seed'
import type { Application } from '@jojo/service/data/seed'
import { shortDate } from '@jojo/service/data/timeline'
import type { TimelineItem } from '@jojo/service/data/timeline'
import { TODAY } from '@/lib/today'
import type { Snippet } from '@jojo/service/data/vault'
import { useApplications, useTimeline, useVault } from '@/lib/store-context'
import { useToast } from '@/lib/toast-context'
import { useCopy } from '@/lib/use-copy'
import { hostOrNothing } from '@/lib/urls'
import { useColors } from '@/theme/theme-context'
import { fonts, radius, space, type } from '@/theme/tokens'

/**
 * A blank in a snippet: `[NAME]`, `[YOUR NAME]`, `[LOCAL CONTEXT]`.
 *
 * Upper case with an optional space is the convention every seeded snippet
 * already follows, and it is narrow enough that a bracketed aside someone types
 * into their own draft — "[see attached]" — is not mistaken for one.
 */
const BLANK = /\[[A-Z][A-Z0-9 '/-]*\]/g

/**
 * What the records actually know, keyed by the token that asks for it.
 *
 * Everything absent from this map stays on the page as a visible blank. That is
 * the whole design: `[NAME]` is never filled, because the store holds no
 * recruiter's name and a *plausible* one — inferred from a note, or borrowed
 * from a nearby contact link — is exactly the kind of thing that gets sent by
 * accident and addresses a search chair as the wrong person. A blank is
 * impossible to send without noticing. A confident guess is not.
 */
function fillsFor(app?: Application, item?: TimelineItem): Record<string, string> {
  const fills: Record<string, string> = {}
  if (app) {
    fills.ROLE = app.role
    fills.POSITION = app.role
    fills.ORG = app.org
    fills.EMPLOYER = app.org
    fills.COMPANY = app.org
    fills.INSTITUTION = app.org

    const sent = app.submittedOn ?? app.appliedOn
    if (sent) fills.DATE = shortDate(sent)

    const portal = hostOrNothing(app.url)
    if (portal) fills.PORTAL = portal
  }

  // One token, two questions. In a chase — "I submitted it on [DATE]" — it is
  // the day the application went in. In a thank-you it is the day you met, and
  // for that the item is the record that knows. Getting this backwards produces
  // a wrong date rather than a missing one, which is the worse failure.
  if (item && (item.kind === 'interview' || item.kind === 'visit' || item.kind === 'call')) {
    fills.DATE = shortDate(item.date)
  }

  return fills
}

const applyFills = (body: string, fills: Record<string, string>) =>
  body.replace(BLANK, (token) => fills[token.slice(1, -1)] ?? token)

/** Every blank still in the text, in the order they first appear. */
function blanksIn(text: string) {
  const found = text.match(BLANK) ?? []
  return { count: found.length, names: [...new Set(found)] }
}

export type DraftSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The reminder this message answers — its date and application seed the draft. */
  itemId?: string
  /** Stands in when there is no reminder, or overrides the one the item carries. */
  applicationId?: string
}

/**
 * Write the email, with no model connected.
 *
 * Every "Draft…" button in the app used to point at an assistant that needs a
 * local server nobody has started, so all of them shipped disabled. This is the
 * honest version of the same journey: the user's own saved snippets are the
 * templates, the application and the reminder fill in what they genuinely know,
 * and everything they do not know stays on the page as a blank to be typed
 * over. Nothing is generated and nothing is sent — the draft leaves through the
 * clipboard, and "Mark sent" only ticks the reminder off.
 *
 * Plain text rather than the web's rich-text editor: what this produces is
 * pasted into a mail client, and a `contenteditable` full of `<span>` markup is
 * a liability there rather than a feature.
 */
export function DraftSheet({ open, onOpenChange, itemId, applicationId }: DraftSheetProps) {
  const c = useColors()
  const { get, update } = useTimeline()
  const { byId } = useApplications()
  const { snippets, addSnippet } = useVault()
  const { toast } = useToast()

  const item = itemId ? get(itemId) : undefined
  // The caller's application wins over the item's, so a Draft button that knows
  // which record it sits on is not overruled by a reminder filed elsewhere.
  //
  // A reminder can be about several jobs now, and a draft email is addressed to
  // one. The first is taken rather than none: `fillsFor` uses it for the
  // employer's name and the greeting, and refusing to fill anything in because
  // the reminder covers two jobs helps nobody. A Draft opened from an
  // application passes its own id and never reaches this.
  const appId = applicationId ?? item?.applicationIds[0]
  const app = appId ? byId.get(appId) : undefined

  const emailSnippets = useMemo(() => snippets.filter((s) => s.tag === 'Email'), [snippets])
  const fills = useMemo(() => fillsFor(app, item), [app, item])

  const [chosenId, setChosenId] = useState<string | null>(null)
  const [text, setText] = useState('')
  /** Edited since the last template load — see `load` for what it protects. */
  const [dirty, setDirty] = useState(false)
  /** Pressed "start from a blank draft" with no snippets to start from. */
  const [started, setStarted] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const { copy, isCopied } = useCopy()

  const blanks = useMemo(() => blanksIn(text), [text])
  const empty = text.trim().length === 0

  /**
   * Loads a template, substituting what the records know.
   *
   * Swapping templates over work in progress is the one destructive thing here,
   * and the draft is not stored anywhere it could be recovered from — so it
   * goes on an undo toast rather than a confirmation.
   */
  const load = (snippet?: Snippet) => {
    const previous = { text, chosenId }
    setChosenId(snippet?.id ?? null)
    setText(snippet ? applyFills(snippet.body, fills) : '')
    setDirty(false)
    setStarted(true)

    if (!dirty || empty) return
    toast({
      title: 'Draft replaced',
      description: snippet ? `Loaded ${snippet.title}.` : 'Started again from blank.',
      action: {
        label: 'Undo',
        onPress: () => {
          setText(previous.text)
          setChosenId(previous.chosenId)
          setDirty(true)
        },
      },
    })
  }

  const saveAsSnippet = () => {
    // Named after the template it came from and the employer it was aimed at,
    // because a vault full of "Draft" is a vault you cannot search.
    const base = emailSnippets.find((s) => s.id === chosenId)?.title ?? 'Draft email'
    const title = app ? `${base} — ${app.org}` : base
    const saved = addSnippet({
      title,
      tag: 'Email',
      body: text,
      applicationIds: app ? [app.id] : [],
    })
    toast({
      title: 'Saved to snippets',
      description: `${saved.title} · tagged Email, in the Vault`,
    })
  }

  const markSent = () => {
    if (!item) return
    const before = item.completedOn ?? null
    update(item.id, { completedOn: TODAY })
    onOpenChange(false)
    toast({
      // Nothing was sent from here, and the copy says only what happened: the
      // reminder is ticked off, the same as ticking its box in the list.
      title: 'Marked as sent',
      description: `${item.title} — ticked off in reminders`,
      action: { label: 'Undo', onPress: () => update(item.id, { completedOn: before }) },
    })
  }

  const nothingToStartFrom = emailSnippets.length === 0 && !started

  return (
    <Sheet
      open={open}
      onClose={() => onOpenChange(false)}
      size="tall"
      title="Draft a message"
      description={`${
        app
          ? `For ${displayName(app)}${item ? ` · ${item.title}` : ''}.`
          : 'Not linked to an application, so [ROLE] and [DATE] stay blank.'
      } Nothing is generated and nothing is sent — fill the blanks, copy it into your mail client, then mark it sent.`}
      footer={
        <>
          <Button
            label="Save as snippet"
            variant="ghost"
            size="md"
            blocker={empty ? 'Write something first' : undefined}
            onPress={saveAsSnippet}
          />
          <Button
            label={isCopied() ? 'Copied' : 'Copy'}
            icon={isCopied() ? 'check' : 'copy'}
            variant="outline"
            size="md"
            disabled={empty}
            onPress={() => copy(text)}
          />
          <Button
            label="Mark sent"
            icon="send"
            size="md"
            blocker={
              !item
                ? 'Open this from a reminder to tick it off'
                : item.completedOn
                  ? 'Already ticked off'
                  : undefined
            }
            onPress={markSent}
          />
        </>
      }
    >
      {nothingToStartFrom ? (
        <EmptyState
          icon="mail"
          title="No email snippets yet"
          description="Snippets tagged Email show up here as starting points. There is nothing to load, but the draft does not have to start from one."
          action={
            <Button
              label="Start from a blank draft"
              icon="edit-2"
              variant="outline"
              size="md"
              onPress={() => load(undefined)}
            />
          }
        />
      ) : (
        <View style={styles.body}>
          <Button
            label={
              chosenId
                ? (emailSnippets.find((s) => s.id === chosenId)?.title ?? 'Blank draft')
                : started
                  ? 'Blank draft'
                  : 'Start from one of your email snippets'
            }
            icon="mail"
            variant="outline"
            size="md"
            full
            onPress={() => setPickerOpen(true)}
          />

          <ScrollView style={styles.editorScroll} keyboardShouldPersistTaps="handled">
            <TextInput
              multiline
              value={text}
              onChangeText={(next) => {
                setText(next)
                setDirty(true)
              }}
              placeholder="Write the message, or pick a snippet to start from…"
              placeholderTextColor={c.text3}
              accessibilityLabel="Message draft"
              style={[
                styles.editor,
                { color: c.text1, backgroundColor: c.well, borderColor: c.hairline },
              ]}
            />
          </ScrollView>

          {/* The count is the only thing standing between a half-filled template
              and an email addressed to [NAME]. */}
          <Txt
            size="xs"
            tone={blanks.count > 0 ? 'warning' : 'muted'}
            accessibilityLiveRegion="polite"
          >
            {empty
              ? 'Nothing drafted yet.'
              : blanks.count === 0
                ? 'No blanks left.'
                : `${blanks.count} ${blanks.count === 1 ? 'blank' : 'blanks'} left — ${blanks.names.join(', ')}`}
            {blanks.names.some((n) => n.includes('NAME') || n.includes('PERSON'))
              ? " · a person's name is never filled in for you"
              : ''}
          </Txt>
        </View>
      )}

      <MenuSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Start from"
        description="Your own email snippets, with what the records know already filled in."
        actions={[
          ...emailSnippets.map((s) => ({
            id: s.id,
            label: s.title,
            icon: 'mail' as const,
            checked: s.id === chosenId,
            onPress: () => load(s),
          })),
          {
            id: 'blank',
            label: 'Blank draft',
            icon: 'edit-2' as const,
            checked: chosenId === null && started,
            onPress: () => load(undefined),
          },
        ]}
      />
    </Sheet>
  )
}

const styles = StyleSheet.create({
  body: { flex: 1, minHeight: 0, gap: space[3] },
  editorScroll: { flex: 1, minHeight: 0 },
  editor: {
    minHeight: 240,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space[3],
    fontFamily: fonts.regular,
    fontSize: type.base,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
})
