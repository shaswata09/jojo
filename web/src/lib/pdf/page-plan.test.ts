import { describe, expect, it } from 'vitest'
import {
  keepOnly,
  moveItem,
  movePage,
  planChanged,
  planFor,
  removePage,
  rotatePage,
  turn,
  type PagePlan,
} from './page-plan'

const sources = (plan: PagePlan) => plan.map((p) => p.source)
const turns = (plan: PagePlan) => plan.map((p) => p.rotation)

describe('the plan a document starts with', () => {
  it('is every page, in order, unturned', () => {
    expect(planFor(3)).toEqual([
      { source: 0, rotation: 0 },
      { source: 1, rotation: 0 },
      { source: 2, rotation: 0 },
    ])
  })

  it('is empty for a count that is not a page count', () => {
    expect(planFor(0)).toEqual([])
    expect(planFor(-1)).toEqual([])
    expect(planFor(1.5)).toEqual([])
  })
})

describe('turning a page', () => {
  it('lands on a quarter turn, both ways round', () => {
    expect(turn(0, 90)).toBe(90)
    expect(turn(270, 90)).toBe(0)
    expect(turn(0, -90)).toBe(270)
    expect(turn(90, 180)).toBe(270)
  })

  it('wraps rather than running past 360, however many turns', () => {
    expect(turn(0, 360)).toBe(0)
    expect(turn(0, 450)).toBe(90)
    expect(turn(0, -450)).toBe(270)
  })

  it('rounds a delta that is not a quarter turn instead of failing a click', () => {
    expect(turn(0, 89)).toBe(90)
    expect(turn(0, 46)).toBe(90)
  })

  it('turns one page and leaves its neighbours alone', () => {
    expect(turns(rotatePage(planFor(3), 1, 90))).toEqual([0, 90, 0])
  })

  it('ignores a page that is not there', () => {
    const plan = planFor(2)
    expect(rotatePage(plan, 5, 90)).toBe(plan)
  })
})

describe('moving a page', () => {
  it('takes it out and puts it back at the new position', () => {
    expect(sources(movePage(planFor(4), 0, 2))).toEqual([1, 2, 0, 3])
    expect(sources(movePage(planFor(4), 3, 0))).toEqual([3, 0, 1, 2])
  })

  it('carries the page’s rotation with it', () => {
    const turned = rotatePage(planFor(3), 2, 180)
    const moved = movePage(turned, 2, 0)
    expect(sources(moved)).toEqual([2, 0, 1])
    expect(turns(moved)).toEqual([180, 0, 0])
  })

  it('clamps at the ends, so "up" on the first row does nothing', () => {
    const plan = planFor(3)
    expect(movePage(plan, 0, -1)).toBe(plan)
    expect(movePage(plan, 2, 9)).toBe(plan)
  })

  it('ignores a page that is not there', () => {
    const plan = planFor(2)
    expect(movePage(plan, 7, 0)).toBe(plan)
  })

  it('moves anything else the same way — the merge list uses it too', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(moveItem(['a', 'b', 'c'], 0, 9)).toEqual(['b', 'c', 'a'])
    const list = ['a']
    expect(moveItem(list, 5, 0)).toBe(list)
  })
})

describe('removing a page', () => {
  it('drops it but leaves every other page pointing at its own original', () => {
    // The point of `source`: after a delete, slot 1 still says it came from
    // original page 2, so writing the PDF cannot copy the wrong page.
    expect(sources(removePage(planFor(4), 1))).toEqual([0, 2, 3])
  })

  it('ignores a page that is not there', () => {
    const plan = planFor(2)
    expect(removePage(plan, 2)).toBe(plan)
  })
})

describe('keeping only some pages', () => {
  it('keeps them in the order asked for, with their rotations', () => {
    const turned = rotatePage(planFor(4), 3, 90)
    const kept = keepOnly(turned, [3, 0])
    expect(sources(kept)).toEqual([3, 0])
    expect(turns(kept)).toEqual([90, 0])
  })

  it('skips a source that is no longer in the plan', () => {
    expect(sources(keepOnly(removePage(planFor(3), 1), [0, 1, 2]))).toEqual([0, 2])
  })
})

describe('whether there is anything to save', () => {
  it('is false for a document nobody has touched', () => {
    expect(planChanged(planFor(5), 5)).toBe(false)
  })

  it('is true once a page is turned, moved or dropped', () => {
    expect(planChanged(rotatePage(planFor(5), 0, 90), 5)).toBe(true)
    expect(planChanged(movePage(planFor(5), 0, 1), 5)).toBe(true)
    expect(planChanged(removePage(planFor(5), 0), 5)).toBe(true)
  })

  it('is true when a page was dropped and another added back to the same count', () => {
    // Same length as the original, so the length check alone would miss it.
    expect(planChanged(keepOnly(planFor(3), [0, 1, 1]), 3)).toBe(true)
  })
})
