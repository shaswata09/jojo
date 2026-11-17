import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { PairingScanner } from '@/components/transfer/PairingScanner'
import { cameraRefused, ensureCamera, type CameraAccess } from '@/lib/camera-permission'
import { encodeAddress, groupCode } from '@jojo/service/core/dial'
import { sizeLabel } from '@jojo/service/core/files'
import { canPair } from '@jojo/service/crypto/noble-secrets'
import { useKg } from '@jojo/service/react/kg-context'
import { beginReceiving, receiveAdvice, type ReceiveSession } from '@/lib/handoff-receive'
import { applyPlan } from '@/lib/restore-received'
import { landedText } from '@/lib/import-backup'
import { createLanding } from '@/lib/receive-landing'
import { actionFor, recordAnswer } from '@/lib/receive-decision'
import type { SheetAnswer } from '@/lib/receive-decision'
import type { RestorePlan } from '@jojo/service/core/backup'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'
import { useDomain } from '@/i18n/domain'

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
  const { t } = useTranslation('transfer')
  const domain = useDomain()
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
  /**
   * How the person answered, rather than what to do about it.
   *
   * Both of `ConfirmSheet`'s handlers only write here, because it calls
   * `onClose()` and THEN `onConfirm()` on the confirm button — see
   * `lib/receive-decision.ts` for what that did to a panel that acted inside
   * `onClose`. Recorded with a functional update so neither call can be built on
   * a stale reading of the other.
   */
  const [answer, setAnswer] = useState<SheetAnswer>('unanswered')
  const { repo } = useKg()

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
    /*
     * Clear what the last attempt left, as `SendPanel`'s `start` does. A decline
     * or a failed `beginReceiving` leaves `failed` set with no session, Retry
     * lands here rather than in `reset()`, and the code is only drawn while
     * `failed` is null: the next scan opened a listener whose code never showed.
     */
    setFailed(null)
    setLanded(null)
    setBytes(0)
    const granted = await ensureCamera()
    setAccess(granted)
    if (granted === 'granted') setScanning(true)
  }, [])

  /** Whether the panel is still on screen — see the same guard in `SendPanel`. */
  const mounted = useRef(true)
  useEffect(
    () => () => {
      mounted.current = false
    },
    [],
  )

  const onOffer = useCallback(async (offer: Uint8Array) => {
    setScanning(false)
    const started = await beginReceiving(offer)
    if (!started.ok) {
      setFailed(receiveAdvice(started.error))
      return
    }
    if (!mounted.current) {
      started.value.stop()
      return
    }
    setSession(started.value)
  }, [])

  /**
   * Back to the start: the socket closed and a fresh scan offered.
   *
   * Once a session existed this panel had no button at all, so when the
   * computer gave up the phone kept listening on the LAN with a dead code on
   * screen (transfer audit, 2026-11-16). Nothing on the phone has changed at
   * this point: it acts only on a whole transfer, and only after asking.
   */
  const reset = useCallback(() => {
    session?.stop()
    setSession(null)
    setBytes(0)
    setFailed(null)
    setLanded(null)
  }, [session])

  /**
   * Watches the stream, and lands it once it is whole.
   *
   * The tick itself is `lib/receive-landing.ts`, and the "only once" flag went
   * with it. It used to be a ref up here that the confirmation sheet's
   * `onClose` cleared — so declining re-opened the sheet 250 ms later, and
   * because `ConfirmSheet` runs `onClose()` before `onConfirm()`, agreeing
   * re-offered the same backup while the first `applyPlan` was still writing.
   * A latch anything on screen can clear is not a latch.
   *
   * Keyed on `session` alone. A new landing means a new latch, and a new
   * session is the only thing that should produce one; `repo` was in these deps
   * and is not read here, so leaving it in would have handed out a fresh latch
   * on a context change.
   */
  useEffect(() => {
    if (session === null) return
    const tick = createLanding(session, {
      onBytes: setBytes,
      onPlan: setPending,
      onFailure: setFailed,
    })
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [session])

  useEffect(() => {
    // The camera stops and the socket closes when the panel goes away. A scanner
    // left running is a green light on someone's phone with nothing on screen to
    // explain it; a socket left listening is worse, because nothing shows at all.
    return () => {
      setScanning(false)
      session?.stop()
    }
  }, [session])

  /**
   * Writes the plan the person agreed to. Destroys what is on this phone now.
   *
   * Hoisted above the `able` gate and memoised because the effect below is what
   * calls it; it used to be an `onConfirm` handler, which is precisely how it
   * came to run in the wreckage `onClose` had already made.
   */
  const applyPending = useCallback(
    (plan: RestorePlan) => {
      void applyPlan(repo, plan, new Date().toISOString(), { handover: true }).then((done) => {
        // The computer is asking what happened here; it stamps its own
        // handover only if the records were taken.
        session?.settle(done.ok ? 'applied' : 'failed')
        if (!done.ok) {
          setFailed(done.message)
          return
        }
        // The skipped count is said out loud rather than rounded away. A person
        // checking their records against the other device needs to know the
        // number is short before they go looking for what is missing.
        setLanded(landedText(done))
      })
    },
    [repo, session],
  )

  /**
   * Acts on the answer, once, after BOTH of `ConfirmSheet`'s handlers have had
   * their say.
   *
   * The handlers only record; this is the only thing in the panel that writes,
   * declines or resets. Doing it here rather than in `onConfirm` is what makes
   * the two paths exclusive: a confirm used to arrive with the decline already
   * run — session dropped, byte count zeroed, "Nothing was changed." on screen —
   * and then start replacing every record on the phone underneath that sentence.
   *
   * Declining still means dropping the SESSION, not the poll's latch. The latch
   * belongs to `createLanding` and `core/convoy.ts` never un-sets `complete`, so
   * clearing it re-offers the same backup 250 ms later and Cancel cannot cancel.
   * But leaving the session standing wedges the screen the other way: the
   * listener has already been stopped by the landing, so the middle branch would
   * go on showing the pairing code and "Everything on this phone will be
   * replaced" over nothing at all. Dropping it renders the third branch, which
   * has the sentence and a button that starts a fresh pairing with a fresh latch.
   */
  useEffect(() => {
    if (answer === 'unanswered') return
    const action = actionFor(answer, pending)
    setAnswer('unanswered')
    if (action.kind === 'wait') return
    setPending(null)
    if (action.kind === 'decline') {
      // Said before the session is dropped: dropping it stops the socket, and
      // a settled session keeps listening just long enough for the computer
      // to hear "declined" and not stamp a handover that never happened.
      session?.settle('declined')
      setSession(null)
      setBytes(0)
      setFailed(action.message)
      return
    }
    applyPending(action.plan)
  }, [answer, pending, applyPending, session])

  if (!able) {
    return (
      <Panel>
        <PanelTitle hint={t('pairing.unavailableHint')}>{t('receive.title')}</PanelTitle>
        <Txt size="sm" tone="muted">
          {t('pairing.noRandom')}
        </Txt>
      </Panel>
    )
  }

  return (
    <Panel>
      <PanelTitle hint={t('receive.hint')}>{t('receive.title')}</PanelTitle>

      {scanning ? (
        <View style={styles.viewfinder}>
          <PairingScanner onOffer={onOffer} />
        </View>
      ) : (
        <View style={[styles.resting, { backgroundColor: c.well, borderColor: c.hairline }]}>
          {landed !== null ? (
            <>
              <Txt size="sm" weight="semibold" center>
                {t('receive.complete')}
              </Txt>
              <Txt size="sm" tone="muted" center style={{ marginTop: space[2] }}>
                {landed}
              </Txt>
              <Pressable
                accessibilityRole="button"
                onPress={reset}
                style={[styles.action, { borderColor: c.hairline }]}
              >
                <Txt size="sm" weight="semibold">
                  {t('receive.done')}
                </Txt>
              </Pressable>
            </>
          ) : session !== null && failed === null ? (
            <>
              <Txt size="sm" tone="muted" center>
                {t('receive.typeThis')}
              </Txt>
              <Txt size="xxl" weight="semibold" mono center style={{ marginTop: space[2] }}>
                {groupCode(encodeAddress(session.address))}
              </Txt>
              <Txt size="xs" tone="muted" center style={{ marginTop: space[2] }}>
                {bytes === 0
                  ? t('receive.paired')
                  : t('receive.progress', { size: sizeLabel(bytes) })}
              </Txt>
              <Pressable
                accessibilityRole="button"
                onPress={reset}
                style={[styles.action, { borderColor: c.hairline }]}
              >
                <Txt size="sm" weight="semibold">
                  {t('pairing.cancel')}
                </Txt>
              </Pressable>
            </>
          ) : (
            <>
              <Txt size="sm" tone="muted" center>
                {failed ??
                  (access !== null && access !== 'granted'
                    ? cameraRefused(access)
                    : t('receive.intro'))}
              </Txt>
              {access === 'blocked' ? null : (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    if (session !== null) reset()
                    void start()
                  }}
                  style={[styles.action, { borderColor: c.hairline }]}
                >
                  <Txt size="sm" weight="semibold">
                    {failed === null && access === null ? t('pairing.scan') : t('pairing.retry')}
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
        /*
         * Both handlers RECORD and neither acts — the effect above acts, once,
         * with both answers in.
         *
         * `ConfirmSheet` runs `onClose()` and then `onConfirm()` on the confirm
         * button, so this handler used to be the decline path executing on the
         * way into a restore: it dropped the session, zeroed the byte count and
         * put "Nothing was changed." on screen, and then every record on the
         * phone was replaced under that sentence. `recordAnswer` makes confirm
         * sticky, so the order the two arrive in stops mattering.
         */
        onClose={() => setAnswer((a) => recordAnswer(a, 'closed'))}
        title={t('receive.confirm.title')}
        description={
          pending === null
            ? ''
            : t('receive.confirm.description', {
                contents: domain.backup(pending),
                replaces: domain.replaces(pending, 'phone'),
              })
        }
        confirmLabel={t('receive.confirm.confirm')}
        tone="danger"
        onConfirm={() => setAnswer((a) => recordAnswer(a, 'confirmed'))}
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
