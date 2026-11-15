import { createContext, useContext } from 'react'
import type { LinkStatus } from '@/lib/mcp-link'

/**
 * The MCP link as the Settings panel reads it. The provider that keeps it
 * running is `mcp-link-provider.tsx`; this is apart from it so that file exports
 * its component only, which is what lets a fast refresh keep its state.
 */

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

export const McpLinkContext = createContext<McpLink | null>(null)

export function useMcpLink(): McpLink {
  const ctx = useContext(McpLinkContext)
  if (!ctx) throw new Error('useMcpLink must be used inside <McpLinkProvider>')
  return ctx
}
