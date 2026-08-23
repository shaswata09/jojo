import { useState } from 'react'
import { Globe, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CAPTURE_REJECTION_MESSAGE } from '@jojo/service/core/capture'
import { useCaptureInbox } from '@/lib/capture-bridge'
import { useFileCapture } from '@/lib/file-capture'
import { displayName } from '@/data/seed'
import { useToast } from '@/lib/toast-context'

/**
 * What the extension captured, waiting to be filed.
 *
 * Deliberately a strip that appears and disappears rather than a permanent
 * panel: with nothing waiting there is nothing to say, and a box reading "0
 * captures" is a box that trains people to stop reading it. It renders only when
 * something is actually queued, which also means the whole extension can be
 * absent and this costs one probe and no pixels.
 *
 * Filing is a button rather than automatic, and that is a considered choice
 * against the obvious one. Captures land here because the user pressed a toolbar
 * button on some other tab, possibly days ago and possibly by accident; writing
 * them into the vault the instant a jojo tab opens would be an app that adds
 * records nobody asked it to add, at a moment nobody was looking. The count is
 * the notification; the button is the consent.
 */
export function CaptureInbox() {
  const { pending, collect, ack, refresh } = useCaptureInbox()
  const fileCapture = useFileCapture()
  const { toast } = useToast()
  const [filing, setFiling] = useState(false)

  if (pending === 0) return null

  const onFile = async () => {
    setFiling(true)
    try {
      const { ok, refused } = await collect()

      const filed = []
      const kept: string[] = []
      for (const { capture, id } of ok) {
        // Sequential rather than Promise.all: each one writes a graph record
        // whose id the next line needs, and the blob store is a single
        // IndexedDB connection that gains nothing from being asked for five
        // writes at once.
        filed.push(await fileCapture(capture))
        if (id !== '') kept.push(id)
      }

      /*
       * Filed AND permanently refused, together.
       *
       * The queue only shrinks on this call, so dropping just the filed ones
       * left every refusal in it forever — counted on the badge, offered by this
       * strip on every visit, and failing the same way every time. A refusal is
       * a verdict rather than a hiccup: nothing about the page or the app will
       * change between attempts, so the honest thing is to say why once and let
       * it go. What is NOT acked is anything that threw on the way in, which is
       * the case that genuinely deserves another try.
       */
      await ack([...kept, ...refused.map((r) => r.id).filter((id) => id !== '')])

      const attached = filed.filter((f) => f.application !== null)
      const unstored = filed.filter((f) => !f.stored)
      const dropped = filed.reduce((sum, f) => sum + f.dropped, 0)

      if (filed.length > 0) {
        toast({
          title:
            filed.length === 1
              ? `${filed[0]?.file.name ?? 'Posting'} saved to your vault`
              : `${String(filed.length)} postings saved to your vault`,
          description: [
            attached.length > 0
              ? `${attached.length === filed.length ? 'Filed' : `${String(attached.length)} filed`} under ${
                  attached.length === 1 && attached[0]?.application
                    ? displayName(attached[0].application)
                    : 'the matching applications'
                }.`
              : 'Not filed under any application — the addresses did not match one.',
            dropped > 0
              ? `${String(dropped)} ${dropped === 1 ? 'asset' : 'assets'} could not be kept, so parts may look plain.`
              : null,
            unstored.length > 0
              ? `${String(unstored.length)} could not be stored on this device — the record is there, the page is not.`
              : null,
          ]
            .filter(Boolean)
            .join(' '),
        })
      }

      // Reported rather than swallowed: somebody pressed a button on a posting
      // and is entitled to know why nothing came of it.
      if (refused.length > 0) {
        toast({
          tone: 'danger',
          title:
            refused.length === 1
              ? 'One capture could not be kept'
              : `${String(refused.length)} captures could not be kept`,
          description: [...new Set(refused.map((r) => CAPTURE_REJECTION_MESSAGE[r.reason]))].join(
            ' ',
          ),
        })
      }
    } finally {
      setFiling(false)
      refresh()
    }
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-info-border bg-info-soft px-3 py-2.5">
      <Globe className="size-4 shrink-0 text-info" strokeWidth={1.9} aria-hidden />
      <p className="min-w-0 flex-1 text-sm text-text-1">
        {pending === 1
          ? 'One posting is waiting to be saved here.'
          : `${String(pending)} postings are waiting to be saved here.`}{' '}
        <span className="text-text-3">Captured with the jojo extension, still on this device.</span>
      </p>
      <Button size="sm" onClick={() => void onFile()} disabled={filing}>
        {filing ? <Loader2 className="size-3.5 animate-spin" strokeWidth={2} aria-hidden /> : null}
        {filing ? 'Saving…' : pending === 1 ? 'Save it' : 'Save them'}
      </Button>
    </div>
  )
}
