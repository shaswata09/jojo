import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ToolHost } from '@jojo/service/agent/execute'
import { mcpAllowed } from '@jojo/service/agent/mcp'
import { useToolHost } from '@jojo/service/react/use-tool-host'
import { relayToBridge } from '@/lib/capture-bridge'
import { BRIDGE_ADDRESS, directTransport, mintToken, runLink } from '@/lib/mcp-link'
import type { LinkStatus, LinkTransport } from '@/lib/mcp-link'
import { useReadDocument } from '@/lib/read-document'
import { readStored, writeStored } from '@/lib/storage'

/**
 * The MCP link, switched on or off, and kept running while jojo is open.
 *
 * ## Why above the router
 *
 * Mounted beside `PipelinesProvider`, for the same reason it is up there: a link
 * that lived in the Settings page would stop answering Claude Code the moment
 * the person went to another page to look at what it had just done.
 *
 * ## What is stored, and where
 *
 * The switch and the token, in this browser's storage — beside the model
 * settings rather than in the graph, because both describe this machine rather
 * than the person's records. A token that travelled with a Transfer to a phone
 * would be a credential for a bridge on a computer the phone has never seen.
 *
 * ## Which road the requests take
 *
 * A page served from this machine — the development server — can call the
 * bridge itself. A page served from the web cannot: it is https, and Chrome's
 * Local Network Access gate keeps it away from 127.0.0.1. That page asks the
 * jojo extension to carry each request instead, which is what the extension
 * already does for the document reader and for model providers without CORS.
 */

const STORAGE_KEY = 'jojo/mcp-link/v1'

type Stored = { enabled: boolean; token: string }

function load(): Stored {
  try {
    const parsed = JSON.parse(readStored(STORAGE_KEY) ?? '{}') as Partial<Stored>
    return {
      enabled: parsed.enabled === true,
      token: typeof parsed.token === 'string' ? parsed.token : '',
    }
  } catch {
    return { enabled: false, token: '' }
  }
}

export type McpLinkStatus = LinkStatus | { state: 'off' }

export type McpLink = {
  enabled: boolean
  /** Empty until the link is first switched on; minted then, kept after. */
  token: string
  status: McpLinkStatus
  /** Client messages answered since the page loaded. */
  served: number
  lastMethod: string | null
  /** True on a hosted copy, where the extension carries the link. */
  viaExtension: boolean
  setEnabled: (on: boolean) => void
  /** A new token. The old commands stop working, which is the point of pressing it. */
  regenerate: () => void
}

const McpLinkContext = createContext<McpLink | null>(null)

export function useMcpLink(): McpLink {
  const ctx = useContext(McpLinkContext)
  if (!ctx) throw new Error('useMcpLink must be used inside <McpLinkProvider>')
  return ctx
}

/** Pages served from this machine; only they may call the bridge without the extension. */
const servedLocally = () =>
  ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)

const throughExtension: LinkTransport = (request, signal) => relayToBridge(request, signal)

export function McpLinkProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState(load)
  const [status, setStatus] = useState<LinkStatus>({ state: 'searching' })
  const [served, setServed] = useState(0)
  const [lastMethod, setLastMethod] = useState<string | null>(null)

  /*
   * The same host the assistant runs against — `useToolHost` — with the same
   * document reader, so a client asking to read a CV gets exactly what the
   * assistant would.
   */
  const readDocument = useReadDocument()
  const host = useToolHost(readDocument)
  const hostRef = useRef(host)
  useEffect(() => {
    hostRef.current = host
  }, [host])

  /*
   * Stable for the life of the provider, so the loop is not torn down and
   * re-attached every time the reader address changes. Every call reads the
   * current host through the ref, which is the property `useToolHost` exists
   * to keep: a getter, never a captured value.
   */
  const live = useMemo<ToolHost>(
    () => ({
      memory: () => hostRef.current.memory(),
      today: () => hostRef.current.today(),
      check: (name, input) => hostRef.current.check(name, input),
      run: (name, input) => hostRef.current.run(name, input),
      convert: (fileId) =>
        hostRef.current.convert?.(fileId) ??
        Promise.resolve({ ok: false as const, reason: 'No document reader is connected.' }),
    }),
    [],
  )

  const on = stored.enabled && stored.token !== ''
  const local = servedLocally()

  useEffect(() => {
    if (!on) return
    const controller = new AbortController()
    void runLink({
      address: BRIDGE_ADDRESS,
      token: stored.token,
      transport: local ? directTransport() : throughExtension,
      host: live,
      // Everything except the two tools that cannot be undone. See `mcpAllowed`.
      allow: mcpAllowed,
      signal: controller.signal,
      onStatus: setStatus,
      onServed: (method) => {
        setServed((n) => n + 1)
        setLastMethod(method)
      },
    })
    return () => {
      controller.abort()
    }
  }, [on, stored.token, local, live])

  const save = useCallback((next: Stored) => {
    setStored(next)
    writeStored(STORAGE_KEY, JSON.stringify(next))
  }, [])

  const setEnabled = useCallback(
    (enabled: boolean) => {
      // Minted on first use rather than on every load, so a person who never
      // turns this on never has a credential sitting in their storage.
      save({ enabled, token: stored.token === '' ? mintToken() : stored.token })
    },
    [save, stored.token],
  )

  const regenerate = useCallback(() => {
    save({ enabled: stored.enabled, token: mintToken() })
    setServed(0)
    setLastMethod(null)
  }, [save, stored.enabled])

  const value = useMemo<McpLink>(
    () => ({
      enabled: stored.enabled,
      token: stored.token,
      status: on ? status : { state: 'off' },
      served,
      lastMethod,
      viaExtension: !local,
      setEnabled,
      regenerate,
    }),
    [stored, on, status, served, lastMethod, local, setEnabled, regenerate],
  )

  return <McpLinkContext.Provider value={value}>{children}</McpLinkContext.Provider>
}
