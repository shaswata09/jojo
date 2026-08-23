import { useState } from 'react'
import { Briefcase, Check, Pencil, Trash2, X } from 'lucide-react'
import type { Thread } from '@jojo/service/react/use-threads'
import type { NodeId } from '@jojo/service/core/model'
import { displayName } from '@jojo/service/data/seed'
import type { Application } from '@jojo/service/data/seed'
import { Chip } from '@/components/common/Chip'
import { ApplicationPicker } from '@/components/vault/ApplicationPicker'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'

/**
 * The open conversation: its name, the job it is about, and what you can do to it.
 *
 * Moving between conversations is `ThreadList`'s job. This carried a row of
 * chips for that and gave it up, because the two questions are different: "which
 * one am I in" wants one line above the messages, and "which one was about Rice"
 * wants a list with the job on it. One control answering both answered neither
 * well past about three threads.
 *
 * FILING USES THE SAME PICKER A DOCUMENT DOES, because it is the same act on the
 * same edge — `FILED_UNDER` from the thread to the application. A person who has
 * filed a CV under the Rice job has already learnt this control, and "everything
 * about Rice" returns the conversation beside the CV for the same reason it
 * returns the CV.
 */
export function ThreadBar({
  threads,
  activeId,
  applications,
  onRename,
  onFile,
  onDelete,
  onSetAuto,
  busy,
}: {
  threads: readonly Thread[]
  activeId: NodeId | null
  applications: readonly Application[]
  onRename: (id: NodeId, title: string) => void
  onFile: (id: NodeId, applicationId: NodeId | null) => void
  onDelete: (id: NodeId) => void
  /** Turns "ask me before every change" off for this conversation. */
  onSetAuto: (id: NodeId, auto: boolean) => void
  busy: boolean
}) {
  const active = threads.find((t) => t.id === activeId) ?? null
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [filing, setFiling] = useState(false)

  const filedUnder = active?.applicationId
    ? (applications.find((a) => a.id === active.applicationId) ?? null)
    : null

  return (
    <div className="space-y-2">
      {active ? (
        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <Input
                value={draft}
                autoFocus
                className="h-8 max-w-xs"
                aria-label="Conversation title"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    onRename(active.id, draft)
                    setEditing(false)
                  }
                  if (e.key === 'Escape') setEditing(false)
                }}
              />
              <Button
                size="icon"
                variant="ghost"
                aria-label="Save the title"
                onClick={() => {
                  onRename(active.id, draft)
                  setEditing(false)
                }}
              >
                <Check className="size-3.5" aria-hidden />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Cancel"
                onClick={() => setEditing(false)}
              >
                <X className="size-3.5" aria-hidden />
              </Button>
            </>
          ) : (
            <>
              <span className="truncate text-sm font-medium text-text-1">{active.title}</span>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Rename this conversation"
                onClick={() => {
                  setDraft(active.title)
                  setEditing(true)
                }}
              >
                <Pencil className="size-3.5" aria-hidden />
              </Button>
            </>
          )}

          {filedUnder ? (
            <Chip tone="teal">
              <Briefcase className="size-3" aria-hidden />
              {displayName(filedUnder)}
            </Chip>
          ) : null}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFiling((v) => !v)
            }}
          >
            {filedUnder ? 'Change job' : 'File under a job'}
          </Button>

          {/* Per conversation, not per app.
              The granularity people want is "this one is a cleanup session,
              stop asking me" — and the safe default has to be the one you get
              without choosing, so absent means ask. */}
          <label className="ml-auto flex items-center gap-1.5 text-xs text-text-3">
            <span>Act without asking</span>
            <Switch
              checked={active.autoApprove}
              onCheckedChange={(auto) => {
                onSetAuto(active.id, auto)
              }}
              aria-label="Let the assistant change things in this conversation without asking"
            />
          </label>

          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              onDelete(active.id)
            }}
          >
            <Trash2 className="size-3.5" aria-hidden />
            Delete
          </Button>
        </div>
      ) : null}

      {/* A conversation is about one job, so the multi-select is handed a list
          of one and its last choice is taken. The relation allows many — it is
          the same `FILED_UNDER` a document uses — and if a thread ever needs to
          span two, only this call site changes. */}
      {active && filing ? (
        <ApplicationPicker
          values={active.applicationId ? [active.applicationId] : []}
          what="conversation"
          onChange={(ids) => {
            onFile(active.id, ids.at(-1) ?? null)
            setFiling(false)
          }}
        />
      ) : null}
    </div>
  )
}
