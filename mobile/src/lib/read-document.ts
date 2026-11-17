import { useCallback } from 'react'
import { i18next } from '@/i18n/i18n'
import { useVault } from '@jojo/service/react/use-vault'
import type { ConvertResult } from '@jojo/service/agent/markitdown'
import { convertDocument } from '@/lib/markitdown'
import { useModelSettings } from '@/lib/model-settings-context'

/**
 * Opening a document the Vault holds, by its record id.
 *
 * The phone's half of `web/src/lib/read-document.ts`, and the one real
 * difference is where the bytes are. The browser keeps them in a blob store
 * keyed by record id; here the record carries `uri` — an absolute path into the
 * app's own document directory, written by the picker — so this is a lookup in
 * the projection rather than an await on a store.
 *
 * Same two failures, said the same way, because they are still not the same
 * failure: no copy on this device, and no reader configured to open it with.
 */
export function useReadDocument(): (fileId: string) => Promise<ConvertResult> {
  const { reader } = useModelSettings()
  const { files } = useVault()

  return useCallback(
    async (fileId: string) => {
      if (reader.trim() === '') {
        return {
          ok: false as const,
          reason: i18next.t('messages:reader.notConnected'),
        }
      }
      const record = files.find((f) => f.id === fileId)
      if (!record?.uri) {
        return {
          ok: false as const,
          reason: i18next.t('messages:reader.noCopy'),
        }
      }
      return convertDocument(reader, record.uri, record.name)
    },
    [files, reader],
  )
}
