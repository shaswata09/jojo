import { Link } from 'react-router'
import { ArrowUp } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { RobotIcon } from '@/components/brand/RobotIcon'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { Panel } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const QUICK_ACTIONS = [
  'Draft a cover letter',
  'Tailor my CV to a posting',
  'Parse a job posting',
  'Draft a follow-up email',
  'Prepare me for an interview',
]

/**
 * Every action here needs a local model, and none is reachable. Rather than
 * render a chat that silently swallows input, the view states the blocker once
 * and disables the controls it governs.
 */
export function Assistant() {
  return (
    <>
      <PageHeader
        title="Assistant"
        subtitle="Runs on your machine. Nothing you type leaves this device."
      />

      <Panel className="min-w-0">
        <EmptyState
          icon={RobotIcon as unknown as LucideIcon}
          title="No model connected"
          description="The assistant needs a local OpenAI-compatible server — vLLM, Ollama or LM Studio. Point jojo at one in Settings and this page comes alive."
          action={
            <Button size="sm" variant="outline" asChild>
              {/* Link, not <a> — a raw href would full-page reload the SPA. */}
              <Link to="/settings">Open Settings</Link>
            </Button>
          }
        />
      </Panel>

      <Panel className="min-w-0">
        <h2 className="mb-3 text-base font-medium">What it will do</h2>
        <ul className="flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((a) => (
            <li key={a}>
              <Button variant="ghost" size="sm" disabled title="Needs a connected model">
                {a}
              </Button>
            </li>
          ))}
        </ul>

        <p className="mt-4 text-sm text-text-2">
          Each of these reads your profile and documents as context. Because inference is local,
          your CV and your notes are never uploaded anywhere.
        </p>

        <div className="mt-4 flex gap-2">
          <div className="min-w-0 flex-1">
            <Label htmlFor="assistant-prompt" className="sr-only">
              Ask the assistant
            </Label>
            <Input
              id="assistant-prompt"
              disabled
              placeholder="Connect a model to start a conversation"
            />
          </div>
          <Button size="icon" disabled aria-label="Send" title="Needs a connected model">
            <ArrowUp className="size-4" strokeWidth={2} aria-hidden />
          </Button>
        </div>
      </Panel>
    </>
  )
}
