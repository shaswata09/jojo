/**
 * Q129, the phone-to-computer half: what a person sees on each device, and the
 * order the computer does things in — read as source, because the panels and
 * the hook cannot be mounted here (D20).
 *
 * The protocol itself is tested for real elsewhere: both directions and every
 * refusal in `service/kg/crypto/handoff-pull.test.ts` and `service/kg/core/handoff.test.ts`, the
 * computer's run in `handoff-pull.test.ts` beside this file, the phone's
 * handler in `mobile/src/lib/handoff-serve.test.ts`.
 */

import { describe, expect, it } from 'vitest'
import pullSource from './handoff-pull.ts?raw'
import transferSource from '@/routes/Transfer.tsx?raw'
import receiveSource from '@/components/transfer-ui/ReceivePanel.tsx?raw'
import dataPanelSource from '@/components/settings/DataPanel.tsx?raw'
import phoneScreenSource from '../../../mobile/src/screens/TransferScreen.tsx?raw'
import phoneSendSource from '../../../mobile/src/components/transfer/SendPanel.tsx?raw'
import phoneServeSource from '../../../mobile/src/lib/handoff-serve.ts?raw'
import { pullConfirmCopy } from '@/lib/handoff-pull'
import settingsCatalog from '@/i18n/locales/en/settings.json'
import transferCatalog from '@/i18n/locales/en/transfer.json'
import phoneCatalogSource from '../../../mobile/src/i18n/locales/en/transfer.json?raw'

/** The phone's English `transfer` catalog — read raw, since it sits outside this project. */
const phoneCatalog = JSON.parse(phoneCatalogSource) as {
  screen: { subtitle: string; roles: { send: string } }
  send: { intro: string }
}

const strip = (source: string) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')

describe('what the person sees (Q129)', () => {
  it('offers "Send to a computer" on the phone', () => {
    expect(strip(phoneScreenSource)).toContain("const ROLES = ['send', 'receive'] as const")
    expect(strip(phoneScreenSource)).toContain('label: t(`screen.roles.${value}`)')
    expect(phoneCatalog.screen.roles.send).toBe('Send to a computer')
    expect(strip(phoneScreenSource)).toContain("role === 'send' ? <SendPanel /> : <ReceivePanel />")
    expect(strip(phoneScreenSource)).not.toMatch(/not possible from a phone/)
    expect(phoneCatalogSource).not.toMatch(/not possible from a phone/)
  })

  it('offers "Receive from phone" on the computer, with a real panel behind it', () => {
    const page = strip(transferSource)
    expect(page).toContain("const ROLES = ['send', 'receive'] as const")
    expect(page).toContain('label: t(`page.roles.${value}`)')
    expect(transferCatalog.page.roles.receive).toBe('Receive from phone')
    expect(page).toContain('<ReceivePanel pull={pull} tokens={pairing.tokens} />')
    // The animation the phone reads is up in both roles.
    expect(page).toContain("usePairingSession(true, role === 'send' ? 'push' : 'pull')")
    const panel = strip(receiveSource)
    expect(panel).toContain("{t('receive.title')}")
    expect(transferCatalog.receive.title).toBe('Receive from phone')
    expect(JSON.stringify(transferCatalog)).not.toMatch(/not possible in a browser/)
  })

  it('shows the phone’s code on its send screen, built from its own address', () => {
    expect(strip(phoneSendSource)).toContain('{groupCode(encodeAddress(session.address))}')
  })

  it('takes the typed code on the computer and starts the pull with it', () => {
    const panel = strip(receiveSource)
    expect(panel).toContain("aria-label={t('receive.codeLabel')}")
    expect(transferCatalog.receive.codeLabel).toBe('The code shown on your phone')
    expect(panel).toContain('void pull.start(code, tokens)')
  })

  it('says on both devices that they must share a local network', () => {
    expect(strip(receiveSource)).toContain("{t('receive.intro')}")
    expect(transferCatalog.receive.intro).toMatch(
      /Both devices need to be on the\s+same\s+local\s+network/,
    )
    expect(strip(phoneSendSource)).toContain("t('send.intro')")
    expect(phoneCatalog.send.intro).toMatch(/Both need to be on the same local network/)
    expect(strip(phoneScreenSource)).toContain("t('screen.subtitle')")
    expect(phoneCatalog.screen.subtitle).toMatch(/Both need to be on the same network/)
  })
})

describe('the computer pulls only after the proof (Q129)', () => {
  const code = strip(pullSource)
  const run = code.slice(code.indexOf('export async function pullFromPhone('))
  const at = (needle: string) => {
    const i = run.indexOf(needle)
    expect(i, needle).toBeGreaterThan(-1)
    return i
  }

  it('dials the address the code decodes to, then checks the proof, then pulls', () => {
    const decoded = at('const read = decodeAddress(code)')
    const asked = at('await fetchPairing(address, path, signal)')
    const keyed = at('const keys = await complete(response.value, path)')
    const refused = at('if (keys === null) return')
    const pulled = at('await runPull<HandoffFailure>(')
    expect(asked).toBeGreaterThan(decoded)
    expect(keyed).toBeGreaterThan(asked)
    expect(refused).toBeGreaterThan(keyed)
    expect(pulled).toBeGreaterThan(refused)
    // The pull is keyed by what the proof produced and nothing else.
    expect(run.slice(pulled, pulled + 120)).toContain('keys,')
  })

  it('sends a pulling phone into the pull direction and nothing else', () => {
    expect(strip(phoneServeSource)).toMatch(/startHandoffServer\([\s\S]*?'pull',\s*\)/)
  })
})

describe('what arrives is restored the way a backup file is (Q129)', () => {
  it('runs the same restore Settings runs for a file', () => {
    expect(strip(pullSource)).toContain('await restoreBackup(repo, blobs, plan, at)')
    expect(strip(dataPanelSource)).toContain('await restoreBackup(repo, blobs, plan,')
    // And the same document store: the vault's, through the same hook.
    expect(strip(pullSource)).toContain('const blobs = useVaultBlobs()')
    expect(strip(dataPanelSource)).toContain('const blobs = useVaultBlobs()')
  })

  it('asks the same "replaces / back up first" question, word for word', () => {
    // Read out of DataPanel's own dialog — its English catalog string — so the
    // two cannot drift apart. Both say what goes through the one
    // `domain.replaces`, then the same words.
    const dialog = settingsCatalog.data.restoreConfirm
    const file = /^That file holds \{\{contents\}\}\. \{\{replaces\}\}(.*)$/.exec(
      dialog.description,
    )?.[1]
    expect(file).toBeTruthy()
    expect(dataPanelSource).toMatch(
      /t\('data\.restoreConfirm\.description', \{\s*contents: domain\.backup\(staged\),\s*replaces: domain\.replaces\(staged, 'computer'\),/,
    )
    const plan = { exportedAt: '', nodes: [], edges: [], documents: [] }
    expect(pullConfirmCopy(plan).description.endsWith(file!)).toBe(true)
    expect(pullSource).toContain("domain.replaces(plan, 'computer')")
    expect(dataPanelSource).toContain("confirmLabel={t('data.restoreConfirm.confirm')}")
    expect(dialog.confirm).toBe(pullConfirmCopy(plan).confirm)
  })

  it('puts the plan behind that dialog, and nothing is written before it is agreed', () => {
    const panel = strip(receiveSource)
    expect(panel).toContain('pullConfirmCopy(pull.plan)')
    expect(panel).toContain('onConfirm={() => void pull.confirm()}')
    const hook = strip(pullSource).slice(
      strip(pullSource).indexOf('export function useHandoffPull('),
    )
    // The run stages the plan; only `confirm` restores.
    const staged = hook.indexOf("setStage('confirming')")
    const restored = hook.indexOf('await restoreFromPhone(')
    const confirm = hook.indexOf('const confirm = useCallback(')
    expect(staged).toBeGreaterThan(-1)
    expect(restored).toBeGreaterThan(confirm)
    expect(confirm).toBeGreaterThan(staged)
  })
})

describe('leaving while the restore runs (review 3, races-3)', () => {
  const code = strip(pullSource)
  const body = (head: string) => {
    const from = code.indexOf(head)
    return code.slice(from, code.indexOf('}, [', from))
  }

  it('does not tell the phone "declined" over a restore that cannot be stopped', () => {
    // Transfer runs `cancel` on every role switch and on unmount.
    expect(strip(transferSource)).toContain('useEffect(() => cancelPull, [role, cancelPull])')
    const cancel = body('const cancel = useCallback(')
    expect(cancel).toContain('if (restoring.current) return')
    expect(cancel.indexOf('if (restoring.current) return')).toBeLessThan(
      cancel.indexOf("tell('declined')"),
    )
  })

  it('tells the phone the real outcome, and paints it only over its own pull', () => {
    const confirm = body('const confirm = useCallback(')
    const flagged = confirm.indexOf('restoring.current = true')
    const restored = confirm.indexOf('await restoreFromPhone(')
    const cleared = confirm.indexOf('restoring.current = false')
    const told = confirm.indexOf("tell(done.ok ? 'applied' : 'failed')")
    const current = confirm.indexOf('if (attempt.current !== mine) return')
    expect(flagged).toBeGreaterThan(-1)
    expect(flagged).toBeLessThan(restored)
    // Cleared in a `finally`, so a restore that throws does not hold `cancel` off for good.
    expect(confirm.slice(restored, cleared)).toContain('finally {')
    expect(told).toBeGreaterThan(cleared)
    expect(current).toBeGreaterThan(told)
    expect(current).toBeLessThan(confirm.indexOf("setStage('done')"))
    expect(body('const start = useCallback(')).toContain('attempt.current += 1')
  })
})
