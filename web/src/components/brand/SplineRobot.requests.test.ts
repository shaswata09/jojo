import { describe, expect, it } from 'vitest'
import splineRobot from '@/components/brand/SplineRobot.tsx?raw'
import splite from '@/components/ui/splite.tsx?raw'

/**
 * The sidebar mascot's loading and tracking (G6). Protected design — the 3D
 * robot, its size and its motion are the owner's; these pin the requests that
 * shaped how it loads, so none of them can come back unnoticed.
 *
 * Source reads (D20: no mounting, and there is no WebGL in a test anyway).
 */
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const robot = strip(splineRobot)
const scene = strip(splite)

/** The full-motion render, after the reduced-motion early return. */
const fullRender = robot.slice(robot.lastIndexOf('return ('))

/** The `onLoad` handler, from its declaration to the end of the function. */
const onLoad = robot.slice(robot.indexOf('const onLoad = '), robot.indexOf('if (reduced) {\n    return'))

describe('the 3D mascot', () => {
  it('renders the Spline scene served from this app (Q015, Q149)', () => {
    expect(fullRender).toMatch(/<SplineScene\b/)
    // Through `publicUrl`, so it resolves under the GitHub Pages base path and
    // the 2D fallback does not take over on the deployed site.
    expect(robot).toMatch(/const SCENE = publicUrl\('mascot\.splinecode'\)/)
    expect(fullRender).toMatch(/scene=\{SCENE\}/)
  })

  it('follows the cursor across the whole page, not just its card (Q016)', () => {
    expect(fullRender).toMatch(/<SplineScene[^>]*\bglobalEvents\b/)
    // …and the prop really reaches the runtime.
    expect(scene).toMatch(/if \(globalEvents\) app\.setGlobalEvents\(true\)/)
  })

  it('drives its own scripted gestures through the rig (Q031)', () => {
    expect(onLoad).toMatch(/rig\.current = createSplineRig\(app\)/)
    expect(robot).toMatch(/rig\.current\?\.play\(pose\)/)
  })

  it('does not show the 2D robot while the 3D one is still loading (Q032)', () => {
    // Nothing is waited on at first; the 2D mascot is only mounted once the
    // load has been written off, never as a placeholder.
    expect(robot).toMatch(/useState<'none' \| 'spinner' \| 'fallback'>\('none'\)/)
    expect(fullRender).toMatch(/waiting === 'fallback' \?\s*\(\s*<RobotMascot\b/)
    expect(fullRender.match(/<RobotMascot\b/g)).toHaveLength(1)
    const fallbackMs = Number(/const FALLBACK_MS = (\d+)/.exec(robot)?.[1])
    expect(fallbackMs).toBeGreaterThanOrEqual(5000)
  })

  it('throws away an earlier load before greeting, so the arrival does not shake (Q083)', () => {
    const disposeAt = onLoad.indexOf('rig.current?.dispose()')
    const clearAt = onLoad.indexOf('clearTimeout(greeting.current)')
    const createAt = onLoad.indexOf('createSplineRig(app)')
    expect(disposeAt).toBeGreaterThan(-1)
    expect(clearAt).toBeGreaterThan(-1)
    expect(createAt).toBeGreaterThan(Math.max(disposeAt, clearAt))
  })

  it('lets the scene finish its own zoom-out intro before the greeting (Q083)', () => {
    expect(onLoad).toMatch(/setTimeout\(\(\) => play\('bow'\), INTRO_SETTLE_MS\)/)
    const settle = Number(/const INTRO_SETTLE_MS = (\d+)/.exec(robot)?.[1])
    expect(settle).toBeGreaterThanOrEqual(1500)
  })
})
