/**
 * Where to connect, in a form a person can read off one screen and type into
 * another — and the rule for which addresses jojo will connect to at all.
 *
 * Two devices with cameras do not need this: the animation carries everything.
 * A desktop and a laptop have no cameras between them, so the same facts have to
 * survive being read aloud, written on paper, or typed with one hand.
 *
 * ## The address is ENCODED, not hashed
 *
 * A hash is one-way by construction, so a hashed address cannot be turned back
 * into an address by anyone, including the device that needs it. What the typed
 * path needs is a reversible encoding, which is what this is.
 *
 * It is worth being clear about what that does and does not protect, because the
 * instinct to hide the address is a reasonable one that buys less than it looks
 * like. A private address is drawn from a very small space — a home network is
 * 254 candidates, and anything on the link can enumerate all of them faster than
 * a person can type. Concealing it is not a security measure and this file does
 * not pretend otherwise. What actually stops a stranger connecting is the shared
 * secret in `pairing.ts`, which is a separate value with real entropy behind it.
 * The address says WHERE; the secret says WHO. Only the second one is load
 * bearing, and conflating them is how a design ends up feeling secure without
 * being it.
 *
 * ## The alphabet
 *
 * Crockford's base32: ten digits and twenty-two letters, with I, L, O and U
 * removed. The first three because they are the characters people confuse with 1
 * and 0 when copying between screens, and U because dropping it keeps accidental
 * English out of generated codes. Decoding is case-insensitive and forgiving —
 * `1` for `I`, `0` for `O` — because the person typing did not choose the
 * alphabet and should not be punished by it.
 *
 * ## Which addresses jojo will dial
 *
 * `isPrivateAddress` is the part with teeth. It is what keeps a transfer off the
 * internet, and it is deliberately a rule about ADDRESSES rather than a claim
 * about wifi — see its own note for why that distinction is the honest one.
 */

/** IPv4 and a port, which is what a LAN transfer actually needs. */
export type DialAddress = {
  /** Four octets, high to low. */
  host: readonly [number, number, number, number]
  port: number
}

/** 4 host bytes + 2 port bytes. */
const ADDRESS_BYTES = 6

/** I, L, O and U are absent. Order defines the encoding. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Characters people substitute, mapped to what they meant. */
const FORGIVE: Readonly<Record<string, string>> = { I: '1', L: '1', O: '0', U: 'V' }

export type DialFailure =
  /** Characters that are not in the alphabet, even after forgiving the usual slips. */
  | 'dial/unreadable'
  /** The right characters, wrong number of them. */
  | 'dial/length'
  /** Reads cleanly but the check character disagrees — a typo, not a code. */
  | 'dial/mistyped'

export type DialResult<T> = { ok: true; value: T } | { ok: false; error: DialFailure }

/**
 * Two check characters over the payload.
 *
 * Not integrity in the security sense — `pairing.ts` owns that. This catches the
 * ordinary typing mistakes, and it is worth two characters because the
 * alternative is a connection attempt to a machine that is not there, timing out
 * after several seconds, with nothing on screen to suggest the code was simply
 * mistyped.
 *
 * Position-weighted, so two characters swapped — the commonest slip of all —
 * changes the result where a plain sum would not.
 *
 * The modulus is doing specific work, and it is worth stating exactly what,
 * because the obvious justification is wrong. A single check character (mod 32)
 * is not enough: a substitution changes the sum by `d * (i + 1)`, and with an
 * even weight and `d` a multiple of 16 that product vanishes mod 32, so real
 * typos survive. That was measured on the first cut of this file, which is why
 * there are two characters rather than one.
 *
 * An error vanishes only when its swing is a nonzero multiple of the modulus. A
 * wrong character swings `d * (i + 1)` with `|d| <= 31` and `i + 1 <= 10`, so at
 * most 310; a transposition swings at most 31 x 9 = 279. Any modulus above 310
 * therefore catches every one of both, by inspection and with no arithmetic to
 * check. That is a SUFFICIENT condition, not a necessary one — 256 and 309 also
 * happen to be safe, because neither factors into a weight under 10 and a
 * difference under 31 — but "above the largest swing" is the version a reader
 * can verify without doing the factorisation, which is why it is the rule stated
 * here.
 *
 * 1024 is chosen from that range because it is exactly the ten bits two base32
 * characters hold, leaving no unreachable values at the top.
 *
 * A prime was used first, on the reasoning that it would also protect
 * multi-character errors. It does not, at these sizes: three wrong characters
 * swing at most 31 x (8 + 9 + 10) = 837, which cannot reach 1024 either. The
 * primality was decoration and the comment claiming otherwise was wrong.
 */
const CHECK_MODULUS = 1024

function checkOf(values: readonly number[]): number {
  let sum = 0
  for (let i = 0; i < values.length; i += 1) sum = (sum + values[i]! * (i + 1)) % CHECK_MODULUS
  return sum
}

const toBytes = (address: DialAddress): Uint8Array =>
  new Uint8Array([...address.host, (address.port >> 8) & 0xff, address.port & 0xff])

/**
 * Six bytes as ten base32 characters plus a check character.
 *
 * Forty-eight bits do not divide into five-bit groups, so the last group is
 * padded with two zero bits rather than a padding character: a code a person
 * types should not end in punctuation that means nothing to them.
 */
export function encodeAddress(address: DialAddress): string {
  const bytes = toBytes(address)
  const values: number[] = []
  let acc = 0
  let bits = 0
  for (const byte of bytes) {
    acc = (acc << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      values.push((acc >> bits) & 0x1f)
    }
  }
  if (bits > 0) values.push((acc << (5 - bits)) & 0x1f)
  const check = checkOf(values)
  values.push((check >> 5) & 0x1f, check & 0x1f)
  return values.map((v) => ALPHABET[v]!).join('')
}

/** Strips anything that is not a code character, and forgives the usual slips. */
function normalise(text: string): number[] | null {
  const out: number[] = []
  for (const raw of text.toUpperCase()) {
    // Spaces, dashes and the grouping people add themselves. Never significant.
    if (raw === ' ' || raw === '-' || raw === '\t') continue
    const ch = FORGIVE[raw] ?? raw
    const value = ALPHABET.indexOf(ch)
    if (value < 0) return null
    out.push(value)
  }
  return out
}

export function decodeAddress(text: string): DialResult<DialAddress> {
  const values = normalise(text)
  if (values === null) return { ok: false, error: 'dial/unreadable' }
  // Ten payload characters and two check characters.
  if (values.length !== 12) return { ok: false, error: 'dial/length' }

  const payload = values.slice(0, 10)
  if (checkOf(payload) !== ((values[10]! << 5) | values[11]!)) {
    return { ok: false, error: 'dial/mistyped' }
  }

  const bytes = new Uint8Array(ADDRESS_BYTES)
  let acc = 0
  let bits = 0
  let at = 0
  for (const value of payload) {
    acc = (acc << 5) | value
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes[at] = (acc >> bits) & 0xff
      at += 1
    }
  }

  return {
    ok: true,
    value: {
      host: [bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!],
      port: (bytes[4]! << 8) | bytes[5]!,
    },
  }
}

/** Three groups of four, which is how people read a code back to each other. */
export function groupCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? []).join('-')
}

export const formatAddress = (address: DialAddress): string =>
  `${address.host.join('.')}:${address.port}`

/**
 * Whether jojo will dial this address.
 *
 * ## What this enforces, stated precisely
 *
 * That the address is in a PRIVATE range. Not that the other device is on your
 * wifi — nothing a browser can run establishes that, and it is worth saying
 * exactly why rather than implying a stronger guarantee than the code delivers:
 *
 *   - Omitting STUN and TURN does not do it. Two devices in one room on
 *     different networks, both with global IPv6, connect directly over the
 *     internet — which is precisely the case the requirement is about, and the
 *     case physical proximity makes likely.
 *   - Comparing subnets does not do it either. A browser cannot reliably learn
 *     its own address, the peer's address is self-reported, and the answer is
 *     wrong in both directions: bridged wired-and-wireless networks share a
 *     subnet without sharing a link, and a VPN splits one wifi across two.
 *   - A hop limit of 1 WOULD do it, and no browser can set one.
 *
 * So this rejects everything routable and accepts what is not. A machine reached
 * at 10.x across a corporate VPN passes — it is genuinely a private address, and
 * genuinely on the other side of the world. That case is a false positive this
 * rule cannot see, and the UI should say "a private network address" rather than
 * "your wifi", because that is the sentence this function can actually back.
 *
 * What it does deliver is the thing that matters most here: the bytes cannot
 * take a route across the public internet by accident. Given the pairing secret
 * already proves the peer is one the user introduced, accidental routing — not a
 * remote attacker — is the risk left standing.
 */
export function isPrivateAddress(address: DialAddress): boolean {
  const [a, b] = address.host
  // 10.0.0.0/8
  if (a === 10) return true
  // 172.16.0.0/12 — note the mask: 172.15 and 172.32 are public.
  if (a === 172 && b >= 16 && b <= 31) return true
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true
  // 169.254.0.0/16, what a device assigns itself with no DHCP. Genuinely
  // link-local, and the only range here that cannot be routed at all.
  if (a === 169 && b === 254) return true
  // 127.0.0.0/8 — the same machine. Allowed because two jojo instances on one
  // computer is a real case when someone is trying this out.
  if (a === 127) return true
  /*
   * NOT 100.64.0.0/10. Carrier-grade NAT looks private and is not: it is the
   * address space an ISP puts between a customer and the internet, so two
   * devices there are on the same CARRIER, not the same network, and traffic
   * between them crosses infrastructure nobody in the room controls.
   */
  return false
}

/**
 * Whether two addresses share a /24.
 *
 * ADVISORY, and offered as such — see `isPrivateAddress` for why no check
 * available here is enforcing. Useful for one thing only: telling a person who
 * is about to wait for a timeout that the two machines look like they are on
 * different networks. A hint before a wait, not a gate.
 */
export const looksSameNetwork = (a: DialAddress, b: DialAddress): boolean =>
  a.host[0] === b.host[0] && a.host[1] === b.host[1] && a.host[2] === b.host[2]
