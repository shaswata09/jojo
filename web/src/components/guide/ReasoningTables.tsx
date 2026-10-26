import { REASONING_MEASURED, REASONING_ROWS, SPEED_ROWS } from '@/components/guide/reasoning-bench'
import { cn } from '@/lib/utils'

const TH = 'py-1.5 pr-3 font-medium'
const TD = 'tabular py-1.5 pr-3'

/** Two passes printed under the mean, because the spread is half of what a score means. */
function Score({ mean, passes }: { mean: number; passes: readonly [number, number] }) {
  return (
    <>
      <span className="text-text-1">{mean}</span>
      <span className="ml-1 text-xs text-text-3">
        ({passes[0]}, {passes[1]})
      </span>
    </>
  )
}

/**
 * Reasoning on against off — the score, and the time it took — then the raw
 * speed of each model, which is what explains the time.
 */
export function ReasoningTables() {
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs text-text-3">
              <th className={TH}>Model</th>
              <th className={TH}>Reasoning</th>
              <th className={TH}>Clean, all tools</th>
              <th className={TH}>Clean, narrowed</th>
              <th className={TH}>Per conversation</th>
              <th className="py-1.5 font-medium">Tokens per round</th>
            </tr>
          </thead>
          <tbody>
            {REASONING_ROWS.map((row, i) => (
              <tr
                key={`${row.model}-${row.setting}`}
                // A heavier rule between models, so each pair reads as a pair.
                className={cn(
                  'border-t',
                  i % 2 === 0 ? 'border-hairline-strong' : 'border-hairline',
                )}
              >
                <td className="py-1.5 pr-3 text-text-1">{i % 2 === 0 ? row.model : ''}</td>
                <td className="py-1.5 pr-3 text-text-2">{row.setting}</td>
                <td className={TD}>
                  <Score {...row.full} />
                </td>
                <td className={TD}>
                  <Score {...row.narrowed} />
                </td>
                <td className={TD}>
                  {row.medianSeconds} s
                  <span className="ml-1 text-xs text-text-3">
                    (slowest tenth {row.p90Seconds} s)
                  </span>
                </td>
                <td className="tabular py-1.5">{row.tokensPerRound}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-xs text-text-3">
        Clean conversations out of 100, the mean of two passes with each pass in brackets. Time is
        the median conversation, with two runs sharing each server. Measured {REASONING_MEASURED}.
      </p>

      <h3 className="mt-5 text-sm font-medium">How fast each model is</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs text-text-3">
              <th className={TH}>Model</th>
              <th className={TH}>Per token</th>
              <th className={TH}>First token</th>
              <th className="py-1.5 font-medium">Thinking adds</th>
            </tr>
          </thead>
          <tbody>
            {SPEED_ROWS.map((row) => (
              <tr key={row.model} className="border-t border-hairline">
                <td className="py-1.5 pr-3 text-text-1">{row.model}</td>
                <td className={TD}>
                  {row.msPerToken} ms
                  <span className="ml-1 text-xs text-text-3">({row.tokensPerSecond} tokens/s)</span>
                </td>
                <td className={TD}>
                  {(row.firstTokenColdMs / 1000).toFixed(1)} s
                  <span className="ml-1 text-xs text-text-3">
                    ({(row.firstTokenWarmMs / 1000).toFixed(2)} s when the prompt repeats)
                  </span>
                </td>
                <td className={TD}>
                  {row.thinkingSeconds} s
                  <span className="ml-1 text-xs text-text-3">
                    ({row.thinkingTokens} tokens{row.alwaysOn ? ', always on' : ''})
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-xs text-text-3">
        One request at a time on an idle server, streamed, three samples each. The request is
        jojo&rsquo;s system prompt and every tool description:{' '}
        {SPEED_ROWS[0]?.promptTokens.toLocaleString()} tokens to Gemma, and{' '}
        {SPEED_ROWS[1]?.promptTokens.toLocaleString()} to GPT-OSS, whose tokenizer counts the same
        text as fewer tokens.
      </p>
    </>
  )
}
