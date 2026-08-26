import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { PairingScanner } from '@/components/transfer/PairingScanner'
import { CAMERA_REFUSED, ensureCamera, type CameraAccess } from '@/lib/camera-permission'
import { encodeAddress, groupCode } from '@jojo/service/core/dial'
import { sizeLabel } from '@jojo/service/core/files'
import { canPair } from '@jojo/service/crypto/noble-secrets'
import { useKg } from '@jojo/service/react/kg-context'
import { RECEIVE_ADVICE, beginReceiving, type ReceiveSession } from '@/lib/handoff-receive'
import { applyPlan, planReceived } from '@/lib/restore-received'
import { describeBackup } from '@jojo/service/core/backup'
import type { RestorePlan } from '@jojo/service/core/backup'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/**
 * The receiving half: point the camera at the other device and agree a key.
 *
 * This used to say "Nothing is listening. Receiving needs the pairing service
 * this build does not open." That was true and is not any more — a code read
 * here completes a real X25519 agreement against the offer on the other screen.
 *
 * ## The three steps, and the one the person has to do
 *
 * Scanning agrees the key. Opening a socket makes this phone reachable. Neither
 * needs anybody. What does need somebody is the ADDRESS: a browser cannot
 * discover a phone on the network — there is no API for it — so the address is
 * shown here as twelve characters to type into the other device. That is the
 * whole reason `core/dial.ts` exists, and the reason it catches every single
 * mistyped character rather than letting a wrong address time out silently.
 *
 * ## The fourth step, which used to be missing
 *
 * Landing what arrived. `beginReceiving` returned a session with `payload()` on
 * it and nothing ever called it: the phone agreed a key, held a socket open,
 * decrypted the stream, authenticated every chunk, and then dropped the backup.
 * Everything expensive and everything dangerous was done correctly and nothing
 * was kept. That is what `applyReceived` closes.
 *
 * ## Why it polls
 *
 * The socket is driven by the other device — chunks arrive on the server's
 * callback, far from React — so there is no event this component can subscribe
 * to. A timer reading `progress()` is the honest shape for that, and the
 * interval is slow enough not to matter and fast enough that the bar moves.
 */
export function ReceivePanel() {
  const c = useColors()
  const [access, setAccess] = useState<CameraAccess | null>(null)
  const [scanning, setScanning] = useState(false)
  const [session, setSession] = useState<ReceiveSession | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [bytes, setBytes] = useState(0)
  const [landed, setLanded] = useState<string | null>(null)
  /**
   * An authenticated backup waiting for the person to agree to it.
   *
   * Held rather than applied. The bytes are already verified — GCM ruled out
   * tampering before this — so the only question left is the one nobody was
   * asking: do you want what is on this phone replaced?
   */
  const [pending, setPending] = useState<RestorePlan | null>(null)
  const { repo } = useKg()

  /**
   * Latched the instant the last chunk authenticates.
   *
   * A ref rather than state, because the poll below closes over it and must see
   * the CURRENT value: restoring is not idempotent — it replaces the whole
   * store — and a second run started by the next tick would replace what the
   * first one had just written.
   */
  const applying = useRef(false)

  /*
   * Whether this device can hold a key at all, asked before the camera is.
   *
   * On a phone with no secure random source `canPair()` is false — see
   * `lib/secure-random.ts` for how that state arises and why it is a refusal
   * rather than a fallback. Asking for the camera first would mean requesting a
   * permission for a feature that could not have worked.
   */
  const [able] = useState(canPair)

  const start = useCallback(async () => {
    const granted = await ensureCamera()
    setAccess(granted)
    if (granted === 'granted') setScanning(true)
  }, [])

  const onOffer = useCallback(async (offer: Uint8Array) => {
    setScanning(false)
    const started = await beginReceiving(offer)
    if (!started.ok) {
      setFailed(RECEIVE_ADVICE[started.error])
      return
    }
    setSession(started.value)
  }, [])

  /**
   * Watches the stream, and lands it once it is whole.
   *
   * `complete` means the final chunk authenticated, which is the only point at
   * which any of this is safe to act on: `core/convoy.ts` puts the final flag
   * in the AAD precisely so that a truncated transfer cannot masquerade as a
   * finished one. Restoring at any earlier moment would mean replacing the
   * person's records with part of a backup.
   */
  useEffect(() => {
    if (session === null) return
    const id = setInterval(() => {
      const at = session.progress()
      setBytes(at.bytes)
      if (!at.complete || applying.current) return
      applying.current = true

      const payload = session.payload()
      if (payload === null) return
      // Nothing more is coming, and a socket left listening after the transfer
      // is a port open on somebody's phone with nothing on screen about it.
      session.stop()

      /*
       * Read, then ASK. Applying used to start here, and `replaceAll` took
       * every record, every document and the journal off the phone with nothing
       * on screen having asked. Pairing is consent to receive; it is not
       * consent to destroy what is already here.
       */
      const read = planReceived(payload)
      if (!read.ok) {
        setFailed(read.message)
        return
      }
      setPending(read.plan)
    }, 250)
    return () => clearInterval(id)
  }, [session, repo])

  useEffect(() => {
    // The camera stops and the socket closes when the panel goes away. A scanner
    // left running is a green light on someone's phone with nothing on screen to
    // explain it; a socket left listening is worse, because nothing shows at all.
    return () => {
      setScanning(false)
      session?.stop()
    }
  }, [session])

  if (!able) {
    return (
      <Panel>
        <PanelTitle hint="not available on this device">Receive</PanelTitle>
        <Txt size="sm" tone="muted">
          This device has no secure random number generator, so jojo will not agree a key on it.
          Pairing is disabled rather than done weakly.
        </Txt>
      </Panel>
    )
  }

  /** Writes the plan the person just agreed to. Destroys what is here now. */
  const applyPending = () => {
    const plan = pending
    if (plan === null) return
    setPending(null)
    void applyPlan(repo, plan, new Date().toISOString()).then((done) => {
      if (!done.ok) {
        setFailed(done.message)
        return
      }
      const files =
        done.documents === 0
          ? ''
          : `, ${String(done.documents)} document${done.documents === 1 ? '' : 's'}`
      // The skipped count is said out loud rather than rounded away. A person
      // checking their records against the other device needs to know the
      // number is short before they go looking for what is missing.
      const lost = done.skipped === 0 ? '' : ` ${String(done.skipped)} could not be read.`
      setLanded(`${String(done.nodes)} records are on this phone${files}.${lost}`)
    })
  }

  return (
    <Panel>
      <PanelTitle hint="point at the code on the other device">Receive</PanelTitle>

      {scanning ? (
        <View style={styles.viewfinder}>
          <PairingScanner onOffer={onOffer} />
        </View>
      ) : (
        <View style={[styles.resting, { backgroundColor: c.well, borderColor: c.hairline }]}>
          {landed !== null ? (
            <>
              <Txt size="sm" weight="semibold" center>
                Transfer complete
              </Txt>
              <Txt size="sm" tone="muted" center style={{ marginTop: space[2] }}>
                {landed}
              </Txt>
            </>
          ) : session !== null ? (
            <>
              <Txt size="sm" tone="muted" center>
                Type this on your other device
              </Txt>
              <Txt size="xxl" weight="semibold" mono center style={{ marginTop: space[2] }}>
                {groupCode(encodeAddress(session.address))}
              </Txt>
              <Txt size="xs" tone="muted" center style={{ marginTop: space[2] }}>
                {bytes === 0
                  ? 'Paired. This phone is listening on your local network and nowhere else.'
                  : `Receiving — ${sizeLabel(bytes)} so far. Everything on this phone will be replaced.`}
              </Txt>
            </>
          ) : (
            <>
              <Txt size="sm" tone="muted" center>
                {failed ??
                  (access !== null && access !== 'granted'
                    ? CAMERA_REFUSED[access]
                    : 'Open jojo on your computer, choose Transfer, and scan the code it shows.')}
              </Txt>
              {access === 'blocked' ? null : (
                <Pressable
                  accessibilityRole="button"
                  onPress={start}
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

      {/* The gate. Names what is arriving AND what it replaces, because
          "5,301 records" alone does not tell somebody they are about to lose
          the twelve they added on this phone this morning. */}
      <ConfirmSheet
        open={pending !== null}
        onClose={() => {
          setPending(null)
          /*
           * The latch has to come off too. `applying.current` is set when the
           * stream completes so the 250 ms poll cannot fire twice — but with
           * the apply now behind a question, leaving it set means a person who
           * says no can never be offered the transfer again without leaving the
           * screen. Declining is not a reason to break the next attempt.
           */
          applying.current = false
          setFailed('Nothing was changed. The other device can send again.')
        }}
        title="Replace everything on this phone?"
        description={
          pending === null
            ? ''
            : `${describeBackup(pending)} All of it replaces what is here now — every application, document and reminder on this phone goes, and that cannot be undone.`
        }
        confirmLabel="Replace"
        tone="danger"
        onConfirm={applyPending}
      />
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
