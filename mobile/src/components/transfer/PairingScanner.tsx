import { useCallback, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { createPulseReceiver } from '@jojo/service/core/pulse'
import { readPulse } from '@jojo/service/core/pulse-read'
import { Txt } from '@/components/ui/Text'
import {
  SCANNER_HTML,
  SIDE,
  type ScannerErrorReason,
  type ScannerMessage,
} from '@/components/transfer/scanner-page'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/**
 * Reading the key off the other device's animation.
 *
 * The camera is the whole reason this handshake is trustworthy: it is a channel
 * an attacker on the wifi cannot see into, which is what lets `core/pairing.ts`
 * put a secret on a screen and treat whatever read it as the person's own
 * device.
 *
 * ## Where the work happens
 *
 * The WebView is a camera and a downsampler, and nothing else — see
 * `scanner-page.ts`. It posts a small grayscale buffer eight times a second, and
 * everything after that is TypeScript in this app: `core/pulse-read.ts` turns a
 * buffer into a frame, `core/pulse.ts` accumulates frames into the key.
 *
 * That split matters more than it looks. The decoder exists ONCE, in the service
 * layer, and the desktop browser runs the same file. Two decoders — one bundled
 * into an HTML string for the phone, one imported for the web — would be two
 * chances to disagree about what a frame says, and a disagreement there is a
 * pairing that fails with nothing on either screen to explain it.
 *
 * ## Frames are dropped, not repaired
 *
 * There is no error correction anywhere in this path, by design. The animation
 * CYCLES: a frame that does not read is discarded and comes round again a second
 * later. So a bad read costs part of one more pass and is never announced —
 * announcing it would mean a message flickering several times a second while
 * somebody is still lining the phone up.
 *
 * What IS announced is the state a person can act on: no camera, no permission,
 * or a key that has arrived.
 */

/** What each failure should make the person do differently. */
const ADVICE: Record<ScannerErrorReason, string> = {
  denied:
    'jojo needs the camera to read the code on your other device. Allow it, or type the code by hand instead.',
  unsupported: 'This phone cannot open the camera for jojo.',
  failed: 'The camera did not start. Close jojo and open it again.',
}

export function PairingScanner({
  onOffer,
  paused = false,
}: {
  /** Called once, with the offer bytes, as soon as the whole key has arrived. */
  onOffer: (offer: Uint8Array) => void
  /** Stops reading without unmounting, which is slow to restart. */
  paused?: boolean
}) {
  const c = useColors()
  const [problem, setProblem] = useState<string | null>(null)
  const [seen, setSeen] = useState(0)
  const [total, setTotal] = useState(0)

  /**
   * The frames gathered so far.
   *
   * A ref, not state: frames arrive eight times a second and the accumulator
   * must survive every render without being rebuilt. Only the COUNT is state,
   * because only the count is on screen.
   */
  const receiver = useMemo(() => createPulseReceiver(), [])
  const done = useRef(false)

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      if (paused || done.current) return

      let message: ScannerMessage
      try {
        message = JSON.parse(event.nativeEvent.data) as ScannerMessage
      } catch {
        // A WebView can emit things this app did not write. Ignored rather than
        // shown: it is not a state anybody can act on.
        return
      }

      if (message.kind === 'error') {
        setProblem(ADVICE[message.reason])
        return
      }
      if (message.kind !== 'frame') return
      setProblem(null)

      // Base64 back to bytes. `atob` exists in Hermes via the URL polyfill's
      // dependencies; `Buffer` would pull in a shim this app does not have.
      const binary = globalThis.atob(message.data)
      const gray = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) gray[i] = binary.charCodeAt(i)
      if (gray.length !== SIDE * SIDE) return

      const read = readPulse(gray, SIDE, SIDE)
      // A frame that did not read is simply dropped — the animation cycles.
      if (!read.ok) return

      const outcome = receiver.accept(read.value)
      if (outcome === 'rejected') return

      const at = receiver.progress()
      setSeen(at.have)
      setTotal(at.total)

      const key = receiver.payload()
      if (key === null) return
      // Latched before the callback: frames keep arriving for as long as the
      // camera is open, and handing the same key up twice would start a second
      // pairing against an offer the first one already spent.
      done.current = true
      onOffer(key)
    },
    [paused, onOffer, receiver],
  )

  return (
    <View style={styles.frame}>
      <WebView
        style={StyleSheet.absoluteFill}
        // The prop the whole approach rests on. Without a base URL the document
        // origin is `about:blank`, which is not a secure context, and
        // `navigator.mediaDevices` is undefined with no error saying why.
        // Nothing is ever fetched from this origin.
        source={{ html: SCANNER_HTML, baseUrl: 'https://jojo.invalid/' }}
        originWhitelist={['https://jojo.invalid']}
        // Grants the camera without a second prompt of jojo's own. The system
        // prompt has already been answered by `ensureCamera`.
        mediaCapturePermissionGrantType="grant"
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled
        // Nothing is loaded from disk and nothing should be.
        allowFileAccess={false}
        allowUniversalAccessFromFileURLs={false}
        onMessage={onMessage}
        onError={() => setProblem(ADVICE.failed)}
      />

      <View style={[styles.status, { backgroundColor: c.panel }]}>
        <Txt size="sm" tone="muted" center>
          {problem ??
            (total === 0
              ? 'Point this at the animation on your other device.'
              : `Reading the key — ${seen} of ${total}`)}
        </Txt>
        {problem === null && total > 0 ? (
          <View style={[styles.track, { backgroundColor: c.well, marginTop: space[2] }]}>
            <View
              style={[styles.fill, { backgroundColor: c.text1, width: `${(seen / total) * 100}%` }]}
            />
          </View>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  frame: { flex: 1, overflow: 'hidden', borderRadius: 12 },
  status: { position: 'absolute', left: 12, right: 12, bottom: 12, borderRadius: 10, padding: 12 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
})
