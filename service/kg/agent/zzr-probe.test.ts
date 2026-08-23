import { test } from 'vitest'
import { CATALOG, toFunctionSpec } from './catalog'
import { TOOLS } from '../tools/index'
import { READS } from './queries'

const specLen = (n: string) => JSON.stringify(toFunctionSpec(CATALOG.find((e) => e.name === n)!)).length
const tokOf = (names: readonly string[]) => Math.round([...new Set(names)].map(specLen).reduce((a, b) => a + b, 0) / 3.6)
const READ_NAMES = Object.keys(READS)

/* dependency data */
const walk = (meta: any, out: Set<string>) => {
  if (!meta || typeof meta !== 'object') return
  if (meta.kind === 'id' && meta.nodeType && !meta.optional) out.add(meta.nodeType)
  const kids = meta.fields ?? meta.of ?? meta.item ?? meta.items
  if (kids) {
    if (Array.isArray(kids)) kids.forEach((k: any) => { walk(k, out) })
    else if (kids.kind) walk(kids, out)
    else for (const v of Object.values(kids)) walk(v as any, out)
  }
}
const NEEDS: Record<string, string[]> = {}
const TOUCH: Record<string, string[]> = {}
for (const t of Object.values(TOOLS) as any[]) {
  const s = new Set<string>(); walk(t.input.meta, s); NEEDS[t.name] = [...s]; TOUCH[t.name] = t.touches
}
const PRODUCERS: Record<string, string[]> = {}
for (const t of Object.values(TOOLS) as any[]) {
  if (t.effect !== 'create') continue
  for (const ty of t.touches) (PRODUCERS[ty] ??= []).push(t.name)
}

/* ---------------------------- the retriever ------------------------------- */
const STOP = new Set('a an the my me i to for of and or on in it that this is was with from at as add put set new'.split(' '))
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const words = (s: string) => fold(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w))
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, '')

const DOCS = CATALOG.map((e) => {
  const bag = new Map<string, number>()
  const push = (s: string, weight: number) => { for (const w of words(s)) bag.set(stem(w), (bag.get(stem(w)) ?? 0) + weight) }
  push(e.name.replaceAll('.', ' '), 3)
  push(e.title, 2)
  push(e.summary, 1)
  return { name: e.name, bag }
})
const DF = new Map<string, number>()
for (const d of DOCS) for (const w of d.bag.keys()) DF.set(w, (DF.get(w) ?? 0) + 1)
const idf = (w: string) => Math.log(1 + DOCS.length / (1 + (DF.get(w) ?? 0)))

function rank(query: string) {
  const qs = [...new Set(words(query).map(stem))]
  return DOCS.map((d) => ({
    name: d.name,
    score: qs.reduce((acc, w) => acc + (d.bag.get(w) ?? 0) * idf(w), 0),
  })).sort((a, b) => b.score - a.score)
}

const ALWAYS = [...READ_NAMES, 'org.ensure', 'keyword.create']

function retrieve(query: string, k: number) {
  const top = rank(query).filter((r) => r.score > 0 && !READ_NAMES.includes(r.name)).slice(0, k).map((r) => r.name)
  const set = new Set([...ALWAYS, ...top])
  // domain completion: any domain with a hit gets its whole domain
  const doms = new Set(top.map((n) => n.split('.')[0]))
  for (const e of CATALOG) if (doms.has(e.name.split('.')[0])) set.add(e.name)
  // closure: everything selected can get the ids it requires
  for (const n of [...set]) for (const ty of NEEDS[n] ?? []) for (const p of PRODUCERS[ty] ?? []) set.add(p)
  return [...set]
}

/* -------------------------------- goldens --------------------------------- */
const GOLD: [string, string[]][] = [
  ['Add my Rice application and tag it rust and systems', ['application.create', 'keyword.create', 'keyword.attach']],
  ['File this offer letter under Rice and tag it offer', ['vault.file.add', 'keyword.attach', 'keyword.create']],
  ['Move Rice to interview and put Thursday on my calendar', ['application.stage.set', 'application.stage.advance', 'timeline.item.create']],
  ['actually that was Baylor, not Rice', ['application.update', 'org.ensure']],
  ['I heard back from Rice, log it', ['timeline.item.create', 'application.update']],
  ['save this job posting link for later', ['vault.link.save', 'scout.posting.save']],
  ['delete the Baylor application', ['application.delete']],
  ['draft a follow-up email snippet for the Rice interview', ['vault.snippet.create']],
  ['rename my saved search to Bay Area postdocs', ['scout.pipeline.update', 'scout.pipeline.rename']],
  ['set a reminder to chase the Duke recruiter next Tuesday', ['timeline.item.create']],
  ['archive everything from last year', ['application.archive', 'application.update']],
  ['update my profile with the new CV', ['profile.set', 'profile.document.add']],
  ['turn that posting into a real application', ['scout.posting.promote']],
  ['mark the Rice offer as accepted', ['application.offer.decide', 'application.stage.advance', 'application.update']],
  ['what happened with Rice?', []],
]

test('retriever', () => {
  console.log('full catalog tok', tokOf(CATALOG.map((e) => e.name)))
  console.log('ALWAYS floor tok', tokOf(ALWAYS), ALWAYS.length, 'tools')
  for (const k of [6, 10]) {
    let sizes: number[] = []; let miss = 0; let total = 0
    for (const [q, need] of GOLD) {
      const set = retrieve(q, k)
      sizes.push(tokOf(set))
      const gotAny = need.length === 0 || need.some((n) => set.includes(n))
      const hits = need.filter((n) => set.includes(n))
      total += 1; if (!gotAny) miss += 1
      if (k === 10) console.log(`k=${k} [${set.length} tools ${tokOf(set)} tok] ${gotAny ? 'HIT' : 'MISS'} (${hits.length}/${need.length}) :: ${q}`)
    }
    const avg = Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length)
    console.log(`k=${k} avg ${avg} tok, max ${Math.max(...sizes)}, min ${Math.min(...sizes)}, misses ${miss}/${total}`)
  }
})
