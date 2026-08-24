import { useState } from 'react'
import { RobotMascot } from '@/components/brand/RobotMascot'
import { SettingRow } from '@/components/common/Field'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Segment } from '@/components/common/Segment'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { GESTURES, useMascot } from '@/lib/mascot-context'
import { isSoundEnabled, playSwitchClick, setSoundEnabled } from '@/lib/sound'
import { useTheme, type ThemePref } from '@/lib/theme-context'

const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const satisfies readonly { value: ThemePref; label: string }[]

export function AppearancePanel() {
  const { pref, setPref } = useTheme()
  const { pose, seq, play } = useMascot()
  const [sound, setSound] = useState(isSoundEnabled)

  return (
    <Panel>
      <PanelTitle>Appearance</PanelTitle>
      <SettingRow
        label="Theme"
        description="System follows your operating system setting"
        control={<Segment label="Theme" options={THEMES} value={pref} onChange={setPref} />}
      />
      <SettingRow
        label="Mascot gestures"
        description="jojo reacts as you work. Try one."
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
            {/* Narrower on phones. SettingRow's control cell is `shrink-0`,
                so whatever this measures is a hard floor for the row — at 72
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
      <SettingRow
        label="Interface sounds"
        description="A short click when you flip a switch"
        control={
          <Switch
            checked={sound}
            onCheckedChange={(on) => {
              setSoundEnabled(on)
              setSound(on)
              // Play on enable so you hear exactly what you just turned on.
              if (on) playSwitchClick()
            }}
            aria-label="Interface sounds"
          />
        }
      />
    </Panel>
  )
}
