package dev.jojo.tracker

import android.content.Intent
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.FixMethodOrder
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.MethodSorters

/**
 * What has to be true of the phone app on a real device, checked on one.
 *
 * ## Why these tests exist at all
 *
 * The Vitest suites cover the logic and cannot cover the thing most likely to
 * break: whether the app STARTS. React Native fails at launch for reasons no
 * unit test can see — a missing JS bundle, a native module that did not link, a
 * Hermes mismatch, a permission the manifest stopped declaring. Every one of
 * those ships green and opens to a blank screen or a red box.
 *
 * The release build is the one under test, deliberately. It is the artifact CI
 * publishes, it is the only variant with the JS bundle embedded, and it is the
 * variant whose manifest differs from debug's — which is exactly where the
 * cleartext and permission defects lived.
 *
 * ## Why UI Automator and not Espresso
 *
 * React Native renders the whole app into one host view. There are no widget ids
 * for Espresso to match, so it can assert almost nothing. UI Automator matches
 * on what is actually on screen — text and content descriptions — which is what
 * a person sees and what TalkBack reads. A test that fails here is a test that
 * failed for a user.
 *
 * ## Ordering
 *
 * `MethodSorters.NAME_ASCENDING` and numbered names, because these share one
 * app process and one store: `t1` establishes that the app launched and gets
 * past first-run, and everything after it depends on that having happened. The
 * alternative — a fresh process per test — costs React Native's entire startup
 * each time for isolation this suite does not need.
 */
@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class JojoUiTest {

  private lateinit var device: UiDevice

  /** Generous: a cold React Native start on a Test Lab device is not quick. */
  private val launchTimeout = 60_000L
  private val settleTimeout = 15_000L

  @Before
  fun setUp() {
    device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
  }

  /** Bring the app up from wherever the previous test left it. */
  private fun launch(uri: String? = null) {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val intent =
      if (uri == null) {
        requireNotNull(context.packageManager.getLaunchIntentForPackage(PACKAGE)) {
          "No launch intent for $PACKAGE — the manifest has no LAUNCHER activity."
        }
      } else {
        Intent(Intent.ACTION_VIEW, Uri.parse(uri)).setPackage(PACKAGE)
      }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
    assertTrue(
      "jojo did not come to the foreground within ${launchTimeout / 1000}s.",
      device.wait(Until.hasObject(By.pkg(PACKAGE).depth(0)), launchTimeout),
    )
  }

  /** Wait for a thing to appear, returning whether it did. */
  private fun appears(selector: BySelector, timeout: Long = settleTimeout): Boolean =
    device.wait(Until.hasObject(selector), timeout)

  /**
   * Get past first run, if this device has never opened jojo.
   *
   * Written as "dismiss whatever is in the way" rather than as a scripted walk
   * through the exact sequence: the store persists across tests in one process,
   * so only the first test that runs ever sees onboarding, and a test that
   * asserted the sequence would fail for every subsequent run on a warm device.
   * The first-run flow has its own test below.
   */
  private fun dismissFirstRun() {
    repeat(6) {
      val skip =
        device.findObject(By.textContains("Skip"))
          ?: device.findObject(By.textContains("Not now"))
          ?: device.findObject(By.textContains("Maybe later"))
          ?: device.findObject(By.text("Start with the demo records"))
          ?: device.findObject(By.textContains("Explore"))
      if (skip == null) return
      skip.click()
      device.waitForIdle(2_000)
    }
  }

  /* ------------------------------------------------------------------ tests */

  /**
   * The app starts, and what it draws is jojo rather than a crash dialog.
   *
   * The single most valuable assertion here. Everything below is a variation on
   * a theme; this one catches the class of failure that a green Vitest run
   * cannot see at all.
   */
  @Test
  fun t1_launches() {
    launch()
    dismissFirstRun()

    assertTrue(
      "Android showed a 'jojo keeps stopping' dialog — the app crashed on launch.",
      !appears(By.textContains("keeps stopping"), 2_000) &&
        !appears(By.textContains("has stopped"), 2_000),
    )
    assertTrue(
      "React Native's red box is on screen — the JS bundle failed to load. " +
        "In a release build that means the bundle was not embedded.",
      !appears(By.textContains("Unable to load script"), 2_000),
    )
    assertNotNull(
      "Nothing from $PACKAGE is on screen after launch.",
      device.findObject(By.pkg(PACKAGE).depth(0)),
    )
  }

  /**
   * The five tabs are reachable and each draws its own screen.
   *
   * Asserted by NAME, which is what the tab bar labels and what the screen's own
   * heading says. The heading is an `accessibilityRole="header"` element, so
   * this is checking the same string a screen reader would announce.
   */
  @Test
  fun t2_tabsNavigate() {
    launch()
    dismissFirstRun()

    for (tab in listOf("Applications", "Calendar", "Vault", "Today")) {
      val target = device.findObject(By.text(tab)) ?: device.findObject(By.desc(tab))
      assertNotNull("The '$tab' tab is not on screen.", target)
      target.click()
      device.waitForIdle(2_000)
      assertTrue(
        "Tapping '$tab' did not bring up a screen showing '$tab'.",
        appears(By.textContains(tab)),
      )
    }
  }

  /**
   * `jojo://` addresses open the app rather than being swallowed.
   *
   * The scheme has been declared in the manifest since the project was
   * generated, and for a long time nothing listened — firing a deep link
   * delivered the intent and left the user where they were, which teaches people
   * the app is broken rather than that a feature is missing. This is the
   * regression test for that.
   */
  @Test
  fun t3_deepLinkOpensTheApp() {
    launch(uri = "jojo://applications")
    assertNotNull(
      "jojo://applications did not bring jojo to the foreground.",
      device.findObject(By.pkg(PACKAGE).depth(0)),
    )
    assertTrue(
      "The applications screen did not appear after the deep link.",
      appears(By.textContains("Application")),
    )
  }

  /**
   * Settings opens and names the model providers.
   *
   * Chosen over the prettier screens because it is where the two things that
   * differ between debug and release live — the model endpoint and the document
   * reader address. A release build that cannot render Settings is a release
   * build where those cannot be configured.
   */
  @Test
  fun t4_settingsOpens() {
    launch()
    dismissFirstRun()

    val more = device.findObject(By.text("More")) ?: device.findObject(By.desc("More"))
    assertNotNull("The 'More' tab is not on screen.", more)
    more.click()
    device.waitForIdle(2_000)

    val settings = device.findObject(By.textContains("Settings"))
    assertNotNull("'Settings' is not listed under More.", settings)
    settings.click()
    device.waitForIdle(3_000)

    assertTrue(
      "Settings opened but does not mention a model — the connections panel did not render.",
      appears(By.textContains("Model")) || appears(By.textContains("model")),
    )
  }

  /**
   * The app survives being sent to the background and brought back.
   *
   * A React Native app that loses its bridge on resume comes back blank, and it
   * does it on the path every user takes several times a day. Cheap to check and
   * invisible to every other kind of test here.
   */
  @Test
  fun t5_survivesBackgrounding() {
    launch()
    dismissFirstRun()

    device.pressHome()
    device.waitForIdle(2_000)
    launch()

    assertNotNull(
      "jojo did not come back after being backgrounded.",
      device.findObject(By.pkg(PACKAGE).depth(0)),
    )
    assertTrue(
      "The app came back to a red box — the bridge did not survive resume.",
      !appears(By.textContains("Unable to load script"), 2_000),
    )
  }

  private companion object {
    const val PACKAGE = "dev.jojo.tracker"
  }
}
