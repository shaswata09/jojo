import { useState } from 'react'
import { View } from 'react-native'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { Txt } from '@/components/ui/Text'
import { useProfile } from '@/lib/store-context'
import { space } from '@/theme/tokens'

/** Every `ProfileText` field, empty. The six this sheet does not ask about. */
const BLANK_TEXT = {
  fullName: '',
  position: '',
  location: '',
  email: '',
  website: '',
  scholar: '',
  github: '',
  linkedin: '',
  targetRoles: '',
  regions: '',
}

/**
 * Four questions, on the launch where answering them is cheapest.
 *
 * The phone's twin of web's `WelcomeDetails`, and the reasoning is the same
 * one — worth repeating only where the two differ.
 *
 * WHY ASK AT ALL. Three things are worse with an empty profile and none says so
 * when it matters: a draft substitutes your name and leaves `[YOUR NAME]`
 * standing without one, the scout scores against target roles and regions and
 * reports "not scored" without them, and Transfer refuses to send a blank
 * profile. Each is a dead end reached long after a name could have been typed.
 *
 * WHY ONLY FOUR of `ProfileText`'s ten. These are the ones a draft substitutes
 * and a header prints. The other six are worth having and none is worth a
 * stranger's patience on their first minute — and on a 390pt screen the cost of
 * asking is measured in scrolling, which makes the cut sharper here than on the
 * web.
 *
 * WHY IT IS SKIPPABLE, when `FirstRunChoice` before it is not: there IS a
 * neutral answer here. "Not now" leaves the profile exactly as blank as it
 * already was, a state the app handles everywhere. The fork before it has no
 * neutral answer, because the store already holds one of the two data sets.
 *
 * Nothing is required, including the name. Save writes what is filled in and
 * leaves the rest.
 */
export function WelcomeDetails({ fresh, onDone }: { fresh: boolean; onDone: () => void }) {
  const { profile, update } = useProfile()
  // Blank on a first run, whatever the store holds.
  //
  // Choosing the demo records seeds a whole profile, so prefilling here would
  // put a seeded name in a field labelled "Full name" and a stranger's address
  // in "Email" — a form that answers its own questions with somebody else's
  // answers. `ProfileScreen` makes the same point about placeholders: grey
  // examples ask a question, black text answers one.
  const [draft, setDraft] = useState(
    fresh
      ? { fullName: '', position: '', location: '', email: '' }
      : {
          fullName: profile.text.fullName,
          position: profile.text.position,
          location: profile.text.location,
          email: profile.text.email,
        },
  )

  const set = (key: keyof typeof draft) => (value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  const save = () => {
    /*
     * On a first run the four answers REPLACE the text block; otherwise they are
     * spread over it.
     *
     * The difference is the demo profile. Spreading on a fresh install would
     * leave the demo's website, Scholar, GitHub and LinkedIn attached to the
     * user's own name — a profile half theirs and half a fixture's, which is
     * worse than either. Off a first run there is nothing to clear and the other
     * six fields are the user's own, so they must survive a form that never
     * showed them.
     */
    const text = fresh ? { ...BLANK_TEXT, ...draft } : { ...profile.text, ...draft }
    update({ text })
    onDone()
  }

  /**
   * Leaving without saving, on a fresh install, still clears the fixture.
   *
   * Skipping used to leave the demo profile exactly where it was — a real
   * person's name, city and live Scholar, GitHub and LinkedIn — and `isBlank`
   * was then false, so this dialog never came back and nothing on the Profile
   * screen marked those values as anybody else's. `draft/template.ts`
   * substitutes `fullName` into every cover letter, so the drafts signed off as
   * a stranger.
   *
   * Off a first run there is nothing to clear: those six fields are the user's
   * own and a dismissed dialog must not touch them.
   */
  const dismiss = () => {
    if (fresh) update({ text: { ...BLANK_TEXT } })
    onDone()
  }

  const anything = Object.values(draft).some((v) => v.trim().length > 0)

  return (
    <Sheet
      open
      onClose={dismiss}
      size="tall"
      title="A little about you"
      description="Drafts sign off with your name, and the scout scores against what you are looking for. All of it stays on this device, and all of it is optional — Profile has the rest."
      footer={
        <>
          <Button label="Skip for now" variant="ghost" size="md" onPress={dismiss} />
          {/* Disabled only when there is nothing to write, so it never claims to
              have saved an empty form. Skip does the same thing honestly. */}
          <Button label="Save and continue" size="md" disabled={!anything} onPress={save} />
        </>
      }
    >
      <View style={{ gap: space[3], paddingBottom: space[2] }}>
        <TextField
          label="Full name"
          value={draft.fullName}
          autoComplete="name"
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
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          placeholder="you@university.edu"
          onChangeText={set('email')}
        />
        <Txt size="xs" tone="muted">
          The rest — links, target roles, the terms the scout matches on — lives under Profile, in
          the More tab.
        </Txt>
      </View>
    </Sheet>
  )
}
