import { useEffect, useState } from 'react'
import { ActivityIndicator, Modal, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import { hostOf, isCaptureSource } from '@jojo/service/core/capture'
import type { VaultFile } from '@jojo/service/data/vault'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Txt } from '@/components/ui/Text'
import { readStoredCapture } from '@/lib/capture'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/**
 * A saved posting, read back.
 *
 * The web app puts a capture in a fully sandboxed `<iframe srcdoc>`. This is the
 * same idea with the phone's spelling: the markup goes in as `source={{ html }}`
 * and every capability the WebView has is turned off.
 *
 * ## What is off, and why each one
 *
 * `javaScriptEnabled={false}` — this is markup a job board wrote, kept for a
 * year, opened from a list. The live site got scripts because the user chose to
 * visit it and needed to sign in; a stored copy has no such claim, and a capture
 * that needs scripting to read is a capture that failed.
 *
 * `originWhitelist={['about:']}` plus `onShouldStartLoadWithRequest` — together
 * these are the phone's answer to the problem `CAPTURE_HREF_ATTR` exists for.
 * The serialiser strips anchor destinations, so a well-formed capture cannot
 * navigate; this is the second lock, for the capture that was not well formed.
 * A WebView with no whitelist will happily follow a link out to the live site,
 * inside the app, from an archive — which is the one request this whole feature
 * exists to prevent.
 *
 * `cacheEnabled={false}` so nothing about reading an old posting is written back
 * to the WebView's cache.
 *
 * ## Why `incognito` is NOT set, though it looks like it belongs
 *
 * On Android react-native-webview implements it as
 * `CookieManager.getInstance().removeAllCookies(null)` plus `clearCache(true)`
 * and `clearFormData()` — and `CookieManager` is a PROCESS-WIDE singleton, not a
 * per-WebView store. So opening one saved posting from the vault would wipe the
 * whole app's cookie jar, including the LinkedIn or Workday session that
 * `PostingBrowserScreen` had just established. "Sign in once" would have become
 * "sign in again every time you read something you saved", on Android only,
 * caused entirely by this screen.
 *
 * Nothing is lost by omitting it. A document with no scripts, no permitted
 * navigations and no cache writes nothing to the jar in the first place; the
 * protections above are what make this frame safe, and `incognito` was only ever
 * belt to their braces. iOS is unaffected either way — there it maps to a
 * separate non-persistent data store rather than to a global wipe.
 */
export function PageViewer({ file, onClose }: { file: VaultFile; onClose: () => void }) {
  const c = useColors()
  const insets = useSafeAreaInsets()
  /** `undefined` while loading, `null` when there are no bytes on this device. */
  const [html, setHtml] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    setHtml(undefined)
    void readStoredCapture(file.uri).then((text) => {
      if (alive) setHtml(text)
    })
    return () => {
      alive = false
    }
  }, [file.uri])

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={[styles.fill, { backgroundColor: c.page, paddingTop: insets.top }]}>
        <View style={[styles.bar, { borderBottomColor: c.hairline, backgroundColor: c.panel }]}>
          <View style={styles.title}>
            <Txt size="sm" numberOfLines={1}>
              {file.name}
            </Txt>
            {/* The address as TEXT and never as a link — see FileProps.sourceUrl.
                It is what makes a year-old copy checkable; a tap that left for
                the live site would be the request this is all built to avoid. */}
            {file.sourceUrl !== undefined && isCaptureSource(file.sourceUrl) ? (
              <Txt size="xs" tone="muted" numberOfLines={1}>
                Captured from {hostOf(file.sourceUrl)}
              </Txt>
            ) : null}
          </View>
          <Button label="Done" size="sm" onPress={onClose} />
        </View>

        {html === undefined ? (
          <View style={styles.centre}>
            <ActivityIndicator color={c.accent} />
          </View>
        ) : html === null ? (
          <View style={styles.centre}>
            <EmptyState
              icon="globe"
              title="No saved copy on this device"
              description="Captures are kept where they were taken, so one made in the web app is not here. The record kept its name and its address."
            />
          </View>
        ) : (
          <WebView<object>
            source={{ html }}
            // Everything off. See the header — each of these is a separate way
            // a stored page could reach the network.
            javaScriptEnabled={false}
            domStorageEnabled={false}
            cacheEnabled={false}
            allowFileAccess={false}
            originWhitelist={['about:']}
            onShouldStartLoadWithRequest={(request) =>
              // The first load is the document itself; anything after it is a
              // navigation the archive tried to make, and there are none it may.
              request.url === 'about:blank' || request.url.startsWith('data:')
            }
            style={[styles.fill, { backgroundColor: '#ffffff' }]}
          />
        )}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space[5] },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1, minWidth: 0 },
})
