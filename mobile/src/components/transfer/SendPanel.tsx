import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { PairingScanner } from '@/components/transfer/PairingScanner'
import { CAMERA_REFUSED, ensureCamera, type CameraAccess } from '@/lib/camera-permission'
import { encodeAddress, groupCode } from '@jojo/service/core/dial'
import { useGraph, useKg } from '@jojo/service/react/kg-context'
import { RECEIVE_ADVICE } from '@/lib/handoff-receive'
import {
  beginServing,
  canServe,
  readStoredDocument,
  stampSent,
  type ServeSession,
} from '@/lib/handoff-serve'
import { buildSendPayload } from '@/lib/send-payload'
import { createServeWatch } from '@/lib/serve-watch'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/**
 * The sending half: this phone's records, onto a computer.
 *
 * ## Why this exists now
 *
 * The screen used to say the phone could not send, because a web page cannot
 * accept a connection and so the phone could never reach a browser. That is
 * still true, and it turned out not to matter: the phone already listens for
 * the other direction, and a browser that can connect to it can ask it for its
 * records as easily as it can post its own. So this panel does everything the
 * receive panel does — reads the computer's animation, agrees a key, opens a
 * socket, shows its address — and then answers the computer's requests for the
 * phone's backup instead of accepting the computer's.
 *
 * ## Nothing leaves before the computer proves itself
 *
 * The backup is gathered on the first request that carries this session's
 * token AND a proof only the computer that showed the animation can make
 * (`core/handoff-pull.ts`). What goes over the network is sealed under a key
 * the two devices agreed and nothing else holds.
 *
 * ## What the computer does with it
 *
 * Asks the person there before replacing anything, exactly as for a backup
 * file. This phone keeps everything it has — sending is a copy.
 */
export function SendPanel() {
  const c = useColors()
  const graph = useGraph()
  const { repo, now } = useKg()
  const [access, setAccess] = useState<CameraAccess | null>(null)
  const [scanning, setScanning] = useState(false)
  const [session, setSession] = useState<ServeSession | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [served, setServed] = useState<{ served: number; chunks: number | null }>({
    served: 0,
    chunks: null,
  })
  const [finished, setFinished] = useState(false)
  /** What the backup held, once gathered — for the closing sentence. */
  const [carried, setCarried] = useState<{ documents: number; unreadable: number } | null>(null)
  const [able] = useState(canServe)

  const start = useCallback(async () => {
    setFailed(null)
    setFinished(false)
    const granted = await ensureCamera()
    setAccess(granted)
    if (granted === 'granted') setScanning(true)
  }, [])

  /**
   * Whether the panel is still on screen. Starting the server awaits key
   * agreement and the network; a person who switches away in that window used
   * to leave a listener bound on the LAN with nothing pointing at it
   * (transfer audit, 2026-11-16).
   */
  const mounted = useRef(true)
  useEffect(
    () => () => {
      mounted.current = false
    },
    [],
  )

  const onOffer = useCallback(
    async (offer: Uint8Array) => {
      setScanning(false)
      const started = await beginServing(offer, async () => {
        const made = await buildSendPayload({
          exportedAt: now(),
          nodes: graph.nodes(),
          edges: graph.edges(),
          readDocument: readStoredDocument,
        })
        setCarried({ documents: made.documents, unreadable: made.unreadable })
        return made.bytes
      })
      if (!started.ok) {
        setFailed(RECEIVE_ADVICE[started.error])
        return
      }
      if (!mounted.current) {
        started.value.stop()
        return
      }
      setServed({ served: 0, chunks: null })
      setSession(started.value)
    },
    [graph, now],
  )

  /** Back to the start, for another computer or another try. */
  const again = useCallback(() => {
    session?.stop()
    setSession(null)
    setFinished(false)
    setCarried(null)
    setFailed(null)
  }, [session])

  // The poll, and the handover stamp once the last chunk has gone. The tick
  // itself is `lib/serve-watch.ts`, which also decides when the socket closes.
  useEffect(() => {
    if (session === null) return
    const tick = createServeWatch(
      session,
      {
        onProgress: (n, total) => setServed({ served: n, chunks: total }),
        onFinished: () => {
          stampSent(repo, now())
          setFinished(true)
        },
        // The session stays until the watcher's grace has passed, so the reply
        // telling the computer why can reach it; the message shows at once.
        onFailed: () => {
          setFailed(
            'jojo could not gather the records on this phone, so nothing was sent. Try again.',
          )
        },
      },
      Date.now,
    )
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [session, repo, now])

  // The socket closes and the camera stops when the panel goes away. A socket
  // left listening is a port open on somebody's network with nothing on screen.
  useEffect(() => {
    return () => {
      setScanning(false)
      session?.stop()
    }
  }, [session])

  if (!able) {
    return (
      <Panel>
        <PanelTitle hint="not available on this device">Send to a computer</PanelTitle>
        <Txt size="sm" tone="muted">
          This device has no secure random number generator, so jojo will not agree a key on it.
          Pairing is disabled rather than done weakly.
        </Txt>
      </Panel>
    )
  }

  const lost =
    carried === null || carried.unreadable === 0
      ? ''
      : ` ${String(carried.unreadable)} document${carried.unreadable === 1 ? '' : 's'} could not be read and stayed behind.`

  return (
    <Panel>
      <PanelTitle hint="point at the code on your computer">Send to a computer</PanelTitle>

      {scanning ? (
        <View style={styles.viewfinder}>
          <PairingScanner onOffer={onOffer} />
        </View>
      ) : (
        <View style={[styles.resting, { backgroundColor: c.well, borderColor: c.hairline }]}>
          {finished ? (
            <>
              <Txt size="sm" weight="semibold" center>
                Everything was handed over
              </Txt>
              <Txt size="sm" tone="muted" center style={{ marginTop: space[2] }}>
                {`Your computer asks before it replaces anything. Nothing on this phone has changed.${lost}`}
              </Txt>
              <Pressable
                accessibilityRole="button"
                onPress={again}
                style={[styles.action, { borderColor: c.hairline }]}
              >
                <Txt size="sm" weight="semibold">
                  Send again
                </Txt>
              </Pressable>
            </>
          ) : session !== null && failed === null ? (
            <>
              <Txt size="sm" tone="muted" center>
                Type this on your computer
              </Txt>
              <Txt size="xxl" weight="semibold" mono center style={{ marginTop: space[2] }}>
                {groupCode(encodeAddress(session.address))}
              </Txt>
              <Txt size="xs" tone="muted" center style={{ marginTop: space[2] }}>
                {served.served === 0
                  ? 'Paired. This phone is waiting on your local network for your computer to ask.'
                  : served.chunks === null
                    ? 'Handing over your records…'
                    : `Handing over your records — ${String(served.served)} of ${String(served.chunks)}.`}
              </Txt>
              {/* Always a way out: the computer may have given up, or this
                  may be the wrong one. Nothing on this phone changes. */}
              <Pressable
                accessibilityRole="button"
                onPress={again}
                style={[styles.action, { borderColor: c.hairline }]}
              >
                <Txt size="sm" weight="semibold">
                  Cancel
                </Txt>
              </Pressable>
            </>
          ) : (
            <>
              <Txt size="sm" tone="muted" center>
                {failed ??
                  (access !== null && access !== 'granted'
                    ? CAMERA_REFUSED[access]
                    : 'On your computer, open Transfer, choose Receive from phone, and scan the code it shows. Both need to be on the same local network.')}
              </Txt>
              {access === 'blocked' ? null : (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    if (session !== null) again()
                    void start()
                  }}
                  style={[styles.action, { borderColor: c.hairline }]}
                >
                  <Txt size="sm" weight="semibold">
                    {failed === null && access === null ? 'Scan the code' : 'Try again'}
                  </Txt>
                </Pressable>
              )}
            </>
          )}
        </View>
      )}
    </Panel>
  )
}

const styles = StyleSheet.create({
  viewfinder: { height: 320, borderRadius: 12, overflow: 'hidden' },
  resting: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 20 },
  action: {
    marginTop: 16,
    alignSelf: 'center',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
})
