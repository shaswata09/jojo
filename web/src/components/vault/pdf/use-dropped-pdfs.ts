import { useEffect, useRef } from 'react'
import { useToast } from '@/lib/toast-context'
import { dropMessage, sortDroppedPdfs } from '@/lib/pdf/dropped-files'

/**
 * One drop, handed from the card down to whichever panel is showing.
 *
 * The drop target is the whole card rather than each panel's own strip, because
 * that is the target a person aims at — so the files arrive at the top and have
 * to be passed down. The `id` is what makes that safe: a panel re-renders for
 * all sorts of reasons, and an effect keyed on the file list alone would add
 * the same drop again on every one of them.
 */
export type PdfDelivery = { readonly id: number; readonly files: readonly File[] }

/**
 * Takes the PDFs out of a delivery, once, and explains whatever it could not use.
 *
 * `limit` is how many the panel can hold — merging takes any number, the other
 * two work on one document at a time.
 */
export function useDroppedPdfs(
  dropped: PdfDelivery | null | undefined,
  limit: number,
  onPdfs: (files: readonly File[]) => void,
): void {
  const { toast } = useToast()
  /*
   * The last delivery acted on. A ref rather than a dependency, because the
   * alternative is requiring `onPdfs` to be referentially stable and that is a
   * rule the next person to touch these panels cannot see being broken — the
   * symptom is a document silently added twice.
   */
  const consumed = useRef(0)

  useEffect(() => {
    if (!dropped || dropped.id === consumed.current) return
    consumed.current = dropped.id

    const sorted = sortDroppedPdfs(dropped.files, limit)
    if (sorted.pdfs.length > 0) onPdfs(sorted.pdfs)

    const message = dropMessage(sorted)
    if (!message) return
    // Said out loud rather than left to be noticed. A drop is the one way in
    // where the person cannot see what they handed over until afterwards.
    toast(
      sorted.pdfs.length > 0
        ? { title: 'Not everything in that drop was used', description: message }
        : { title: 'Nothing there to open', description: message, tone: 'danger' },
    )
  }, [dropped, limit, onPdfs, toast])
}
