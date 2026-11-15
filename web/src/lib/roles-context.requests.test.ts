import { describe, expect, it } from 'vitest'
import type { RoleTag } from '@/data/seed'
import { roleMatches, scopeByRoles, toggledRole } from '@/lib/roles-context'
import roleFilter from '@/components/layout/RoleFilter.tsx?raw'

/**
 * Q024 — the Academia/Industry toggle was replaced by the user's own role tags,
 * multi-selected.
 *
 * This file pins the selection and what it lets through. Where the filter
 * sits (the top bar, since the owner moved it back on 2026-11-15) is pinned in
 * `Topbar.requests.test.ts`, and which charts read the narrowed records in
 * `roles-scope.requests.test.ts`.
 */
const role = (r: string) => r as RoleTag

describe('selecting role tags (Q024)', () => {
  it('adds a second tag beside the first rather than replacing it', () => {
    const one = toggledRole(new Set(), role('Postdoc'))
    const two = toggledRole(one, role('Researcher'))
    expect([...two].sort()).toEqual(['Postdoc', 'Researcher'])
  })

  it('takes a tag off when it is picked again', () => {
    const both = new Set([role('Postdoc'), role('Researcher')])
    expect([...toggledRole(both, role('Postdoc'))]).toEqual(['Researcher'])
  })

  it('does not change the selection it was handed', () => {
    const before = new Set([role('Postdoc')])
    toggledRole(before, role('Researcher'))
    expect([...before]).toEqual(['Postdoc'])
  })

  it('shows records with any selected tag, and everything when none is selected', () => {
    const picked = new Set([role('Postdoc'), role('Researcher')])
    expect(roleMatches(picked, role('Postdoc'))).toBe(true)
    expect(roleMatches(picked, role('Researcher'))).toBe(true)
    expect(roleMatches(picked, role('Developer'))).toBe(false)
    expect(roleMatches(new Set(), role('Developer'))).toBe(true)
  })

  it('offers the user’s own role vocabulary, with no Academia/Industry choice', () => {
    const code = roleFilter.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    expect(code).toMatch(/const vocabulary = useRoleVocabulary\(\)/)
    expect(code).not.toMatch(/academia|industry/i)
  })
})

describe('what the charts count under a role selection (Q024)', () => {
  const app = (id: string, roleTag: string, stage: string, source?: string) => ({
    id,
    roleTag: role(roleTag),
    stage,
    source,
  })
  const all = [
    app('a', 'Postdoc', 'submitted', 'Referral'),
    app('b', 'Postdoc', 'interview', 'Job board'),
    app('c', 'Researcher', 'submitted', 'Job board'),
    app('d', 'Developer', 'offer', 'Referral'),
  ]
  const base = {
    all,
    stageCounts: ['submitted', 'interview', 'offer', 'draft'].map((id) => ({
      id,
      label: id,
      count: all.filter((a) => a.stage === id).length,
    })),
    sourceCounts: ['Referral', 'Job board', 'Other'].map((source) => ({
      source,
      count: all.filter((a) => a.source === source).length,
    })),
  }

  it('counts every record, as the very same lists, when no role is selected', () => {
    const scoped = scopeByRoles(base, new Set())
    expect(scoped.all).toBe(base.all)
    expect(scoped.stageCounts).toBe(base.stageCounts)
    expect(scoped.sourceCounts).toBe(base.sourceCounts)
  })

  it('counts only the records under the selected roles, stage and source alike', () => {
    const scoped = scopeByRoles(base, new Set([role('Postdoc'), role('Developer')]))
    expect(scoped.all.map((a) => a.id)).toEqual(['a', 'b', 'd'])
    expect(scoped.stageCounts.map((s) => [s.id, s.count])).toEqual([
      ['submitted', 1],
      ['interview', 1],
      ['offer', 1],
      ['draft', 0],
    ])
    expect(scoped.sourceCounts.map((s) => [s.source, s.count])).toEqual([
      ['Referral', 2],
      ['Job board', 1],
      ['Other', 0],
    ])
  })
})
