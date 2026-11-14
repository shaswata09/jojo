/**
 * Where an address points: this machine, the person's own network, the same
 * board, or a sign-in wall. Pure functions of a URL string, shared by every
 * relay and by both verbs that open a tab.
 */

/**
 * Is this an address on this machine?
 *
 * Parsed rather than pattern-matched on the string, because `http://127.0.0.1@evil.example.com/`
 * passes a naive `startsWith` and is a request to evil.example.com. `URL` puts
 * the real host in `hostname`, where a check means what it looks like.
 *
 * `http` only: there is no https story for a loopback server without a
 * certificate, and allowing it here would suggest there is.
 */
export function isLoopback(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'http:') return false
  const host = url.hostname
  // The bracketed form is what `URL` gives back for IPv6.
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1'
}

/**
 * Whether two loopback addresses are the same SERVER: same port, any of the
 * three loopback spellings. Not `origin` equality — `localhost` and `127.0.0.1`
 * are one listener, and somebody who typed one in Settings and the other in the
 * popup should not be refused for it.
 */
export function sameLoopbackServer(a, b) {
  if (!isLoopback(a) || !isLoopback(b)) return false
  const port = (raw) => {
    const url = new URL(raw)
    return url.port === '' ? '80' : url.port
  }
  return port(a) === port(b)
}

/**
 * A machine on the person's OWN network, reached over plain http.
 *
 * ## Why this exists
 *
 * The relay allowed loopback and five hosted providers. That is right for a
 * model running on the same machine and right for a paid API, and it leaves out
 * the case this app is most often actually used in: a model server on another
 * box on the same network — a workstation with the GPU, a homelab, a lab
 * subnet — reached from a copy of jojo served over https, where the browser
 * forbids the page from making that call itself.
 *
 * Reported from exactly that setup: GitHub Pages over https, vLLM at
 * `http://10.116.34.124:8103/v1`. The page cannot reach it (mixed content) and
 * the relay refused it (not loopback, not a known provider), so the address was
 * unusable by any route while the error text suggested installing the extension
 * that was already refusing it.
 *
 * ## Why this is not an open proxy
 *
 * Only ranges that are unroutable on the public internet, and only over http:
 *
 *   - RFC 1918 private space: 10/8, 172.16/12, 192.168/16
 *   - RFC 3927 link-local: 169.254/16
 *   - RFC 4193 IPv6 unique-local (fc00::/7) and IPv6 link-local (fe80::/10)
 *   - `.local`, which is mDNS
 *
 * A public address over http is still refused — relaying one would make this
 * extension a way for any page to launder a request through the user's browser
 * to somewhere on the internet, which is the thing the list was protecting
 * against. A private address can only reach hardware the person already has
 * access to from where they are sitting.
 *
 * The user-facing consequence is worth stating plainly: with the extension
 * installed and "Models on my network" switched on, a page can ask it to fetch
 * from the user's own LAN. That switch is OFF until the person turns it on in
 * the popup — an earlier version of this comment said the per-provider switches
 * already turned it off, and they could not: they are keyed by the hosted
 * providers' names, so `10.0.0.5` had no switch at all. `modelRefusal` reads
 * `routing().network`.
 */
export function isPrivateNetwork(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'http:') return false
  return privateHost(url.hostname)
}

/**
 * Whether a hostname is on a private network: RFC 1918, link-local, IPv6
 * unique-local and link-local, and mDNS. Loopback is NOT included — it is
 * `isLoopback`'s question — and the hostname is as `URL` normalised it, so
 * `http://0xa.1/` has already become `10.0.0.1` by the time it arrives.
 */
function privateHost(hostname) {
  // A trailing dot is the same name (`nas.local.` is `nas.local`), and `URL`
  // keeps it, so every suffix test below missed it.
  const host = bareHost(hostname)

  if (host.endsWith('.local')) return true

  if (host.includes(':')) {
    // An IPv4 address written as IPv6 (`::ffff:a00:1`) is that IPv4 address.
    const mapped = mappedIpv4(host)
    if (mapped !== null) return privateHost(mapped)
    return privateIpv6(host)
  }

  const octets = ipv4Octets(host)
  return octets !== null && privateIpv4(octets)
}

/** `URL`'s hostname without IPv6 brackets or trailing dots, lower-cased. */
function bareHost(hostname) {
  return String(hostname).replace(/^\[|\]$/g, '').toLowerCase().replace(/\.+$/, '')
}

/** The four octets of a dotted-decimal IPv4 address, or null for anything else. */
function ipv4Octets(host) {
  const parts = host.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : -1))
  return octets.some((n) => n < 0 || n > 255) ? null : octets
}

/**
 * RFC 1918 (10/8, 172.16/12, 192.168/16), link-local 169.254/16, and RFC 6598
 * carrier-grade NAT 100.64/10 — also where Tailscale puts every machine on a
 * tailnet, which is the person's own network by another name.
 */
function privateIpv4([a, b]) {
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

/** IPv6 unique-local (fc00::/7) and link-local (fe80::/10), as `URL` prints them. */
function privateIpv6(host) {
  return /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)
}

/** `::ffff:7f00:1` as `127.0.0.1`, or null when the address is not IPv4-mapped. */
function mappedIpv4(host) {
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host)
  if (!mapped) return null
  const hi = parseInt(mapped[1], 16)
  const lo = parseInt(mapped[2], 16)
  return `${String(hi >> 8)}.${String(hi & 255)}.${String(lo >> 8)}.${String(lo & 255)}`
}

/** This machine (127/8, and 0/8, which every OS treats as "this host") or a private range. */
function localIpv4(octets) {
  return octets[0] === 127 || octets[0] === 0 || privateIpv4(octets)
}

/** Suffixes that only ever name a machine on the person's own network. */
const LOCAL_SUFFIXES = ['local', 'internal', 'lan', 'home.arpa']

/**
 * Public DNS names that answer with a loopback or private address.
 *
 * Some answer 127.0.0.1 for every name under them (`localtest.me`, `lvh.me`),
 * and some answer whatever address is written into the name
 * (`10.0.0.1.nip.io`, `app-192-168-1-1.sslip.io`, and the hex spelling
 * `0a000001.nip.io`). They exist so a developer can reach their own machine by
 * name, which is exactly what a posting must not be able to do. The services
 * that echo an address are refused whole: no posting lives under one, and the
 * hex spelling cannot be read back any other way.
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

const under = (host, domain) => host === domain || host.endsWith(`.${domain}`)

/**
 * Whether a name carries a local IPv4 address inside it — four labels in a row
 * (`10.0.0.1.example.dev`) or four numbers joined by dashes in one label
 * (`ip-192-168-1-1.example.dev`). That is how every wildcard-DNS service spells
 * an address, including ones not on the list above, and a public site has no
 * reason to name itself after a private address.
 */
function embedsLocalIpv4(host) {
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

/**
 * Whether an address is this machine or the person's own network.
 *
 * The scan and "From link" open a tab with the person's cookies and hand the
 * whole rendered DOM back to the page that asked. Pointed at a router's admin
 * page, a NAS, or a dev server on this machine, that is a page reading the
 * person's intranet through their own browser — so those two verbs refuse it,
 * before the tab opens and again after any redirect. A posting is on the public
 * web; nobody's job advert lives at 192.168.1.1. Anything that is not http(s)
 * is refused too: no posting is a `file:` or `chrome:` page.
 *
 * THE APP HAS A COPY, `isLocalTarget` in `web/src/lib/posting-target.ts`, for
 * the document reader's route. The two are kept line for line the same and one
 * table in `posting-target.test.ts` runs both. They disagreed once: this copy
 * caught `127.0.0.1.nip.io` by a prefix test and the app's passed it.
 *
 * Hostname-only. A worker cannot see DNS answers, so a public name that
 * RESOLVES to a private address is judged by its name alone. Every literal
 * spelling is closed (`URL` already folds `0x7f.1`, `2130706433`, `0177.0.0.1`
 * and `127.0.0.1.` into dotted decimal), and so are the names that exist to
 * resolve to this machine: the loopback domains above, and any name carrying a
 * local IPv4 address. What is left is a name somebody registered and pointed
 * at a private address, or one that changes its answer between check and fetch
 * (DNS rebinding). Judging those needs the address the browser actually
 * connected to. `chrome.webRequest` reports one (`details.ip`), but only after
 * the request has been sent, not at all for a response served from cache, and
 * as the proxy's address behind a proxy — so it could refuse a body, never stop
 * the request, and would need a new permission and a way to pair each event
 * with the fetch or tab that caused it. Not built.
 */
export function isLocalTarget(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    return true
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true
  // Trailing dots stripped: `URL` keeps `localhost.`, which is localhost to
  // every resolver and slipped past the equality test below.
  const host = bareHost(url.hostname)
  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true
    const mapped = mappedIpv4(host)
    if (mapped !== null) return localIpv4(ipv4Octets(mapped))
    return privateIpv6(host)
  }
  // A single-label name — `http://router/`, `http://intranet/` — is resolved
  // through the local search domain, so it is a machine on the person's own
  // network by construction. No public posting lives at one.
  if (!host.includes('.')) return true
  if (LOCAL_SUFFIXES.some((suffix) => under(host, suffix))) return true
  if (LOOPBACK_DOMAINS.some((domain) => under(host, domain))) return true
  const octets = ipv4Octets(host)
  if (octets !== null) return localIpv4(octets)
  return embedsLocalIpv4(host)
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * The same board, give or take `www.` and its own subdomains — in either
 * direction, since a board may redirect up (`www.` dropped) as well as down.
 * The package's `sameSite` (`core/board.ts`) is the one rule; this is the
 * worker's copy of it, kept to the same three cases.
 */
export function sameSite(a, b) {
  if (!a || !b) return false
  const bare = (h) => h.replace(/^www\./, '')
  return bare(a) === bare(b) || a.endsWith(`.${bare(b)}`) || b.endsWith(`.${bare(a)}`)
}

/**
 * Whether a redirect landed on an account page rather than a posting.
 *
 * Only a page it was SENT to counts — the address asked for is never judged, so
 * a posting whose own path happens to say "auth" is not refused — and only one
 * that looks like a sign-in. `scanBoard` refuses any change of host, which is
 * right for a board and wrong here: a careers page handing over to the tracking
 * system that hosts its listings (careers.acme.com → boards.greenhouse.io) is
 * the ordinary shape of a posting link. The host alone is not enough either,
 * because the commonest wall is on the same one: LinkedIn sends a signed-out
 * reader of /jobs/view to /authwall.
 */
const SIGN_IN = /(^|[./-])(log-?in|sign-?in|sso|auth|authwall|accounts?|checkpoint)([./-]|$)/i

export function looksLikeSignIn(requested, landed) {
  if (landed === requested) return false
  try {
    const at = new URL(landed)
    return SIGN_IN.test(`${at.hostname}${at.pathname}`)
  } catch {
    return false
  }
}
