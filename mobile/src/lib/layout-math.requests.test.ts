/**
 * Q072 — the phone app follows the device's orientation.
 *
 * The owner asked for the app to be "responsive to device rotation" and to
 * "leverage the orientation of phones and tablets". `layout-math.test.ts` owns
 * what the layout DOES at each size and orientation. What it cannot see is the
 * two things that decide whether a rotation reaches that arithmetic at all:
 *
 *   - neither native project locks the orientation, so the OS rotates the app;
 *   - `useLayout` reads `useWindowDimensions`, which re-renders on rotation,
 *     rather than a one-off `Dimensions.get`, which would keep the old width.
 *
 * D20: nothing is mounted. Narrow reads of the three files that hold those
 * decisions.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const read = (rel: string) => readFileSync(path.join(HERE, rel), 'utf8')

describe('rotation reaches the app', () => {
  it('leaves the Android activity free to rotate', () => {
    const manifest = read('../../android/app/src/main/AndroidManifest.xml')
    const activity = /<activity[^>]*android:name="\.MainActivity"[^>]*>/.exec(manifest)?.[0] ?? ''
    expect(activity).not.toBe('')
    // `unspecified` (or absent) lets the sensor decide; anything else is a lock.
    const lock = /android:screenOrientation="([^"]+)"/.exec(activity)?.[1]
    expect([undefined, 'unspecified', 'fullSensor', 'sensor', 'user', 'fullUser']).toContain(lock)
    // Handled in-process, so a rotation re-lays out rather than restarting.
    expect(activity).toMatch(/android:configChanges="[^"]*\borientation\b[^"]*\bscreenSize\b/)
  })

  it.each(['UISupportedInterfaceOrientations', 'UISupportedInterfaceOrientations~ipad'])(
    'lists both portrait and landscape under iOS %s',
    (key) => {
      const plist = read('../../ios/jojo/Info.plist')
      const block =
        new RegExp(`<key>${key.replace('~', '\\~')}</key>\\s*<array>([\\s\\S]*?)</array>`).exec(
          plist,
        )?.[1] ?? ''
      expect(block).toContain('UIInterfaceOrientationPortrait')
      expect(block).toContain('UIInterfaceOrientationLandscapeLeft')
      expect(block).toContain('UIInterfaceOrientationLandscapeRight')
    },
  )

  it('lays out from useWindowDimensions, which re-renders on rotation', () => {
    const hook = read('./use-layout.ts')
    expect(hook).toMatch(/const \{ width, height \} = useWindowDimensions\(\)/)
    expect(hook).not.toMatch(/Dimensions\.get\(/)
  })
})
