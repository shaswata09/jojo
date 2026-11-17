/**
 * Whether an address is this machine or the person's own network.
 *
 * In core so both apps read one rule: the web's posting readers (through
 * `web/src/lib/posting-target.ts`, which re-exports this) and the phone's
 * "Keep a copy", which fetched every stylesheet and image a posting page named
 * — `http://192.168.1.1/cgi-bin/config` included — with a fetch that CORS does
 * not govern, and stored the answer in the capture (review 2, security-3).
 *
 * The posting readers open a page as the person — the extension in their
 * signed-in browser, the document reader on their own machine — and hand back
 * whatever came. A posting is on the public web; nobody's job advert lives at
 * 192.168.1.1. The extension refuses these for its own route
 * (`isLocalTarget` in `web/extension/worker/targets.js`); this is the same refusal
 * for the reader's route, which had none (R6), and for the scout's background
 * reads before either route is tried.
 *
 * THE SAME RULE AS THE EXTENSION'S, line for line, and one table in
 * `web/src/lib/posting-target.test.ts` runs both. They disagreed once: the
 * worker caught `127.0.0.1.nip.io` with a prefix test and this copy passed it.
 *
 * Hostname-only, like the extension's: a page cannot see DNS answers. Every
 * literal spelling is closed — including a trailing-dot `localhost.`,
 * carrier-grade NAT (100.64/10), and a single-label host, which on a home
 * network is a machine on it — and so are the public names that exist to
 * resolve to this machine (`localtest.me`, `10.0.0.1.nip.io`). A name somebody
 * registered and pointed at a private address still passes; the reader route
 * is kept off unattended reads for that reason and for its redirects (see
 * `openPage` in `posting-agent.ts`).
 */
export function isLocalTarget(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return true
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true
  const host = url.hostname
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
    .replace(/\.+$/, '')
  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true
    const mapped = mappedIpv4(host)
    if (mapped !== null) return localIpv4(mapped)
    return privateIpv6(host)
  }
  if (!host.includes('.')) return true
  if (LOCAL_SUFFIXES.some((suffix) => under(host, suffix))) return true
  if (LOOPBACK_DOMAINS.some((domain) => under(host, domain))) return true
  const octets = ipv4Octets(host)
  if (octets !== null) return localIpv4(octets)
  return embedsLocalIpv4(host)
}

/** Suffixes that only ever name a machine on the person's own network. */
const LOCAL_SUFFIXES = ['local', 'internal', 'lan', 'home.arpa']

/**
 * Public DNS names that answer with a loopback or private address — for every
 * name under them, or for whatever address is written into the name (including
 * nip.io's hex spelling, which cannot be read back any other way). The worker's
 * `LOOPBACK_DOMAINS` says more.
 */
const LOOPBACK_DOMAINS = [
  'localtest.me',
  'lvh.me',
  'vcap.me',
  'lacolhost.com',
  'localho.st',
  'fuf.me',
  'local.gd',
  'localhost.direct',
  'traefik.me',
  'nip.io',
  'sslip.io',
  'xip.io',
]

const under = (host: string, domain: string): boolean =>
  host === domain || host.endsWith(`.${domain}`)

/** The four octets of a dotted-decimal IPv4 address, or null for anything else. */
function ipv4Octets(host: string): number[] | null {
  const parts = host.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : -1))
  return octets.some((n) => n < 0 || n > 255) ? null : octets
}

/** 127/8 and 0/8 (this host), RFC 1918, link-local, and carrier-grade NAT 100.64/10. */
function localIpv4(octets: readonly number[]): boolean {
  const [a = -1, b = -1] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

/** IPv6 unique-local (fc00::/7) and link-local (fe80::/10), as `URL` prints them. */
function privateIpv6(host: string): boolean {
  return /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)
}

/** An IPv4 address written as IPv6 (`::ffff:7f00:1`), as its octets. */
function mappedIpv4(host: string): number[] | null {
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host)
  if (!mapped) return null
  const hi = parseInt(mapped[1] ?? '0', 16)
  const lo = parseInt(mapped[2] ?? '0', 16)
  return [hi >> 8, hi & 255, lo >> 8, lo & 255]
}

/**
 * A local IPv4 address inside a longer name: four labels in a row
 * (`10.0.0.1.example.dev`), or four numbers joined by dashes in one label
 * (`ip-192-168-1-1.example.dev`) — how every wildcard-DNS service spells one.
 */
function embedsLocalIpv4(host: string): boolean {
  const labels = host.split('.')
  for (let i = 0; i + 4 <= labels.length; i += 1) {
    const octets = ipv4Octets(labels.slice(i, i + 4).join('.'))
    if (octets !== null && localIpv4(octets)) return true
  }
  for (const label of labels) {
    const parts = label.split('-')
    for (let i = 0; i + 4 <= parts.length; i += 1) {
      const octets = ipv4Octets(parts.slice(i, i + 4).join('.'))
      if (octets !== null && localIpv4(octets)) return true
    }
  }
  return false
}
