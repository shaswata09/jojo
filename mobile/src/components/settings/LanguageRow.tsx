import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DEVICE_LOCALE, LOCALES, localeInfo } from '@jojo/service/core/locale'
import { SettingRow } from '@/components/ui/Field'
import { MenuSheet } from '@/components/ui/Menu'
import { useLocale } from '@/i18n/locale-context'

/**
 * The language picker, as a row that opens a sheet. Each language is named in
 * itself — "Deutsch", "日本語" — so a person can find theirs in a list written
 * in a language they do not read. The web's picker is the same list.
 */
export function LanguageRow() {
  const { t } = useTranslation()
  const { choice, locale, device, restartPending, setChoice } = useLocale()
  const [open, setOpen] = useState(false)
  const current =
    choice === DEVICE_LOCALE
      ? t('language.system', { name: localeInfo(device).native })
      : localeInfo(locale).native

  return (
    <>
      <SettingRow
        label={t('language.label')}
        description={
          restartPending
            ? // Said in the language just picked, about the direction it reads:
              // to Arabic or Urdu, right to left; back from them, left to right.
              `${current} · ${t(
                localeInfo(locale).dir === 'rtl' ? 'language.restartRtl' : 'language.restartLtr',
                { name: localeInfo(locale).native },
              )}`
            : `${current} · ${t('language.description')}`
        }
        onPress={() => setOpen(true)}
      />
      <MenuSheet
        open={open}
        onClose={() => setOpen(false)}
        title={t('language.label')}
        actions={[
          {
            id: DEVICE_LOCALE,
            label: t('language.system', { name: localeInfo(device).native }),
            checked: choice === DEVICE_LOCALE,
            onPress: () => setChoice(DEVICE_LOCALE),
          },
          ...LOCALES.map((l) => ({
            id: l.code,
            label: l.native,
            hint: l.english,
            checked: choice === l.code,
            onPress: () => setChoice(l.code),
          })),
        ]}
      />
    </>
  )
}
