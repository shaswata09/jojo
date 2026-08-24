import type { LinkingOptions } from '@react-navigation/native'
import type { RootStackParamList } from '@/navigation/types'

/**
 * What a `jojo://` address means, and what happens when one arrives.
 *
 * Both native projects have declared the scheme since the day they were
 * generated — an intent filter in `AndroidManifest.xml`, two entries in
 * `CFBundleURLSchemes` — and nothing listened. Firing
 * `jojo://application/rice-statistics` at the running app delivered the intent
 * and left the user exactly where they were, which is worse than not claiming
 * the scheme at all: a link that silently does nothing teaches people the app
 * is broken rather than that the feature is missing.
 *
 * WHAT IT UNLOCKS is not really deep linking. It is the piece every other way
 * into this app has to stand on: the Android share sheet below, a notification
 * tap when there are notifications, a link out of the assistant's reply, and a
 * QR code on a laptop that opens the record on a phone. None of those can be
 * built until an address means something.
 *
 * THE RECORD ADDRESS TAKES A SLUG OR AN ID and needs no code to do it.
 * `useApplications().get` already resolves either through `resolveAddress`, for
 * the web app's benefit, so `jojo://application/rice-statistics` and
 * `jojo://application/app:01a0…` both land on the same screen.
 */
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['jojo://'],
  config: {
    screens: {
      Tabs: {
        screens: {
          Today: 'today',
          /**
           * `shared` is how the Android share sheet gets here.
           *
           * `MainActivity` rewrites an `ACTION_SEND` into a `jojo://` view of
           * this path, so a URL shared from a browser arrives as an ordinary
           * deep link and everything downstream is JavaScript. The screen opens
           * the create sheet on it and clears the parameter.
           */
          Applications: 'applications',
          Calendar: 'calendar',
          Vault: 'vault',
          More: 'more',
        },
      },
      ApplicationDetail: 'application/:id',
      // 'employer' rather than 'organisation': the model's word is the node's,
      // and a URL a person may read should use the word they would say.
      Organisation: 'employer/:key',
      Search: 'search',
      JobScout: 'scout',
      Statistics: 'statistics',
      Profile: 'profile',
      Assistant: 'assistant',
      Settings: 'settings',
      Guide: 'guide',
      Graph: 'graph',
      Transfer: 'transfer',
    },
  },
}
