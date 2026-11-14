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
  const host = String(hostname).replace(/^\[|\]$/g, '').toLowerCase().replace(/\.+$/, '')

  if (host.endsWith('.local')) return true

  if (host.includes(':')) {
    // An IPv4 address written as IPv6 (`::ffff:a00:1`) is that IPv4 address.
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host)
    if (mapped) {
      const hi = parseInt(mapped[1], 16)
      const lo = parseInt(mapped[2], 16)
      return privateHost(`${String(hi >> 8)}.${String(hi & 255)}.${String(lo >> 8)}.${String(lo & 255)}`)
    }
    // IPv6 unique-local and link-local.
    return /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)
  }

  const parts = host.split('.')
  if (parts.length !== 4) return false
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : -1))
  if (octets.some((n) => n < 0 || n > 255)) return false
  const [a, b] = octets
  if (a === 10) return true
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  // RFC 6598 carrier-grade NAT, 100.64/10 — also where Tailscale puts every
  // machine on a tailnet, which is the person's own network by another name.
  if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true
  return false
}

/**
 * Whether an address is this machine or the person's own network, by ANY scheme.
 *
 * The scan and "From link" open a tab with the person's cookies and hand the
 * whole rendered DOM back to the page that asked. Pointed at a router's admin
 * page, a NAS, or a dev server on this machine, that is a page reading the
 * person's intranet through their own browser — so those two verbs refuse it,
 * before the tab opens and again after any redirect. A posting is on the public
 * web; nobody's job advert lives at 192.168.1.1.
 *
 * Hostname-only. A public name that RESOLVES to a private address passes —
 * DNS rebinding, a name that answers public for the check and private for the
 * fetch, included. A worker cannot see DNS answers, so that is out of reach
 * here; `privateHost` closes every LITERAL spelling. `URL` already folds the
 * numeric ones (`0x7f.1`, `2130706433`, `0177.0.0.1`, `127.0.0.1.`) into dotted
 * decimal, so they need no case of their own.
 */
export function isLocalTarget(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    return true
  }
  // Trailing dots stripped: `URL` keeps `localhost.`, which is localhost to
  // every resolver and slipped past the equality test below.
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.+$/, '')
  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) return true
  // A single-label name — `http://router/`, `http://intranet/` — is resolved
  // through the local search domain, so it is a machine on the person's own
  // network by construction. No public posting lives at one. (IPv6 has colons
  // and no dots, and is judged below.)
  if (!host.includes('.') && !host.includes(':')) return true
  if (host === '::1' || host === '::' || host === '0.0.0.0' || /^127\./.test(host) || /^0\./.test(host)) return true
  if (/^::ffff:7f[0-9a-f]{2}:/.test(host)) return true
  if (host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home.arpa')) return true
  return privateHost(host)
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
