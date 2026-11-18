import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * A benchmark table on a translated guide page, kept in English and said so.
 *
 * Guide → Tools is a translated page, but the tables, the case explorer and the
 * speed figures on it report a benchmark: its case names, tool names, failure
 * labels and the models' own replies are what was run and recorded, in English,
 * and a translated header over an English transcript would describe something
 * that did not happen. So the block is marked `lang="en"` — a screen reader
 * pronounces it as English rather than reading English words with another
 * language's rules — and a reader in any other language is told why, in their
 * language, the way `EnglishOnlyNotice` does for the whole-page references.
 * Its numbers and dates are formatted as English too, to match the text around
 * them, rather than in whatever the browser happens to default to.
 */
export function EnglishData({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation('guide')
  const english = i18n.language === 'en' || i18n.language.startsWith('en-')
  return (
    <>
      {english ? null : (
        <p lang={i18n.language} className="mb-2 text-xs text-text-3">
          {t('englishData')}
        </p>
      )}
      <div lang="en">{children}</div>
    </>
  )
}
