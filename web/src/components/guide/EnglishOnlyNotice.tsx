import { useTranslation } from 'react-i18next'

/**
 * One translated sentence at the top of the developer reference pages — Built
 * with, Control flow graph and Licence — saying the page is in English.
 *
 * Those pages stay English by design: they name packages, modules and licence
 * terms in the words they are written in, and a licence is only binding in its
 * own text. The guide's nav and blurbs for them were translated while the pages
 * were not, so a reader arrived with no word of why the language changed.
 * Nothing is shown to an English reader, who has nothing to be told.
 */
export function EnglishOnlyNotice() {
  const { t, i18n } = useTranslation('guide')
  if (i18n.language === 'en' || i18n.language.startsWith('en-')) return null
  return (
    <p lang={i18n.language} className="text-sm text-text-2">
      {t('englishOnly')}
    </p>
  )
}
