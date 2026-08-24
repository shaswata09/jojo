import { useState } from 'react'
import { Link } from 'react-router'
import { UserRound } from 'lucide-react'
import { useProfile } from '@jojo/service/react/use-profile'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/common/Field'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { profilePath } from '@/lib/links'

/** Every `ProfileText` field, empty. The six this dialog does not ask about. */
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
 * WHY ASK AT ALL. Three things in the app are worse with an empty profile and
 * none of them says so at the moment it matters. `draft/template.ts` substitutes
 * your name into a cover letter and leaves `[YOUR NAME]` standing when it has
 * none; the scout scores against target roles and regions and reports "not
 * scored" without them; Transfer refuses to send a profile that is blank. Each
 * of those is a dead end reached long after the moment a name could have been
 * typed in eight seconds.
 *
 * WHY ONLY FOUR. `ProfileText` has ten fields. Six of them — website, Scholar,
 * GitHub, LinkedIn, target roles, regions — are worth having and none is worth
 * a stranger's patience on their first minute. These four are the ones a draft
 * substitutes and a header prints. The rest are one link away and the footer
 * says so.
 *
 * WHY IT IS SKIPPABLE, when `FirstRunChoice` before it is not. There, a
 * dismissal would silently be a choice: the store already holds one of the two
 * data sets, so Escape picks one by reflex. Here there IS a neutral answer —
 * "not now" leaves the profile exactly as blank as it already was, which is a
 * state the app handles everywhere. A question with a real neutral answer must
 * offer it, or it is a hostage-taking rather than a form.
 *
 * NOTHING IS REQUIRED, including the name. Save writes whatever is filled in and
 * leaves the rest. A validation error on a welcome screen is a strange first
 * thing to do to someone, and there is no field here whose absence breaks
 * anything that was not already broken by the profile being blank.
 */
export function WelcomeDetails({
  open,
  fresh,
  onDone,
}: {
  open: boolean
  /** This session came through the first-run fork. See the note on `draft`. */
  fresh: boolean
  onDone: () => void
}) {
  const { profile, update } = useProfile()
  // Blank on a first run, whatever the store holds.
  //
  // Choosing the demo records seeds a whole profile, so prefilling would put
  // 'Shaswata Mitra' in a field labelled "Full name" and a stranger's address in
  // "Email" — a form answering its own questions with somebody else's answers.
  // `routes/Profile.tsx` makes the same point about placeholders: grey examples
  // ask a question, black text answers one.
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

  const set = (key: keyof typeof draft) => (event: { target: { value: string } }) => {
    setDraft((prev) => ({ ...prev, [key]: event.target.value }))
  }

  const save = () => {
    /*
     * On a first run the four answers REPLACE the text block; otherwise they are
     * spread over it.
     *
     * The difference is the demo profile. Spreading on a fresh install would
     * leave the demo's website, Scholar, GitHub and LinkedIn attached to the
     * user's own name — a profile half theirs and half a fixture's, which is
     * worse than either. Off a first run the other six fields are the user's
     * own and must survive a form that never showed them.
     */
    update({ text: fresh ? { ...BLANK_TEXT, ...draft } : { ...profile.text, ...draft } })
    onDone()
  }

  const anything = Object.values(draft).some((v) => v.trim().length > 0)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing by Escape or the backdrop is "not now", not a save. It is the
        // same outcome as the Skip button and is recorded the same way.
        if (!next) onDone()
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserRound className="size-4 text-accent" strokeWidth={1.8} aria-hidden />A little about
            you
          </DialogTitle>
          <DialogDescription>
            Drafts sign off with your name, and the scout scores against what you are looking for.
            All of it stays on this machine, and all of it is optional — you can fill it in later
            under Profile.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <Field
            label="Full name"
            value={draft.fullName}
            autoComplete="name"
            autoFocus
            placeholder="e.g. Shaswata Mitra"
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
            placeholder="e.g. Santa Clara, CA"
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

          <DialogFooter className="mt-1 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={onDone}>
              Skip for now
            </Button>
            {/* Disabled only when there is genuinely nothing to write, so the
                button never claims to have saved an empty form. Skip is right
                there and does the same thing honestly. */}
            <Button type="submit" disabled={!anything}>
              Save and continue
            </Button>
          </DialogFooter>
        </form>

        <p className="text-xs text-text-3">
          The rest — links, target roles, the terms the scout matches on — lives under{' '}
          {/* A router Link: a bare anchor skips `basename`, so this pointed at
              the domain root and 404ed wherever the app is served from a
              subpath — and it reloaded the document, which kills any agent run
              still working. */}
          <Link className="text-text-1 underline underline-offset-2" to={profilePath()}>
            Profile
          </Link>
          .
        </p>
      </DialogContent>
    </Dialog>
  )
}
