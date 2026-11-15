/**
 * Q152 — the agent (chat, tools, approvals) works on the phone as on the web.
 *
 * "Works" against a real model on a real handset needs both, and this runner
 * has neither. What CAN be held here is the two halves that decide whether the
 * phone runs the same agent as the web rather than a lookalike:
 *
 *   1. `agentTurn` — the phone's model call — carries the tool catalogue to the
 *      model and hands the model's tool calls back to the loop. If it dropped
 *      either, the Assistant would chat and never act.
 *   2. The Assistant screen drives the SHARED `useAgent` loop with that call,
 *      and the app mounts the SHARED run provider and an approval sheet over the
 *      shared run context, so a write the agent proposes is approved on the
 *      phone exactly as on the web.
 *
 * The loop, the catalogue, approvals and the provider dialects are tested once,
 * in `@jojo/service`. The transport is stubbed; the assertions are on what this
 * file hands it and what it makes of the reply.
 *
 * D20: nothing is mounted. Part 2 is a narrow source read.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** Every request the transport was handed. */
const sent: { url: string; body: string }[] = []

vi.mock('@/lib/local-service', () => ({
  failed: (r: object) => 'failed' in r,
  send: (request: { url: string; body?: string }) => {
    sent.push({ url: request.url, body: request.body ?? '' })
    return Promise.resolve({
      ok: true,
      status: 200,
      text: JSON.stringify({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'application.list', arguments: '{"stage":"applied"}' },
                },
              ],
            },
          },
        ],
      }),
    })
  },
}))

const { agentTurn } = await import('./llm')

const settings = {
  provider: 'openai-compatible' as const,
  endpoint: 'http://192.168.1.9:8080/v1',
  model: 'local-model',
}

const tool = {
  type: 'function',
  function: {
    name: 'application.list',
    description: 'List applications',
    parameters: { type: 'object', properties: { stage: { type: 'string' } } },
  },
}

beforeEach(() => {
  sent.length = 0
})

describe('the phone model call the agent loop runs on', () => {
  it('sends the tool catalogue to the model', async () => {
    await agentTurn(settings, [{ role: 'user', content: 'What have I applied to?' }], [tool])

    expect(sent).toHaveLength(1)
    const body = JSON.parse(sent[0].body) as { tools?: { function: { name: string } }[] }
    expect(body.tools?.map((t) => t.function.name)).toEqual(['application.list'])
  })

  it('hands the model tool calls back to the loop, arguments parsed', async () => {
    const turn = await agentTurn(
      settings,
      [{ role: 'user', content: 'What have I applied to?' }],
      [tool],
    )

    expect(turn.ok).toBe(true)
    if (!turn.ok) return
    expect(turn.toolCalls.map((c) => [c.name, c.args])).toEqual([
      ['application.list', { stage: 'applied' }],
    ])
  })

  it('does not send at all when no model is configured', async () => {
    const turn = await agentTurn(
      { ...settings, model: '' },
      [{ role: 'user', content: 'hi' }],
      [tool],
    )
    expect(turn.ok).toBe(false)
    expect(sent).toHaveLength(0)
  })
})

describe('the phone runs the shared agent, not a copy', () => {
  const read = (rel: string) => readFileSync(path.join(HERE, rel), 'utf8')

  it('drives the shared useAgent loop with agentTurn', () => {
    const screen = read('../screens/AssistantScreen.tsx')
    expect(screen).toContain("import { useAgent } from '@jojo/service/react/use-agent'")
    expect(screen).toMatch(/agentTurn\(settings, messages, tools, controller\.signal\)/)
    expect(screen).toMatch(/useAgent\(\{\s*llm,/)
  })

  it('mounts the shared run provider and an approval sheet over the shared run context', () => {
    const app = read('../../App.tsx')
    expect(app).toContain(
      "import { AgentRunsProvider } from '@jojo/service/react/agent-runs-provider'",
    )
    expect(app).toContain('<AgentRunsProvider')
    expect(app).toContain('<ApprovalSheet />')
    const sheet = read('../components/assistant/ApprovalSheet.tsx')
    expect(sheet).toContain("from '@jojo/service/react/agent-runs-context'")
  })
})
