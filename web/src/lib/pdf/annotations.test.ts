import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COLOUR,
  HIGHLIGHT_COLOURS,
  colourById,
  excerpt,
  hexToPdfRgb,
  onPage,
  summarise,
  without,
  type Annotation,
} from './annotations'

const highlight = (id: string, page: number): Annotation => ({
  id,
  kind: 'highlight',
  page,
  quads: [[0, 0, 1, 0, 0, 1, 1, 1]],
  colourId: 'yellow',
  text: 'some words',
  note: '',
})
const note = (id: string, page: number): Annotation => ({
  id,
  kind: 'note',
  page,
  at: { x: 10, y: 20 },
  body: 'a comment',
})

describe('a highlight colour as PDF components', () => {
  it('is 0-1 floats, not bytes', () => {
    /*
     * The failure this pins is silent: a `/C` array of [255, 225, 77] is out of
     * range, viewers clamp it to white, and the highlight looks like it was
     * never written rather than like it is the wrong colour.
     */
    for (const component of hexToPdfRgb('#ffe14d')) {
      expect(component).toBeGreaterThanOrEqual(0)
      expect(component).toBeLessThanOrEqual(1)
    }
    expect(hexToPdfRgb('#ffffff')).toEqual([1, 1, 1])
    expect(hexToPdfRgb('#000000')).toEqual([0, 0, 0])
  })

  it('reads the channels in the right order', () => {
    expect(hexToPdfRgb('#ff0000')).toEqual([1, 0, 0])
    expect(hexToPdfRgb('#00ff00')).toEqual([0, 1, 0])
    expect(hexToPdfRgb('#0000ff')).toEqual([0, 0, 1])
  })

  it('takes the short form, with or without the hash', () => {
    expect(hexToPdfRgb('#f00')).toEqual(hexToPdfRgb('#ff0000'))
    expect(hexToPdfRgb('ff0000')).toEqual(hexToPdfRgb('#ff0000'))
    expect(hexToPdfRgb('  #FF0000  ')).toEqual(hexToPdfRgb('#ff0000'))
  })

  it('falls back to black rather than writing NaN into the file', () => {
    for (const bad of ['', 'rebeccapurple', '#12345', '#gggggg']) {
      const rgb = hexToPdfRgb(bad)
      expect(rgb).toEqual([0, 0, 0])
      for (const component of rgb) expect(Number.isFinite(component)).toBe(true)
    }
  })

  it('converts every colour the palette offers', () => {
    for (const colour of HIGHLIGHT_COLOURS) {
      const rgb = hexToPdfRgb(colour.hex)
      expect(rgb.some((component) => component > 0)).toBe(true)
    }
  })
})

describe('looking a colour up', () => {
  it('finds one by id', () => {
    expect(colourById('blue').label).toBe('Blue')
  })

  it('falls back to the default for an id that is gone', () => {
    // A document annotated by an older build can name a colour since removed.
    expect(colourById('chartreuse')).toBe(DEFAULT_COLOUR)
  })
})

describe('the annotations on a page', () => {
  it('are only that page’s', () => {
    const all = [highlight('a', 0), note('b', 1), highlight('c', 0)]
    expect(onPage(all, 0).map((a) => a.id)).toEqual(['a', 'c'])
    expect(onPage(all, 1).map((a) => a.id)).toEqual(['b'])
    expect(onPage(all, 2)).toEqual([])
  })
})

describe('removing one', () => {
  it('drops it and keeps the rest', () => {
    const all = [highlight('a', 0), note('b', 0)]
    expect(without(all, 'a').map((a) => a.id)).toEqual(['b'])
  })

  it('leaves the list alone for an id that is not in it', () => {
    const all = [highlight('a', 0)]
    expect(without(all, 'zzz')).toHaveLength(1)
  })
})

describe('saying what is about to be written', () => {
  it('counts the two kinds separately', () => {
    // "3 annotations" leaves a person wondering whether the comment took.
    expect(summarise([highlight('a', 0), highlight('b', 0), note('c', 0)])).toBe(
      '2 highlights and 1 comment',
    )
  })

  it('gets the singular right', () => {
    expect(summarise([highlight('a', 0)])).toBe('1 highlight')
    expect(summarise([note('a', 0)])).toBe('1 comment')
  })

  it('says so when there is nothing', () => {
    expect(summarise([])).toBe('nothing yet')
  })
})

describe('the excerpt shown in the list', () => {
  it('flattens the line breaks a PDF text layer is full of', () => {
    expect(excerpt('two   lines\nof  text')).toBe('two lines of text')
  })

  it('leaves a short one alone', () => {
    expect(excerpt('short')).toBe('short')
  })

  it('cuts at a word boundary when one is near the end', () => {
    const cut = excerpt('alpha bravo charlie delta echo foxtrot golf hotel', 30)
    expect(cut.endsWith('…')).toBe(true)
    expect(cut.length).toBeLessThanOrEqual(31)
    expect(cut).not.toMatch(/\s…$/)
  })

  it('still cuts when there is no boundary to cut at', () => {
    const cut = excerpt('x'.repeat(90), 20)
    expect(cut).toBe(`${'x'.repeat(20)}…`)
  })
})
