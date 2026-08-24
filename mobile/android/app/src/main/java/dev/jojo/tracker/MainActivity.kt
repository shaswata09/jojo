package dev.jojo.tracker

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // The activity is declared with `Theme.App.SplashScreen` in the manifest so
    // the very first window is painted #0a0a0a instead of white. Swapping to
    // AppTheme here is what ends that; it has to happen before super.onCreate.
    setTheme(R.style.AppTheme);

    // `null`, not `savedInstanceState`, and it is NOT about the splash screen —
    // the comment that used to sit here credited expo-splash-screen and was
    // wrong. react-native-screens documents this as the fix for its fragment
    // state-restoration crash, and react-native-screens is a direct dependency.
    // Passing the bundle back reintroduces a crash that fires only on
    // process-death restore, which `adb shell am force-stop` cannot reproduce
    // because it clears the saved instance state the crash needs.
    // Before super, so `Linking.getInitialURL()` sees the rewritten intent on a
    // cold start — it reads the activity's intent as it stands when JS asks.
    intent = sharedToDeepLink(intent)

    super.onCreate(null)
  }

  /**
   * The same rewrite for a share that arrives while jojo is already running.
   *
   * `setIntent` matters as much as the rewrite: `ReactActivity` hands the intent
   * on to the Linking module, and a `getInitialURL` later in the session reads
   * whatever the activity currently holds.
   */
  override fun onNewIntent(intent: Intent) {
    val rewritten = sharedToDeepLink(intent)
    setIntent(rewritten)
    super.onNewIntent(rewritten)
  }

  /**
   * Turns an Android share into a `jojo://` link, so nothing native has to know
   * what the app does with it.
   *
   * WHY THIS EXISTS AT ALL. On a phone the way anyone captures a job they just
   * found is Share, and jojo did not appear in that sheet — the receiving end
   * already existed, in the paste-a-URL row on the Applications screen, but the
   * only way to reach it was copy, leave the browser, open jojo, navigate,
   * paste. Meanwhile the desktop had a browser extension doing it in one click.
   *
   * WHY IT IS A REWRITE RATHER THAN A NATIVE MODULE. `ACTION_SEND` puts its
   * payload in `EXTRA_TEXT`, which React Native's Linking does not expose — the
   * usual answer is a bridge module or a third-party package. Converting the
   * intent into the `ACTION_VIEW` the app already understands needs neither: the
   * share becomes an ordinary deep link before React starts, and every decision
   * about what to do with it stays in `navigation/linking.ts`.
   *
   * `EXTRA_TEXT` is a CharSequence and is frequently a title and a URL together,
   * which is why it is passed on whole rather than parsed here. `draftFromUrl`
   * on the other side reads either.
   */
  private fun sharedToDeepLink(source: Intent?): Intent? {
    if (source == null || source.action != Intent.ACTION_SEND) return source

    val text = source.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.trim()
    if (text.isNullOrEmpty()) return source

    return Intent(Intent.ACTION_VIEW).apply {
      data = Uri.parse("jojo://applications").buildUpon().appendQueryParameter("shared", text).build()
      // Carried over so the rewritten intent lands in the same task the share
      // started, rather than opening a second copy of the app behind the first.
      flags = source.flags
    }
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}
