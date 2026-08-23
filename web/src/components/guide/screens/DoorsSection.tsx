import type { ReactNode } from 'react'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Kbd } from '@/components/guide/Kbd'
import { Doors } from '@/components/guide/screens/Doors'
import { Code, Go } from '@/components/guide/screens/ScreenParts'
import { S } from '@/components/guide/screens/sections'
import {
  applicationsPath,
  assistantPath,
  calendarPath,
  dashboardPath,
  graphPath,
  guidePath,
  profilePath,
  scoutPath,
  settingsPath,
  statisticsPath,
  transferPath,
  vaultPath,
} from '@/lib/links'

/** Every route, and the control that opens it. */
const DOORS: { name: ReactNode; where: ReactNode }[] = [
  {
    name: <Go to={dashboardPath()}>Today</Go>,
    where: 'Sidebar, first row. Also what jojo opens on.',
  },
  {
    name: <Go to={applicationsPath()}>Applications</Go>,
    where: 'Sidebar. Its badge counts records you have flagged for follow-up.',
  },
  {
    name: <Go to={calendarPath()}>Calendar</Go>,
    where: 'Sidebar. Its badge counts what is scheduled in the next seven days.',
  },
  {
    name: <Go to={vaultPath()}>Vault</Go>,
    where: (
      <>
        Sidebar. Its badge counts reminders past their date. <Code>/reminders</Code> redirects here,
        which is where that page went.
      </>
    ),
  },
  {
    name: <Go to={scoutPath()}>Job scout</Go>,
    where: 'Sidebar. Its badge counts matches nobody has turned into an application yet.',
  },
  { name: <Go to={statisticsPath()}>Statistics</Go>, where: 'Sidebar, last row.' },
  {
    name: <Go to={graphPath()}>Graph</Go>,
    where: (
      <>
        The tile marked <span className="text-text-1">Browser storage</span>, at the foot of the
        sidebar. Nothing else in the app calls it the Graph, which is why this is the hardest page
        in jojo to find by accident.
      </>
    ),
  },
  {
    name: <Go to={transferPath()}>Transfer</Go>,
    where: (
      <>
        The tile marked <span className="text-text-1">Transfer</span>, and{' '}
        <Go to={settingsPath()}>Settings &rarr; Your data</Go>.
      </>
    ),
  },
  { name: <Go to={profilePath()}>My profile</Go>, where: 'The person icon in the top bar.' },
  { name: <Go to={assistantPath()}>Assistant</Go>, where: 'The robot icon in the top bar.' },
  {
    name: <Go to={settingsPath()}>Settings</Go>,
    where: (
      <>
        The gear icon in the top bar. The <span className="text-text-1">Local model</span> tile
        lands here too — it is where that is configured.
      </>
    ),
  },
  {
    name: <Go to={guidePath()}>This guide</Go>,
    where: 'The question mark, last icon in the top bar. It is not in the sidebar.',
  },
]

export function DoorsSection() {
  return (
    <Panel id={S.doors} className="scroll-mt-4">
      <PanelTitle hint="six pages are in the sidebar; six are not">Where each page is</PanelTitle>

      <p className="text-sm text-text-2">
        The sidebar lists six pages. Six more are reached from somewhere else entirely: an icon in
        the top bar, or one of the four status tiles at the foot of the sidebar, which look like
        readouts and are also buttons. Below a laptop width the sidebar is a drawer behind the menu
        button at the top left; the top bar is on every screen at every size.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[auto_1fr] lg:gap-6">
        <Doors />

        <div className="min-w-0">
          <h3 className="text-sm font-medium">Every route, and the control that opens it</h3>
          <dl className="mt-2 divide-y divide-hairline text-sm">
            {DOORS.map((door, index) => (
              <div key={index} className="flex flex-wrap gap-x-3 gap-y-1 py-2.5">
                <dt className="basis-28 font-medium">{door.name}</dt>
                <dd className="min-w-0 flex-1 basis-64 text-text-2">{door.where}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <p className="mt-3.5 text-sm text-text-2">
        There is one door that reaches all of them, and it is the reason the six hidden pages are an
        inconvenience rather than a problem: <Kbd>⌘K</Kbd> ends in a{' '}
        <span className="text-text-1">Go to</span> group listing every page, including each of this
        guide&rsquo;s four separately. <Go to={guidePath('overview')}>How to use jojo</Go> covers
        what else that palette does.
      </p>

      <h3 className="mt-4 text-sm font-medium">Two things that are true of every page</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-text-2 marker:text-text-3">
        <li>
          The switches behind the gear beside a page title — show notes, compact rows, dots instead
          of titles, show counts — change what that page draws and last for this visit only. They
          are not in the address bar and they are not saved; the theme and the sound switch in
          Settings are, and they are the exceptions.
        </li>
        <li>
          Where a page does keep state in the address, a value equal to what the page shows anyway
          is left out of it. That is why <Code>/applications</Code> and{' '}
          <Code>/applications?view=board&amp;stage=all&amp;sort=daysAgo</Code> are the same screen,
          and why the tidier of the two is the one you get when you clear a filter.
        </li>
      </ul>
    </Panel>
  )
}
