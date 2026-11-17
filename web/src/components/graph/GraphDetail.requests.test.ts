/**
 * Review finding i18n-4: the "Open {{type}}" button lowercased the translated
 * type name, so German read "bewerbung öffnen". The phrase is now whole per
 * type, from the catalog, with no case change in code.
 */

import { describe, expect, it } from 'vitest'
import source from './GraphDetail.tsx?raw'
import de from '@/i18n/locales/de/graph.json'
import en from '@/i18n/locales/en/graph.json'
import { GRAPH_NODE_TYPES } from '@/lib/graph/model'

describe('the open button on a selected record (i18n-4)', () => {
  it('reads a whole phrase per type and changes no case', () => {
    expect(source).toContain('t(`detail.openType.${node.type}`)')
    expect(source).not.toContain('.toLowerCase()')
  })

  it('has a phrase for every node type', () => {
    for (const type of GRAPH_NODE_TYPES) {
      expect(en.detail.openType[type], type).toBeTruthy()
    }
  })

  it('keeps German nouns capitalised', () => {
    expect(de.detail.openType.application).toBe('Bewerbung öffnen')
  })
})
