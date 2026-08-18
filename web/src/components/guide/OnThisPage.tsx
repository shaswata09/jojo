/**
 * The jump list both guide pages open with.
 *
 * It was two files with the same name — `overview/OnThisPage.tsx` and
 * `screens/OnThisPage.tsx` — whose `<nav>/<ul>/<li>/<a>` tree and 130-character
 * pill class were identical to the byte, differing only in the caption and in
 * which `SECTIONS` they read. Unlike `Go` in `screens/ScreenParts.tsx`, which
 * says outright that it is a deliberate second copy, neither of these gave a
 * reason: it was a paste. Two names for one component also means a reader
 * following an import has to check which folder they landed in.
 *
 * The caption is a prop rather than derived from `sections.length`, because the
 * two pages say different things with it — one labels the control, the other
 * counts what is behind it.
 */
export function OnThisPage({
  sections,
  caption,
}: {
  sections: readonly { id: string; label: string }[]
  caption: string
}) {
  return (
    <nav aria-label="On this page" className="surface rounded-lg px-4 py-3 sm:px-5">
      <p className="mb-2 text-xs text-text-3">{caption}</p>
      <ul className="flex flex-wrap gap-1.5">
        {sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className="pressable inline-block rounded-full border border-hairline bg-well px-2.5 py-1 text-xs text-text-2 transition-colors duration-150 hover:border-hairline-strong hover:text-text-1"
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
