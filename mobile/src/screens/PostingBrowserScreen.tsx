import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import type { WebViewMessageEvent, WebViewNavigation } from 'react-native-webview'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import {
  canonicalPostingUrl,
  captureFileName,
  captureNote,
  hostOf,
  CAPTURE_REJECTION_MESSAGE,
} from '@jojo/service/core/capture'
import { sizeLabel } from '@jojo/service/core/files'
import { Button } from '@/components/ui/Button'
import { Txt } from '@/components/ui/Text'
import { captureScript } from '@/lib/capture-script'
import { inlineCapture, writeCapture, type RawCapture } from '@/lib/capture'
import type { RootStackParamList } from '@/navigation/types'
import { useVault } from '@/lib/store-context'
import { useToast } from '@/lib/toast-context'
import { byteLengthOf } from '@/lib/text'
import { now, TODAY } from '@/lib/today'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

type Props = NativeStackScreenProps<RootStackParamList, 'PostingBrowser'>

/**
 * The in-app browser, and the reason the phone can keep a posting at all.
 *
 * A job posting worth keeping is usually behind a login — Workday, LinkedIn,
 * a university portal — and no background fetch can reach one: a server has no
 * session, and the web app's own `fetch` is refused cross-origin before it
 * starts. What DOES have the session is a browser the user signed into. So the
 * app becomes that browser. The WebView keeps its own cookie jar, the user signs
 * in once inside it, and from then on "Keep a copy" has the same view of the
 * page the user does.
 *
 * That is why capture and viewing are one component's worth of dependency
 * rather than two: the thing that can render a saved posting is the same thing
 * that could read the live one.
 *
 * ## Scripts on here, scripts off later
 *
 * This screen runs the site's JavaScript, because a posting that renders client
 * side is most of them and a capture of the un-run page is a capture of a
 * spinner. `screens/vault/PageViewer.tsx` renders the SAVED copy with
 * `javaScriptEnabled={false}` — the danger is not the live site the user chose
 * to visit, it is the year-old markup opened later from a list.
 */
export function PostingBrowserScreen({ route, navigation }: Props) {
  const { applicationId } = route.params
  /*
   * Normalised before it is opened, not after. A LinkedIn job-alert link
   * (`/comm/jobs/view/…`) and an app share link (`?currentJobId=…`) both
   * redirect to the login wall, while the canonical `/jobs/view/<id>` serves the
   * whole posting to a signed-out browser — so rewriting one character of the
   * path is the difference between "sign in to see this" and a clean capture.
   */
  const url = canonicalPostingUrl(route.params.url)
  const c = useColors()
  const insets = useSafeAreaInsets()
  const { addFile, updateFile } = useVault()
  const { toast } = useToast()

  /*
   * `WebView<object>` rather than `WebView`, and the explicit argument is
   * load-bearing rather than decorative.
   *
   * react-native-webview declares `class WebView<P = undefined> extends
   * Component<WebViewProps & P>`. With the default, that is `WebViewProps &
   * undefined`, which TypeScript 5.9 collapses to `never` — so every prop on the
   * element below fails as "not assignable to type never", including `ref` and
   * `source`. It reads like a React version mismatch and is not; there is one
   * copy of @types/react in this workspace. `object` intersects to
   * `WebViewProps` unchanged and the whole thing type-checks.
   *
   * Fixed here rather than by pinning an older webview: the declaration is wrong
   * in the library, a pin would have to be justified and revisited, and this is
   * one word at the two places that name the type.
   */
  const webRef = useRef<WebView<object>>(null)
  const [current, setCurrent] = useState(url)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const onNavigate = useCallback((event: WebViewNavigation) => {
    setCurrent(event.url)
  }, [])

  /**
   * Everything the injected script sends comes through here.
   *
   * It is one channel carrying one shape, so the type discriminates rather than
   * the caller: a failure inside the WebView posts `jojo:capture-failed` rather
   * than throwing somewhere nothing is watching, and both land in
   * `inlineCapture` which is where the trust boundary actually is.
   */
  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      void (async () => {
        let raw: RawCapture
        try {
          raw = JSON.parse(event.nativeEvent.data) as RawCapture
        } catch {
          setSaving(false)
          return
        }
        if (raw.type !== 'jojo:capture' && raw.type !== 'jojo:capture-failed') {
          // A page can post anything it likes on this channel. Returning without
          // clearing the flag left "Keeping…" spinning forever with no way back
          // — the one state a user cannot recover from without leaving.
          setSaving(false)
          return
        }

        try {
          const outcome = await inlineCapture(raw, now())
          if (!outcome.ok) {
            toast({
              tone: 'danger',
              title: 'That page could not be kept',
              description:
                outcome.reason === 'script-failed'
                  ? (outcome.detail ?? 'The page did not answer.')
                  : CAPTURE_REJECTION_MESSAGE[outcome.reason],
            })
            return
          }

          const { capture } = outcome
          const name = captureFileName(capture.url, capture.title, TODAY)
          // The record first, because the file on disk is named after its id —
          // and a record with no bytes renders honestly, while bytes under an id
          // no record claims are invisible and unreclaimable.
          const file = addFile({
            name,
            kind: 'page',
            // 'Job postings', matching the web side. A capture is a posting
            // rather than a document the user wrote, and the two platforms have
            // to agree or the same Vault filter shows different things depending
            // on which device filed the row.
            bucket: 'Job postings',
            // Byte length, not `.length`. `String.length` counts UTF-16 units,
            // so a posting in Japanese or with emoji reported roughly half its
            // real size — and the web side already counts bytes, so the same
            // capture was labelled differently on the two platforms.
            size: sizeLabel(byteLengthOf(capture.html)),
            sourceUrl: capture.url,
            capturedAt: capture.capturedAt,
            // A list of one. This screen is opened FROM an application, so
            // the id is known rather than guessed — which is exactly why
            // dropping it silently was worse here than on the web.
            ...(applicationId === undefined ? {} : { applicationIds: [applicationId] }),
            note: captureNote(capture),
          })

          // `updateFile` rather than a second create: the record exists, and its
          // id is what the file on disk is named after, so the location is the
          // one field that could not be known until the record did.
          const uri = await writeCapture(file.id, capture.html)
          updateFile(file.id, { uri })

          toast({
            title: `${name} saved`,
            description:
              capture.dropped > 0
                ? `Kept in your vault. ${String(capture.dropped)} ${capture.dropped === 1 ? 'asset' : 'assets'} could not be kept, so parts may look plain.`
                : 'Kept in your vault, and readable with no connection.',
          })
          navigation.goBack()
        } catch (error) {
          toast({
            tone: 'danger',
            title: 'That page could not be kept',
            description: error instanceof Error ? error.message : String(error),
          })
        } finally {
          setSaving(false)
        }
      })()
    },
    [addFile, updateFile, applicationId, navigation, toast],
  )

  const onSave = () => {
    setSaving(true)
    webRef.current?.injectJavaScript(captureScript())
  }

  return (
    <View style={[styles.fill, { backgroundColor: c.page }]}>
      <View style={[styles.bar, { borderBottomColor: c.hairline, backgroundColor: c.panel }]}>
        <View style={styles.address}>
          <Txt size="xs" tone="muted" numberOfLines={1}>
            {hostOf(current)}
          </Txt>
          <Txt size="sm" numberOfLines={1}>
            {current}
          </Txt>
        </View>
        <Button
          label={saving ? 'Keeping…' : 'Keep a copy'}
          icon="download"
          size="sm"
          onPress={onSave}
          disabled={saving || loading}
          blocker={loading ? 'Wait for the page to finish loading' : undefined}
        />
      </View>

      <WebView<object>
        ref={webRef}
        source={{ uri: url }}
        onNavigationStateChange={onNavigate}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        /*
         * Also cleared on progress, because `onLoadEnd` is not reliable here.
         *
         * On Android a `pushState` dispatches the loading-START event through
         * `doUpdateVisitedHistory` and there is no matching finish — `onPageFinished`
         * fires only for real document loads. So on any client-rendered site the
         * flag stuck at `true` and "Keep a copy" stayed disabled behind "Wait for
         * the page to finish loading", permanently. That is not an edge case: it
         * is Workday's careers site entirely, and LinkedIn once signed in — the
         * exact pages this screen exists for.
         */
        onLoadProgress={({ nativeEvent }) => {
          if (nativeEvent.progress >= 1) setLoading(false)
        }}
        onMessage={onMessage}
        // On for the live site: most postings render client side, and a capture
        // taken before the scripts ran is a capture of an empty shell.
        javaScriptEnabled
        domStorageEnabled
        // The cookie jar is the whole point — it is what carries a Workday or
        // LinkedIn session from one visit to the next, so signing in is
        // something the user does once rather than every time.
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        // A posting is a document, not an app: no camera, no location, and no
        // file pickers opening out of a page nobody audited.
        /*
         * Popups navigate in place instead of opening a window nobody sees.
         *
         * With the default (`true`) and no `onOpenWindow`, Android builds a
         * detached WebView with no client, never attaches it, and the user sees
         * nothing happen at all. LinkedIn's login page offers "Sign in with
         * Apple" as a JS-driven button, and Workday tenants routinely SSO
         * through a popup — so the silent-nothing case is the sign-in this
         * screen exists to support.
         */
        setSupportMultipleWindows={false}
        allowFileAccess={false}
        allowsInlineMediaPlayback={false}
        mediaPlaybackRequiresUserAction
        style={styles.fill}
      />

      {loading ? (
        <View style={[styles.loading, { bottom: insets.bottom + space[4] }]} pointerEvents="none">
          <ActivityIndicator color={c.accent} />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  address: { flex: 1, minWidth: 0 },
  loading: { position: 'absolute', alignSelf: 'center' },
})
