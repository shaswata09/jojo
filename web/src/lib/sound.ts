import { readStored, writeStored } from '@/lib/storage'

const SOUND_KEY = 'jojo.sound'

/** Sound is opt-out: on by default, remembered once changed. */
export function isSoundEnabled(): boolean {
  return readStored(SOUND_KEY) !== 'off'
}

export function setSoundEnabled(on: boolean) {
  writeStored(SOUND_KEY, on ? 'on' : 'off')
}

/**
 * One AudioContext for the app.
 *
 * Created lazily inside a click handler — browsers block contexts constructed
 * before a user gesture, and one per click would leak hardware audio nodes.
 */
let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext()
    // Safari suspends the context when it loses focus; nudge it awake.
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null // no Web Audio (old browser, or blocked) — stay silent
  }
}

/**
 * A mechanical switch click, synthesised rather than loaded.
 *
 * A noise burst through a narrow bandpass with a very fast decay is what a
 * physical switch actually sounds like — a tone would read as a beep. No audio
 * file means no network request, which matters for a local-first app, and no
 * asset to ship.
 */
export function playSwitchClick() {
  if (!isSoundEnabled()) return
  const ac = audio()
  if (!ac) return

  const duration = 0.028
  const frames = Math.floor(ac.sampleRate * duration)
  const buffer = ac.createBuffer(1, frames, ac.sampleRate)
  const data = buffer.getChannelData(0)

  for (let i = 0; i < frames; i++) {
    // Steep exponential decay — the transient is the whole sound.
    const decay = (1 - i / frames) ** 9
    data[i] = (Math.random() * 2 - 1) * decay
  }

  const source = ac.createBufferSource()
  source.buffer = buffer

  const band = ac.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 2400
  band.Q.value = 1.1

  // Quiet on purpose: this is a confirmation, not an alert.
  const gain = ac.createGain()
  gain.gain.value = 0.09

  source.connect(band).connect(gain).connect(ac.destination)
  source.start()
  source.stop(ac.currentTime + duration)
}
