import type { NodeId } from '@jojo/service/core/model'
import type { useThreads } from '@jojo/service/react/use-threads'
import { useToast } from '@/lib/toast-context'

/** The thread bar's file and delete, with the toasts that answer them. */
export function useThreadActions(
  { file, remove }: Pick<ReturnType<typeof useThreads>, 'file' | 'remove'>,
  { clear, openThread }: { clear: () => void; openThread: (id: NodeId | null) => void },
) {
  const { toast } = useToast()

  const onFile = (id: NodeId, applicationId: Parameters<typeof file>[1]) => {
    const result = file(id, applicationId)
    if (result.ok) {
      toast({
        title: result.announcement.title,
        ...(result.announcement.description === undefined
          ? {}
          : { description: result.announcement.description }),
        ...(result.undo ? { action: { label: 'Undo', onClick: result.undo } } : {}),
      })
    }
  }

  const onDelete = (id: NodeId) => {
    const result = remove(id)
    if (!result.ok) return
    // The open conversation just stopped existing; showing its turns
    // under a title that is gone reads as a failed delete.
    clear()
    openThread(null)
    toast({
      title: 'Conversation deleted',
      tone: 'danger',
      ...(result.undo ? { action: { label: 'Undo', onClick: result.undo } } : {}),
    })
  }

  return { onFile, onDelete }
}
