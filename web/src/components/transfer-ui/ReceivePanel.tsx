import { useState } from 'react'
import { Camera } from 'lucide-react'
import { Field } from '@/components/common/Field'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import {
  CODE_LENGTH,
  formatCode,
  isWellFormed,
  normaliseCode,
} from '@/components/transfer-ui/pairing'

/**
 * The other half of the pairing: a field for the code, and an honest account of
 * the camera.
 *
 * Any well-formed code is accepted, and the copy says so. The alternative was
 * to check what the user typed against the code the send tab is showing —
 * which would be a lie in the other direction, since a real receiving device
 * has never seen that string and could only learn it from the sender.
 */
export function ReceivePanel({ paired, onPair }: { paired: boolean; onPair: () => void }) {
  const [raw, setRaw] = useState('')
  const [error, setError] = useState<string | null>(null)
  const code = normaliseCode(raw)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!isWellFormed(code)) {
      setError(`A pairing code is ${CODE_LENGTH} characters, like 4F2A-9K7M.`)
      return
    }
    setError(null)
    onPair()
  }

  return (
    <>
      <Panel>
        <PanelTitle hint="on this device">Enter the code</PanelTitle>
        <form onSubmit={submit} className="space-y-3">
          <Field
            label="Pairing code"
            mono
            autoComplete="off"
            spellCheck={false}
            placeholder="4F2A-9K7M"
            value={formatCode(code)}
            // Formatted on the way in rather than on blur: the dash appears as
            // you pass the fourth character, so the field always reads the same
            // way as the code printed on the other screen.
            onChange={(event) => {
              setRaw(event.target.value)
              setError(null)
            }}
            error={error}
            announce
            hint={`${CODE_LENGTH} characters, shown on the sending device. Any well-formed code pairs here — there is no second device to check it against.`}
            disabled={paired}
          />
          <Button type="submit" size="sm" disabled={paired || !isWellFormed(code)}>
            {paired ? 'Paired' : 'Pair'}
          </Button>
        </form>
      </Panel>

      <Panel>
        <PanelTitle>Scan it instead</PanelTitle>
        <p className="text-sm text-text-2">
          On a device with a camera you would point it at the code on the other screen rather than
          typing anything.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <Button variant="outline" size="sm" disabled title="This build never asks for the camera">
            <Camera className="size-3.5" strokeWidth={1.8} aria-hidden />
            Turn on the camera
          </Button>
          <span className="text-xs text-text-3">Inert here, on purpose</span>
        </div>
        <p className="mt-3 text-xs text-text-3">
          jojo would ask your browser for the camera at the moment you pressed that, never before,
          and the video would be read on this device and thrown away — it is looking for eight
          characters, not recording. This build never asks: there is nothing to scan and nothing
          listening.
        </p>
      </Panel>
    </>
  )
}
