import { useCallback, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { useTranslation } from 'react-i18next'
import { readPairingQr } from '@/lib/pairing-qr'
import { Txt } from '@/components/ui/Text'
import {
  SCANNER_HTML,
  SIDE,
  type ScannerErrorReason,
  type ScannerMessage,
} from '@/components/transfer/scanner-page'
import { useColors } from '@/theme/theme-context'
import { i18next } from '@/i18n/i18n'

/**
 * Reading the key off the QR code on the other device's screen.
 *
 * The camera is the whole reason this handshake is trustworthy: it is a channel
 * an attacker on the wifi cannot see into, which is what lets `core/pairing.ts`
 * put a secret on a screen and treat whatever read it as the person's own
 * device.
 *
 * ## Where the work happens
 *
 * The WebView is a camera and a downsampler, and nothing else — see
 * `scanner-page.ts`. It posts a grayscale buffer a few times a second, and
 * `lib/pairing-qr.ts` looks for jojo's pairing code in it (Q329).
 *
 * ## Frames are dropped, not announced
 *
 * A frame with no readable code — the phone still moving, a blur, a stranger's
 * QR code — is discarded and the next one tried. Announcing it would mean a
 * message flickering several times a second while somebody is still lining the
 * phone up.
 *
 * What IS announced is the state a person can act on: no camera, no permission,
 * or a key that has arrived.
 */

/** What each failure should make the person do differently (`scanner.advice.<reason>`). */
const advice = (reason: ScannerErrorReason): string =>
  i18next.t(`transfer:scanner.advice.${reason}`)

export function PairingScanner({
  onOffer,
  paused = false,
}: {
  /** Called once, with the offer bytes, as soon as the whole key has arrived. */
  onOffer: (offer: Uint8Array) => void
  /** Stops reading without unmounting, which is slow to restart. */
  paused?: boolean
}) {
  const { t } = useTranslation('transfer')
  const c = useColors()
  const [problem, setProblem] = useState<string | null>(null)
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
        setProblem(advice(message.reason))
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

      const key = readPairingQr(gray, SIDE, SIDE)
      // No code in this frame, or not jojo's: try the next one.
      if (key === null) return
      // Latched before the callback: frames keep arriving for as long as the
      // camera is open, and handing the same key up twice would start a second
      // pairing against an offer the first one already spent.
      done.current = true
      onOffer(key)
    },
    [paused, onOffer],
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
        onError={() => setProblem(advice('failed'))}
      />

      <View style={[styles.status, { backgroundColor: c.panel }]}>
        <Txt size="sm" tone="muted" center>
          {problem ?? t('scanner.point')}
        </Txt>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  frame: { flex: 1, overflow: 'hidden', borderRadius: 12 },
  status: { position: 'absolute', left: 12, right: 12, bottom: 12, borderRadius: 10, padding: 12 },
})
