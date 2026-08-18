package dev.jojo.tracker

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
    super.onCreate(null)
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
