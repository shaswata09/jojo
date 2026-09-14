import { useRef } from 'react'
import { FolderOpen, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { pickedFiles } from '@/lib/file-input'
import { asChoice, choiceOf, type PdfChoice } from './use-pdf-files'
import type { VaultFile } from '@/data/vault'

export const SELECT_CLASS =
  'h-8 cursor-pointer rounded-lg border border-input bg-transparent px-2 text-sm text-text-1 transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

/**
 * The two ways a PDF gets into the editor: off the vault, or off the machine.
 *
 * Both, rather than the vault alone, because the documents a person wants to
 * join are rarely all filed yet — the letter that arrived by email this morning
 * is the usual second half of a merge. A picked file is used where it is and
 * never filed unless the result is saved, so browsing to one costs nothing.
 */
export function PdfSourceAdd({
  available,
  onAdd,
  label,
  multiple = false,
}: {
  available: readonly VaultFile[]
  onAdd: (choices: readonly PdfChoice[]) => void
  /** Names the pair of controls for assistive tech, e.g. 'Add a PDF to merge'. */
  label: string
  multiple?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className={SELECT_CLASS}
        aria-label={`${label} from the vault`}
        // Stays on the placeholder: this is an action, not a setting, and a
        // select that keeps the last document chosen cannot be used to choose
        // the same one twice.
        value=""
        onChange={(event) => {
          const file = available.find((candidate) => candidate.id === event.target.value)
          if (file) onAdd([choiceOf(file)])
        }}
        disabled={available.length === 0}
      >
        <option value="">
          {available.length === 0 ? 'No PDFs in the vault yet' : 'Choose from the vault…'}
        </option>
        {available.map((file) => (
          <option key={file.id} value={file.id}>
            {file.name}
          </option>
        ))}
      </select>

      <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
        <Upload aria-hidden /> From this device
      </Button>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        multiple={multiple}
        className="hidden"
        aria-label={`${label} from this device`}
        onChange={(event) => {
          // Read before the input is cleared — `input.files` is live, and
          // clearing it first empties the list. See `pickedFiles`.
          const picked = pickedFiles(event.target)
          onAdd(picked.map((file, at) => asChoice(file, at)))
        }}
      />
      <span className="inline-flex items-center gap-1.5 text-xs text-text-3">
        <FolderOpen className="size-3.5" aria-hidden />
        {available.length === 0
          ? 'Or drop a PDF anywhere on this card. Files you save here show up in this list.'
          : 'Or drop a PDF anywhere on this card.'}
      </span>
    </div>
  )
}
