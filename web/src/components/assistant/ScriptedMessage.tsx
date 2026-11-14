import { Quote } from 'lucide-react'
import { RobotIcon } from '@/components/brand/RobotIcon'
import { Chip } from '@/components/common/Chip'
import { CopyFeedback } from '@/components/common/CopyFeedback'
import { Button } from '@/components/ui/button'
import type { Message } from './scripts'

/** One row of the scripted conversation: the question, or a badged example reply. */
export function ScriptedMessage({
  message: m,
  copied,
  copyFailed,
  onCopy,
  onSave,
}: {
  message: Message
  copied: boolean
  copyFailed: boolean
  onCopy: (id: string, text: string) => void
  onSave: (message: Message) => void
}) {
  if (m.role === 'you')
    return (
      <li className="flex justify-end">
        <p className="well max-w-[36rem] rounded-lg px-3 py-2 text-sm wrap-anywhere whitespace-pre-line text-text-1">
          {m.text}
        </p>
      </li>
    )

  return (
    <li className="rounded-lg border border-hairline p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <RobotIcon className="size-4 shrink-0" aria-hidden />
        {/* Keyed to the message and not to the branch, so a canned
            reply cannot lose its badge by being drawn somewhere new.
            A model's answer wears nothing, which is what makes the
            badge mean anything at all. */}
        <Chip tone="amber">Example response · no model connected</Chip>
      </div>

      {/* whitespace-pre-line so the drafts keep their paragraphs. */}
      <p className="text-sm wrap-anywhere whitespace-pre-line text-text-1">{m.text}</p>

      <div className="mt-2.5 flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onClick={() => onCopy(m.id, m.text)}>
          <CopyFeedback copied={copied} failed={copyFailed} />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onSave(m)}>
          <Quote className="size-3.5" strokeWidth={1.8} aria-hidden />
          Save to snippets
        </Button>
      </div>
    </li>
  )
}
