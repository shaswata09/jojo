import report from '@/components/guide/tool-eval.json'

/**
 * What actually happened when real models were pointed at jojo's real tools.
 *
 * The numbers are generated, not written. `service/kg/agent/live-eval.test.ts`
 * runs every scenario against every model and writes the JSON this imports —
 * so a claim on this page cannot drift away from the run that produced it, and
 * re-running is what updates the page.
 *
 * ## Why both conditions are shown
 *
 * Because "we narrow the tool list" is a claim that needs a control. Narrowing
 * is supposed to help a smaller model by giving it fewer names to confuse, and
 * it could equally hurt by removing something needed. Showing the same
 * scenarios with all the tools and with the narrowed set is the only honest way
 * to say which — and if narrowing ever scores worse, this table is where that
 * shows up rather than in somebody's assistant quietly getting stupider.
 *
 * ## Why failures are listed individually
 *
 * A score with no failures under it is a marketing number. The failing rows
 * name the tool the model actually reached for, which is the only form of this
 * information anybody can act on.
 */

type Summary = {
  model: string
  label: string
  condition: string
  passed: number
  total: number
  medianMs: number
  meanTools: number
  meanPromptTokens: number
}

type Row = {
  model: string
  condition: string
  scenario: string
  pass: boolean
  failure?: string
  detail?: string
  called: string[]
}

const summary = report.summary as Summary[]
const rows = report.rows as Row[]
const failures = rows.filter((r) => !r.pass)

/** Grouped by model, so the two conditions sit next to each other. */
const models = [...new Set(summary.map((s) => s.model))]

export function ToolEvalTable() {
  const ran = new Date(report.ranAt)

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs text-text-3">
              <th className="py-1.5 pr-3 font-medium">Model</th>
              <th className="py-1.5 pr-3 font-medium">Tools offered</th>
              <th className="py-1.5 pr-3 font-medium">Correct</th>
              <th className="py-1.5 pr-3 font-medium">Prompt size</th>
              <th className="py-1.5 font-medium">Median</th>
            </tr>
          </thead>
          <tbody>
            {models.map((model) =>
              summary
                .filter((s) => s.model === model)
                .map((s, i) => (
                  <tr
                    key={`${s.model}-${s.condition}`}
                    className={i === 0 ? 'border-t border-hairline' : ''}
                  >
                    <td className="py-1.5 pr-3">
                      {i === 0 ? <span className="text-text-1">{s.label}</span> : null}
                    </td>
                    <td className="py-1.5 pr-3 text-text-2">
                      {s.condition === 'full' ? 'all of them' : 'narrowed'}
                      <span className="tabular ml-1.5 text-xs text-text-3">
                        {s.meanTools} avg
                      </span>
                    </td>
                    <td className="tabular py-1.5 pr-3">
                      <span className={s.passed === s.total ? 'text-text-1' : 'text-warn'}>
                        {s.passed}/{s.total}
                      </span>
                    </td>
                    <td className="tabular py-1.5 pr-3 text-text-2">
                      {s.meanPromptTokens.toLocaleString()}
                    </td>
                    <td className="tabular py-1.5 text-text-3">
                      {(s.medianMs / 1000).toFixed(1)}s
                    </td>
                  </tr>
                )),
            )}
          </tbody>
        </table>
      </div>

      {failures.length > 0 ? (
        <>
          <h3 className="mt-5 text-sm font-medium">Every case that failed</h3>
          <p className="mt-1 text-xs text-text-3">
            Named individually, with the tool the model actually reached for. A score with nothing
            underneath it is not evidence of anything.
          </p>
          <ul className="mt-2 space-y-1.5">
            {failures.map((f) => (
              <li key={`${f.model}-${f.condition}-${f.scenario}`} className="text-sm text-text-2">
                <span className="font-mono text-xs text-text-3">
                  {f.model} · {f.condition}
                </span>{' '}
                — <span className="text-text-1">{f.scenario}</span>: {describe(f)}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-4 text-sm text-text-2">
          Every scenario passed on every model, in both conditions.
        </p>
      )}

      <p className="mt-4 text-xs text-text-3">
        Run on {ran.toLocaleDateString()} against three vLLM servers. Re-running the evaluation is
        what updates this table — the numbers are generated, not typed.
      </p>
    </div>
  )
}

/** One failure, in a sentence rather than a code. */
function describe(f: Row): string {
  switch (f.failure) {
    case 'wrong-tool':
      return `reached for ${f.detail ?? 'the wrong tool'}`
    case 'forbidden':
      return `called ${f.detail ?? 'a forbidden tool'}, which this case exists to catch`
    case 'should-have-called':
      return 'answered in prose when it needed to look something up'
    case 'should-not-have-called':
      return `called ${f.detail ?? 'a tool'} when nothing needed doing`
    case 'error':
      return `the server did not answer — ${f.detail ?? 'no detail'}`
    default:
      return 'failed'
  }
}
