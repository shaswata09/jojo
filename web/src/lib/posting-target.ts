/**
 * Whether an address is this machine or the person's own network.
 *
 * The posting readers open a page as the person — the extension in their
 * signed-in browser, the document reader on their own machine — and hand back
 * whatever came. A posting is on the public web; nobody's job advert lives at
 * 192.168.1.1. The extension refuses these for its own route
 * (`isLocalTarget` in `web/extension/background.js`); this is the same refusal
 * for the reader's route, which had none (R6), and for the scout's background
 * reads before either route is tried.
 *
 * Hostname-only, like the extension's: a public name that RESOLVES to a private
 * address passes, and a page cannot see DNS answers. Every literal spelling is
 * closed — including a trailing-dot `localhost.`, carrier-grade NAT
 * (100.64/10), and a single-label host, which on a home network is a machine
 * on it.
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
  if (host.includes(':')) return localIpv6(host)
  if (!host.includes('.')) return true
  if (
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.lan') ||
    host.endsWith('.home.arpa')
  ) {
    return true
  }
  return localIpv4(host)
}

function localIpv4(host: string): boolean {
  const parts = host.split('.')
  if (parts.length !== 4) return false
  const o = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : -1))
  if (o.some((n) => n < 0 || n > 255)) return false
  const [a = -1, b = -1] = o
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

function localIpv6(host: string): boolean {
  if (host === '::1' || host === '::') return true
  // An IPv4 address written as IPv6 (`::ffff:7f00:1`) is that IPv4 address.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host)
  if (mapped) {
    const hi = parseInt(mapped[1] ?? '0', 16)
    const lo = parseInt(mapped[2] ?? '0', 16)
    return localIpv4(`${String(hi >> 8)}.${String(hi & 255)}.${String(lo >> 8)}.${String(lo & 255)}`)
  }
  // Unique-local and link-local.
  return /^f[cd][0-9a-f]{0,2}:/.test(host) || /^fe[89ab][0-9a-f]?:/.test(host)
}
