import { intlLocale } from '@jojo/service/core/intl-locale'
import type { TFunction } from 'i18next'

/**
 * The spoken name of a legend row: "Job scout: 4, 33%".
 *
 * The row draws the count and its percentage as two spans with only a margin
 * between them, so a name computed from the content glued them into one
 * number — "Job scout 433%". The label is set explicitly instead, from the
 * catalog's punctuation and the locale's own percent format.
 */
export function legendName(
  t: TFunction,
  language: string,
  label: string,
  count: number,
  percent: number,
): string {
  let formatted: string
  try {
    formatted = new Intl.NumberFormat(intlLocale(language), {
      style: 'percent',
      maximumFractionDigits: 0,
    }).format(percent / 100)
  } catch {
    formatted = `${String(percent)}%`
  }
  return t('charts:legend.item', { label, count, percent: formatted })
}
