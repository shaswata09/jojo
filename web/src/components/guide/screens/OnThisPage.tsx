import { SECTIONS } from '@/components/guide/screens/sections'

export function OnThisPage() {
  return (
    <nav aria-label="On this page" className="surface rounded-lg px-4 py-3 sm:px-5">
      <p className="mb-2 text-xs text-text-3">Thirteen sections — jump to the one you came for</p>
      <ul className="flex flex-wrap gap-1.5">
        {SECTIONS.map((section) => (
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
