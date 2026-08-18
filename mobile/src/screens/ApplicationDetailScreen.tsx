import { useMemo, useState } from 'react'
import { TODAY } from '@/lib/today'
import { Linking, Pressable, StyleSheet, TextInput, View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { useNavigation, useRoute } from '@react-navigation/native'
import type { RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { LabelChips, LabelPicker } from '@/components/common/Labels'
import { StagePicker } from '@/components/common/StagePicker'
import { Button, IconButton } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { EmptyState } from '@/components/ui/EmptyState'
import { MenuSheet } from '@/components/ui/Menu'
import { Screen } from '@/components/ui/Screen'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { STAGE_LABEL, displayName, offerDaysLeft, respondByLabel } from '@jojo/service/data/seed'
import type { Application, Outcome, Stage } from '@jojo/service/data/seed'
import { bucketOf, compareItems, shortDate, timeLabel, whenLabel } from '@jojo/service/data/timeline'
import type { TimelineBucket, TimelineItem } from '@jojo/service/data/timeline'
import { refKey } from '@/lib/ids'
import { stageNeedsDetails } from '@/lib/stage-transition'
import { listJoin, plural } from '@/lib/text'
import { hostOf } from '@/lib/urls'
import { useSheets } from '@/lib/sheets-context'
import { useApplications, useScout, useTimeline, useVault } from '@/lib/store-context'
import type { TimelineDraft } from '@/lib/store-context'
import { KIND_ICON, KIND_LABEL } from '@/lib/timeline-visuals'
import { useToast } from '@/lib/toast-context'
import type { RootStackParamList } from '@/navigation/types'
import { StageTransitionSheet } from '@/sheets/StageTransitionSheet'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { fonts, radius, space, type } from '@/theme/tokens'

/**
 * One application, at its own address.
 *
 * Nine surfaces link to an application — the board card, the list row, the
 * recent list, a reminder's "related to", the search results — and until this
 * existed every one of them pointed at nothing.
 */
export function ApplicationDetailScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'ApplicationDetail'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { get } = useApplications()
  const application = get(route.params.id)

  // The missing case first, because it is a real destination rather than an
  // error: a stale link, or the back button after a delete, both arrive here.
  if (!application) {
    return (
      <Screen title="Application">
        <Panel>
          <EmptyState
            icon="help-circle"
            title="This application no longer exists"
            description="It was deleted, or the link points at an id that never existed. Nothing else was removed with it."
            action={<Button label="Back" variant="outline" onPress={() => navigation.goBack()} />}
          />
        </Panel>
      </Screen>
    )
  }

  // Keyed so the note draft belongs to one record. Without it, navigating
  // between two applications would carry the first one's unsaved note across.
  return <Detail key={application.id} application={application} />
}

function Detail({ application: a }: { application: Application }) {
  const c = useColors()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { toast } = useToast()
  const { open: openSheet } = useSheets()
  const { update, remove, duplicate } = useApplications()
  const { forApplication, add: addItem, remove: removeItem } = useTimeline()
  const { links, files, snippets } = useVault()
  const { postings, matches } = useScout()

  const [note, setNote] = useState(a.note)
  const [noteSaved, setNoteSaved] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [target, setTarget] = useState<Stage | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const labelKey = refKey('app', a.id)
  const items = useMemo(() => [...forApplication(a.id)].sort(compareItems), [forApplication, a.id])

  const openCount = items.filter((i) => !i.completedOn).length
  const reminderCount = items.filter((i) => i.remind).length
  const savedCount = [links, files, snippets, postings, matches].reduce(
    (n, list) => n + list.filter((r) => r.applicationId === a.id).length,
    0,
  )

  /**
   * What survives the delete, counted rather than guessed.
   *
   * `remove()` unlinks and never cascades, so the confirmation has to say so —
   * "delete Rice" cannot fairly be read as consent to delete the four files
   * someone spent an evening on.
   */
  const kept = listJoin(
    [
      reminderCount > 0 ? plural(reminderCount, 'reminder') : '',
      items.length - reminderCount > 0 ? plural(items.length - reminderCount, 'event') : '',
      savedCount > 0 ? plural(savedCount, 'saved item') : '',
    ].filter(Boolean),
  )

  /**
   * The note is stored as plain text, and the field has to be one too.
   *
   * Six surfaces read this string and every one prints it straight out.
   * Committed on blur rather than on every keystroke: a dispatch behind each
   * character would reset `daysAgo` while you typed.
   */
  const commitNote = () => {
    const next = note.trim()
    if (next === a.note) return
    setNote(next)
    update(a.id, { note: next, lastAction: 'Note edited' })
    setNoteSaved(true)
  }

  /**
   * Every write that changes the stage, and the only one that can undo itself.
   *
   * A stage move rewrites up to five fields in one go and can drop the offer the
   * user typed. Snapshotting first is what closes that gap: `a` is the record as
   * it stands this render, so the revert is a fact rather than a reconstruction,
   * and the minted timeline row goes back out with it.
   */
  const applyStageMove = (
    patch: Partial<Application>,
    extraItem?: TimelineDraft,
    consequences: string[] = [],
  ) => {
    const before = a
    const to = patch.stage ?? a.stage

    update(a.id, patch)
    const minted = extraItem ? addItem(extraItem) : undefined

    toast({
      title: `${displayName(a)} moved to ${STAGE_LABEL[to]}`,
      description: consequences.length > 0 ? consequences.join(' ') : undefined,
      action: {
        label: 'Undo',
        onPress: () => {
          update(before.id, revertOf(before, patch))
          if (minted) removeItem(minted.id)
        },
      },
    })
  }

  const onPickStage = (stage: Stage) => {
    if (stageNeedsDetails(a, stage)) {
      setTarget(stage)
      return
    }
    applyStageMove({ stage, lastAction: `Moved to ${STAGE_LABEL[stage]}` })
  }

  const onDecide = (decision: Extract<Outcome, 'accepted' | 'declined'>) => {
    const before = a
    const patch: Partial<Application> = {
      stage: 'closed',
      outcome: decision,
      lastAction: decision === 'accepted' ? 'Offer accepted' : 'Offer declined',
    }
    update(a.id, patch)
    toast({
      title: `${displayName(a)} closed`,
      description: `Recorded as ${decision}. The offer details and its reminders were kept.`,
      action: { label: 'Undo', onPress: () => update(before.id, revertOf(before, patch)) },
    })
  }

  const onDuplicate = () => {
    const copy = duplicate(a.id)
    if (!copy) return
    toast({
      title: `${displayName(copy)} duplicated`,
      description: 'The copy starts at Draft, with the note and details carried over.',
      action: {
        label: 'Undo',
        onPress: () => {
          remove(copy.id)
          navigation.navigate('ApplicationDetail', { id: a.id })
        },
      },
    })
    navigation.navigate('ApplicationDetail', { id: copy.id })
  }

  const onDelete = () => {
    const { restore } = remove(a.id)
    // Both guards, because they catch different mistakes: the sheet catches the
    // mis-tap, the undo catches the change of mind. `restore` also puts back
    // every edge the delete unlinked, which the user could not rebuild by
    // simply adding the application again.
    toast({
      title: `${displayName(a)} deleted`,
      description: kept ? `${kept} were kept, unlinked.` : undefined,
      tone: 'danger',
      action: { label: 'Undo', onPress: restore },
    })
    navigation.goBack()
  }

  const facts: { label: string; value?: string; url?: string }[] = [
    { label: 'Source', value: a.source },
    { label: 'Location', value: a.location },
    // Falls through to the offer: Baylor states "$112k + $15k startup" in its
    // offer block, and printed "Compensation —" underneath it, because the
    // number was typed into the stage form and `a.comp` was never the field it
    // landed in.
    { label: 'Compensation', value: a.comp ?? a.offer?.comp },
    { label: 'Posting', value: a.url ? hostOf(a.url) : undefined, url: a.url },
    { label: 'Applied on', value: a.appliedOn ? shortDate(a.appliedOn) : undefined },
    { label: 'Submitted on', value: a.submittedOn ? shortDate(a.submittedOn) : undefined },
  ]

  return (
    <Screen
      title={displayName(a)}
      subtitle={`${a.lastAction} · ${a.daysAgo === 0 ? 'Today' : `${plural(a.daysAgo, 'day')} ago`}`}
      actions={
        <>
          <IconButton
            icon="flag"
            label={a.flagged ? 'Clear the follow-up flag' : 'Flag for follow-up'}
            tone={a.flagged ? 'danger' : undefined}
            active={a.flagged}
            onPress={() =>
              update(a.id, {
                flagged: !a.flagged,
                lastAction: a.flagged ? 'Flag cleared' : 'Flagged for follow-up',
              })
            }
          />
          <IconButton
            icon="more-horizontal"
            label="More actions"
            onPress={() => setMenuOpen(true)}
          />
        </>
      }
    >
      <Panel>
        <View style={s.chipRow}>
          {/* Neutral. The role is a category, not a status, and colour law
              spends colour on the user's own keywords — which sit on the row
              below and have to stay the loud thing. */}
          <Chip tone="gray">{a.roleTag}</Chip>
          <StagePicker value={a.stage} name={displayName(a)} onSelect={onPickStage} />
        </View>
        <View style={[s.chipRow, { marginTop: space[2.5] }]}>
          <LabelChips recordId={labelKey} />
          <LabelPicker recordId={labelKey} name={displayName(a)} />
        </View>
      </Panel>

      {/* Above the facts on purpose: a respond-by countdown is the most
          perishable thing on this screen, and the one you came to check.
          Rendered from the offer rather than from the stage, so the details the
          confirmation promised to keep survive the move to closed. */}
      {a.offer ? (
        <OfferBlock
          application={a}
          onDecide={onDecide}
          settled={a.stage === 'closed' ? (a.outcome ?? 'withdrawn') : undefined}
        />
      ) : null}

      <Panel>
        <PanelTitle>Details</PanelTitle>
        <View style={{ gap: space[3] }}>
          {facts.map((f) => (
            <View key={f.label}>
              <Txt size="xs" tone="muted">
                {f.label}
              </Txt>
              {f.value === undefined ? (
                <Txt size="base" tone="muted">
                  —
                </Txt>
              ) : f.url ? (
                <Pressable
                  accessibilityRole="link"
                  onPress={() => Linking.openURL(f.url!)}
                  style={styles.linkRow}
                >
                  {/* A URL is one unbroken token, so it cannot wrap and will
                      not shrink on its own — the longest field in the app was
                      the one most able to run past the panel edge. */}
                  <Txt size="base" tone="info" style={s.fill} numberOfLines={1}>
                    {f.value}
                  </Txt>
                  <Feather name="external-link" size={13} color={c.info} />
                </Pressable>
              ) : (
                <Txt size="base">{f.value}</Txt>
              )}
            </View>
          ))}
        </View>
      </Panel>

      {/* Second, not last. The record's dates and the only Add button used to
          sit below an empty editor and its eight-button toolbar — so the one
          thing this screen is opened to check was the one you had to scroll for. */}
      <Panel>
        <PanelTitle
          hint={items.length > 0 ? `${openCount} open · ${items.length} total` : undefined}
          right={
            <Button
              label="Add a date"
              icon="calendar"
              variant="outline"
              onPress={() =>
                // 'event' rather than 'reminder': this sits beside the record's
                // dates, so the date is the point. The sheet's own switch still
                // decides whether it also shows up as a reminder.
                openSheet('timelineItem', { mode: 'event', initial: { applicationId: a.id } })
              }
            />
          }
        >
          {/* Not "Upcoming": this list holds overdue and completed rows too, and
              a heading that promised the future while showing a thing you missed
              last week was the least trustworthy word on the screen. */}
          Dates and reminders
        </PanelTitle>

        {items.length === 0 ? (
          <EmptyState
            compact
            title="Nothing scheduled"
            description="Deadlines, interviews and follow-ups filed against this application show up here."
          />
        ) : (
          items.map((item, i) => (
            <View key={item.id}>
              {i > 0 ? <Divider /> : null}
              <UpcomingRow
                item={item}
                onEdit={() =>
                  openSheet('timelineItem', {
                    mode: item.remind ? 'reminder' : 'event',
                    initial: item,
                  })
                }
                onDraft={() => openSheet('draft', { itemId: item.id })}
              />
            </View>
          ))
        )}
      </Panel>

      <Panel>
        <PanelTitle hint="Saves when you tap away">Note</PanelTitle>
        <TextInput
          multiline
          value={note}
          onChangeText={(v) => {
            setNote(v)
            setNoteSaved(false)
          }}
          onBlur={commitNote}
          placeholder="What is still outstanding, who you spoke to, what to ask next"
          placeholderTextColor={c.text3}
          accessibilityLabel={`Note on ${displayName(a)}`}
          style={[
            styles.note,
            { color: c.text1, backgroundColor: c.well, borderColor: c.hairline },
          ]}
        />
        {noteSaved ? (
          <Txt size="xs" tone="muted" style={{ marginTop: space[1.5] }}>
            Note saved
          </Txt>
        ) : null}
      </Panel>

      <MenuSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={displayName(a)}
        actions={[
          {
            id: 'edit',
            label: 'Edit',
            icon: 'edit-2',
            onPress: () => openSheet('application', { mode: 'edit', id: a.id }),
          },
          {
            // The record's own way into a message. Until this existed the only
            // route to a filled thank-you was: add a reminder, open the Vault,
            // find its row, press Draft on it.
            id: 'draft',
            label: 'Draft a message',
            icon: 'mail',
            onPress: () => openSheet('draft', { applicationId: a.id }),
          },
          { id: 'duplicate', label: 'Duplicate', icon: 'copy', onPress: onDuplicate },
          {
            id: 'delete',
            label: 'Delete',
            icon: 'trash-2',
            tone: 'danger',
            onPress: () => setConfirmDelete(true),
          },
        ]}
      />

      {target ? (
        <StageTransitionSheet
          open
          onOpenChange={(next) => {
            if (!next) setTarget(null)
          }}
          application={a}
          target={target}
          onApply={applyStageMove}
        />
      ) : null}

      <ConfirmSheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${displayName(a)}?`}
        description={
          kept
            ? `The application and its note go. ${kept} will be kept but unlinked — nothing you filed under it is deleted.`
            : 'The application and its note go. Nothing else points at it.'
        }
        confirmLabel="Delete"
        tone="danger"
        onConfirm={onDelete}
      />
    </Screen>
  )
}

/* --------------------------------- offer --------------------------------- */

function OfferBlock({
  application: a,
  onDecide,
  settled,
}: {
  application: Application
  onDecide: (decision: 'accepted' | 'declined') => void
  /** Set once the record is closed — the block becomes a record of what happened. */
  settled?: Outcome
}) {
  const c = useColors()
  const offer = a.offer!
  // Second argument required, and see the note in `lib/priority.ts`.
  const daysLeft = offerDaysLeft(offer, TODAY)
  const tone = settled ? 'muted' : daysLeft < 0 ? 'danger' : daysLeft <= 1 ? 'warning' : 'secondary'

  return (
    <Panel
      style={{
        borderColor: settled ? c.hairline : daysLeft < 0 ? c.dangerBorder : c.successBorder,
      }}
    >
      <PanelTitle
        hint={
          settled
            ? `Closed · recorded as ${settled}`
            : daysLeft < 0
              ? `${-daysLeft} days past the deadline`
              : `${daysLeft} days left`
        }
      >
        Offer
      </PanelTitle>

      <Txt size="xl" weight="semibold" tone={tone}>
        Respond by {respondByLabel(offer)}
      </Txt>
      {offer.comp ? (
        <Txt size="base" tone="secondary" style={{ marginTop: space[1] }}>
          {offer.comp}
        </Txt>
      ) : null}
      {offer.note ? (
        <Txt size="sm" tone="muted" style={{ marginTop: space[1] }}>
          {offer.note}
        </Txt>
      ) : null}

      {settled ? null : (
        <View style={styles.offerActions}>
          <Button label="Accept" icon="check" onPress={() => onDecide('accepted')} />
          <Button label="Decline" variant="outline" onPress={() => onDecide('declined')} />
        </View>
      )}
    </Panel>
  )
}

/* ------------------------------- date rows ------------------------------- */

/** The kinds a message is the obvious next move on. */
const DRAFTABLE: readonly TimelineItem['kind'][] = ['interview', 'follow-up', 'call', 'visit']

function UpcomingRow({
  item,
  onEdit,
  onDraft,
}: {
  item: TimelineItem
  onEdit: () => void
  onDraft: () => void
}) {
  const c = useColors()
  const bucket = bucketOf(item, TODAY)
  const done = Boolean(item.completedOn)
  const draftable = !done && DRAFTABLE.includes(item.kind)

  const bucketTone: Record<TimelineBucket, 'danger' | 'warning' | 'muted'> = {
    overdue: 'danger',
    today: 'warning',
    upcoming: 'muted',
    done: 'muted',
  }

  return (
    <View style={styles.dateRow}>
      <Feather name={KIND_ICON[item.kind]} size={15} color={c.text3} style={{ marginTop: 3 }} />
      <Pressable accessibilityRole="button" onPress={onEdit} style={s.fill}>
        <Txt size="sm" tone={done ? 'muted' : 'primary'} style={done ? s.struck : undefined}>
          {item.title}
        </Txt>
        <Txt size="xs" tone="muted" numberOfLines={1}>
          {KIND_LABEL[item.kind]}
          {item.detail ? ` · ${item.detail}` : ''}
        </Txt>
        {draftable ? (
          <Button
            label="Draft a message"
            icon="mail"
            variant="outline"
            onPress={onDraft}
            style={{ marginTop: space[1.5], alignSelf: 'flex-start' }}
          />
        ) : null}
      </Pressable>
      <View style={styles.dateRight}>
        <Txt size="xs" weight="medium" tone={bucketTone[bucket]}>
          {whenLabel(item, TODAY)}
        </Txt>
        <Txt size="xs" tone="muted" mono>
          {timeLabel(item) ?? shortDate(item.date)}
        </Txt>
      </View>
    </View>
  )
}

/**
 * The patch that puts `before` back, given the patch that changed it.
 *
 * Keyed off the patch rather than off a hand-written field list on purpose: the
 * stage form writes a different set of fields for each destination, and a list
 * here would be another place to remember when one of them grows a field.
 * `undefined` values count: `{ offer: undefined }` is how the form clears an
 * offer, and that is exactly the write that most needs undoing.
 */
function revertOf(before: Application, patch: Partial<Application>): Partial<Application> {
  const revert: Record<string, unknown> = { daysAgo: before.daysAgo }
  for (const key of Object.keys(patch)) revert[key] = before[key as keyof Application]
  return revert as Partial<Application>
}

const styles = StyleSheet.create({
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
  offerActions: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
  dateRow: { flexDirection: 'row', gap: space[2.5], paddingVertical: space[2.5] },
  dateRight: { alignItems: 'flex-end', gap: 2 },
  note: {
    minHeight: 110,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space[3],
    fontFamily: fonts.regular,
    fontSize: type.base,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
})
