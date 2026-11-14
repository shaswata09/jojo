import { describe, expect, it } from 'vitest'
import type { Active, Over } from '@dnd-kit/core'
import { dragAnnouncements } from '@/components/common/drag-announcements'
import { dayDropLabel } from '@/components/calendar/drop-target'

const UUID = '3f9c2b1e-0d7a-4c1b-9a3e-5b6f7c8d9e0f'
const active = (id: string) => ({ id }) as unknown as Active
const over = (id: string) => ({ id }) as unknown as Over

const say = dragAnnouncements({
  item: (id) => (id === UUID ? 'Rice University — Assistant professor' : undefined),
  target: (id) => (id === 'submitted' ? 'the Submitted column' : undefined),
})

describe('dragAnnouncements', () => {
  it('names the item and the target, never the id', () => {
    const lines = [
      say.onDragStart({ active: active(UUID) }),
      say.onDragOver({ active: active(UUID), over: over('submitted') }),
      say.onDragEnd({ active: active(UUID), over: over('submitted') }),
      say.onDragCancel({ active: active(UUID), over: null }),
    ]
    expect(lines[0]).toBe('Picked up Rice University — Assistant professor.')
    expect(lines[1]).toBe('Rice University — Assistant professor is over the Submitted column.')
    expect(lines[2]).toBe(
      'Rice University — Assistant professor was dropped on the Submitted column.',
    )
    for (const line of lines) expect(line).not.toContain(UUID)
  })

  it('falls back to plain words when a lookup misses, not to the id', () => {
    const gone = say.onDragOver({ active: active('deleted-id'), over: over('day:2026-11-02') })
    expect(gone).toBe('The item is over a drop target.')
    expect(gone).not.toContain('deleted-id')
  })

  it('says where an item went when it left every target', () => {
    expect(say.onDragOver({ active: active(UUID), over: null })).toBe(
      'Rice University — Assistant professor is no longer over a drop target.',
    )
    expect(say.onDragEnd({ active: active(UUID), over: null })).toBe(
      'Rice University — Assistant professor was dropped where it started.',
    )
  })
})

describe('dayDropLabel', () => {
  it('reads a day cell the way its buttons do', () => {
    expect(dayDropLabel('day:2026-11-02')).toBe('November 2')
    expect(dayDropLabel('day:2026-13-02')).toBeUndefined()
    expect(dayDropLabel('3f9c2b1e')).toBeUndefined()
  })
})
