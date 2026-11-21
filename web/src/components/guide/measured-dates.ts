/**
 * "Run on …" for a published evaluation, when its models were not all measured
 * on the same day.
 *
 * Both guide tables printed one date for every row, read from the payload's
 * `ranAt`. That stopped being true on 2026-11-21, when MiniMax M2.1 was added a
 * month after Gemma 4 and GPT-OSS (their servers were down, so it was run on
 * the build they had been measured on instead). A payload may now carry
 * `measured` — a date per model — and this says each model's own date, grouped
 * so that models sharing a day are named together. Without `measured`, or when
 * every model shares one day, it is the single date it always was.
 */
/**
 * Spelled out in English like the sentence it sits in (both tables are marked
 * `lang="en"`, see `EnglishData`) — not in whatever locale the browser
 * defaults to. In UTC, the zone the stamps are written in, so a run is dated
 * the same day for every reader and in every test machine's time zone.
 */
const DATE: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
}

export function measuredText(
  ranAt: string,
  measured: Readonly<Record<string, string>> | undefined,
  labelOf: (model: string) => string,
): string {
  const day = (iso: string) => new Date(iso).toLocaleDateString('en', DATE)
  if (!measured) return day(ranAt)
  const byDay = new Map<string, string[]>()
  for (const [model, at] of Object.entries(measured)) {
    const d = day(at)
    byDay.set(d, [...(byDay.get(d) ?? []), labelOf(model)])
  }
  if (byDay.size === 1) return [...byDay.keys()][0]!
  return [...byDay.entries()].map(([d, names]) => `${d} (${names.join(' and ')})`).join(', ')
}

/** "one vLLM server", "three vLLM servers" — the count the footer used to hard-code. */
export function serversText(count: number): string {
  const words = ['no', 'one', 'two', 'three', 'four', 'five', 'six']
  const n = words[count] ?? String(count)
  return `${n} vLLM server${count === 1 ? '' : 's'}`
}
