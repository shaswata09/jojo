/**
 * The width a modal that holds CONTENT asks for.
 *
 * Three quarters of the page's centre column — the arithmetic is
 * `--modal-width` in `index.css`, which is where the shell's own measurements
 * are transcribed. A class string rather than a component prop, for the same
 * reason `openRail` is one: two call sites drawing the same thing from one
 * constant cannot drift, and a dialog that wants something else simply does
 * not use it.
 *
 * ## Which dialogs take it, and which do not
 *
 * Anything holding a form or structured content: the event editor, an
 * application, a draft, the scout's pipelines, the setup and onboarding steps,
 * a tool run.
 *
 * NOT the small decision dialogs — "Delete this application?", the pipeline
 * shutdown offer, the data confirmations. A question with two buttons stretched
 * across 861 pixels puts its answer a long way from its text, and the width
 * would say the choice was bigger than it is. Not the command palette or
 * Spotlight either: both size themselves to a list of results, and both were
 * already deliberate. Not `FullScreen`, which is the window.
 *
 * `sm:` because below that breakpoint the shared `max-w-[calc(100%-2rem)]` in
 * `dialog.tsx` is already the right answer — the whole screen, less a margin.
 */
export const contentModal = 'sm:max-w-[var(--modal-width)]'
