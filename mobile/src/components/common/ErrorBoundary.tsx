import { Component } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { ErrorInfo, ReactNode } from 'react'
import { reportError } from '@/lib/report-error'

type Props = { children: ReactNode }
type State = { error: Error | null }

/**
 * Catches render errors so one broken screen does not leave a blank phone.
 *
 * ## Why this exists at all
 *
 * The web app has had a boundary since early on; the phone had none — no
 * `componentDidCatch` anywhere in `mobile/src`. Both apps mount the same
 * `@jojo/service/react` hooks, so the identical throw out of a shared hook
 * showed a browser a recovery screen and showed a phone a white rectangle with
 * no way back. In a release build there is no red box and no console to read,
 * which is precisely where a blank screen is least recoverable.
 *
 * ## Why it does not use any of jojo's own components
 *
 * Plain `View`, `Text` and `Pressable`, with colours written out rather than
 * read from the theme. A boundary sits ABOVE the providers it is protecting, so
 * anything it renders must survive those providers being the thing that broke.
 * `useTheme` inside this component would mean a failure in `ThemeProvider`
 * takes the error screen down with it, and the user sees the blank frame this
 * exists to prevent.
 *
 * The palette is jojo's dark ground, which the app defaults to.
 *
 * ## What it promises
 *
 * Nothing about the records, for the same reason the web boundary's copy sets
 * out: a crash part-way through a multi-collection write can leave the store
 * half-edited, and "your data is safe" would be a guess. Restarting is offered
 * because it is the one action that reliably helps and the one a person will
 * try anyway.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    /*
     * Not awaited, and it cannot throw — see `lib/crash.ts`. This is the ONE
     * import in this file that reaches outside React Native's own primitives,
     * and it is safe to make because `crash.ts` renders nothing: the reason
     * everything else here is hand-rolled is that a provider failure must not
     * take the error screen down, and a storage write cannot.
     *
     * `where` is the boundary rather than the component, because the component
     * stack is a name from the user's own render tree and the report is a thing
     * that may leave the device.
     */
    reportError('render', error, { fatal: true })
  }

  override render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <View style={styles.root}>
        <View style={styles.card}>
          <Text style={styles.title}>Something broke</Text>
          <Text style={styles.body}>
            A screen failed to draw. Your records are on this device and nothing was sent anywhere,
            but jojo cannot tell you whether the change you were making finished.
          </Text>
          <Text style={styles.detail} numberOfLines={3}>
            {error.message || 'No message was attached to the error.'}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={styles.button}
            onPress={() => this.setState({ error: null })}
          >
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
          <Text style={styles.hint}>
            If it breaks again, close jojo from the app switcher and reopen it.
          </Text>
        </View>
      </View>
    )
  }
}

/*
 * Written out rather than themed. See the note above: this has to render when
 * the theme provider is the thing that threw.
 */
const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#1f1f1f',
    borderColor: '#333333',
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    maxWidth: 420,
    padding: 20,
    width: '100%',
  },
  title: { color: '#fafafa', fontSize: 18, fontWeight: '600' },
  body: { color: '#d4d4d4', fontSize: 14, lineHeight: 20 },
  detail: { color: '#a1a1a1', fontFamily: 'JetBrainsMono-Regular', fontSize: 12, lineHeight: 17 },
  button: {
    alignItems: 'center',
    backgroundColor: '#fafafa',
    borderRadius: 8,
    marginTop: 4,
    paddingVertical: 11,
  },
  buttonText: { color: '#0a0a0a', fontSize: 14, fontWeight: '600' },
  hint: { color: '#a1a1a1', fontSize: 12, lineHeight: 17 },
})
