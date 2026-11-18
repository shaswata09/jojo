import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DEVICE_LOCALE, LOCALES, localeInfo } from '@jojo/service/core/locale'
import type { LocaleChoice } from '@jojo/service/core/locale'
import { useLocale } from '@/i18n/locale-context'
import { MascotCredit, StrokeLegend } from '@/components/brand/MascotMoves'
import { RobotMascot } from '@/components/brand/RobotMascot'
import { SettingRow } from '@/components/common/Field'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Segment } from '@/components/common/Segment'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { GESTURES, useMascot } from '@/lib/mascot-context'
import { isSoundEnabled, playSwitchClick, setSoundEnabled } from '@/lib/sound'
import { useTheme, type ThemePref } from '@/lib/theme-context'

/** The theme choices, by catalog key — labelled where they are rendered, in the reader's language. */
const THEMES = ['light', 'dark', 'system'] as const satisfies readonly ThemePref[]

export function AppearancePanel() {
  const { t } = useTranslation('settings')
  const themes = THEMES.map((value) => ({ value, label: t(`appearance.theme.${value}`) }))
  const { pref, setPref } = useTheme()
  const { pose, seq, play } = useMascot()
  const [sound, setSound] = useState(isSoundEnabled)

  return (
    <Panel focusId="appearance">
      <PanelTitle>{t('appearance.title')}</PanelTitle>
      <SettingRow
        focusId="appearance-theme"
        label={t('appearance.theme.label')}
        description={t('appearance.theme.description')}
        control={
          <Segment
            label={t('appearance.theme.label')}
            options={themes}
            value={pref}
            onChange={setPref}
          />
        }
      />
      <LanguageRow />
      <SettingRow
        focusId="appearance-gestures"
        label={t('appearance.gestures.label')}
        description={t('appearance.gestures.description')}
        control={
          <div className="flex items-center justify-end gap-3">
            {/* A local preview, rather than telling you to go look at the
                sidebar — below `lg` the sidebar is a closed drawer, so that
                instruction would have been a lie on every phone. */}
            {/* Dark plate in both themes, for the same reason favicon.svg has
                one: the robot is light grey, so on the light theme's #f5f5f5
                well it would all but disappear. */}
            <span className="grid size-14 shrink-0 place-items-center rounded-md bg-[#171717]">
              <RobotMascot pose={pose} seq={seq} className="size-11" />
            </span>
            {/* Narrower on phones. SettingRow's control cell takes its
                content's width (and wraps under the text when that does not
                fit), so whatever this measures is a floor for the row — at 72
                the ten gestures plus the robot plate pushed the Settings page
                into a sideways scroll. Wrapping into an extra line costs
                nothing; the page scrolling does not.
                56 was still too wide at 320px, the narrowest viewport WCAG
                reflow asks about: 56 + the 14 plate + the gap left the label
                column no room and the page scrolled sideways again. 36 fits two
                gestures a line there and the `sm:` step restores the rest. */}
            <div className="flex max-w-36 flex-wrap justify-end gap-1.5 min-[380px]:max-w-56 sm:max-w-72">
              {GESTURES.map(({ pose: g, label }) => (
                <Button key={g} variant="outline" size="sm" onClick={() => play(g)}>
                  {label}
                </Button>
              ))}
            </div>
          </div>
        }
      />
      {/* The same strokes the sidebar card reads (lib/gesture-pad.ts), and
          the model's credit, which the card's moves button also shows. */}
      <SettingRow
        focusId="appearance-draw"
        label={t('appearance.draw.label')}
        description={t('appearance.draw.description')}
        control={
          <StrokeLegend className="max-w-36 grid-cols-1 min-[380px]:max-w-56 sm:max-w-none lg:grid-cols-2" />
        }
      />
      <div className="border-t border-hairline py-3">
        <MascotCredit />
      </div>
      <SettingRow
        focusId="appearance-sounds"
        label={t('appearance.sounds.label')}
        description={t('appearance.sounds.description')}
        control={
          <Switch
            checked={sound}
            onCheckedChange={(on) => {
              setSoundEnabled(on)
              setSound(on)
              // Play on enable so you hear exactly what you just turned on.
              if (on) playSwitchClick()
            }}
            aria-label={t('appearance.sounds.label')}
          />
        }
      />
    </Panel>
  )
}

/**
 * The language picker. Each language is named in itself — "Deutsch", "日本語" —
 * because a person looking for theirs in a list written in a language they do
 * not read can still find their own name for it.
 */
function LanguageRow() {
  const { t } = useTranslation()
  const { choice, device, setChoice } = useLocale()
  return (
    <SettingRow
      focusId="appearance-language"
      label={t('language.label')}
      description={t('language.description')}
      control={
        <select
          aria-label={t('language.label')}
          // Up to 18rem: the row stacks on a phone now, so there is room for
          // "Same as this browser (…)" whole rather than cut at 14rem
          // (finding responsive-1).
          className="h-9 w-full max-w-72 rounded-md border border-hairline bg-panel px-2.5 text-sm"
          value={choice}
          onChange={(e) => setChoice(e.target.value as LocaleChoice)}
        >
          <option value={DEVICE_LOCALE}>
            {t('language.system', { name: localeInfo(device).native })}
          </option>
          {LOCALES.map((l) => (
            <option key={l.code} value={l.code} lang={l.code}>
              {l.native}
            </option>
          ))}
        </select>
      }
    />
  )
}
