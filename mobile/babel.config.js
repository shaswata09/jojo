/**
 * Babel is configured only because Reanimated needs it to be.
 *
 * Reanimated runs callbacks on the UI thread rather than the JS thread — that
 * is the whole reason the board's drag stays smooth while a finger is down.
 * Getting a function onto that thread means compiling it into a "worklet", and
 * that compilation is a Babel plugin. Without this file the app builds and then
 * throws at the first gesture.
 *
 * In Reanimated 4 the plugin moved out into `react-native-worklets`; the old
 * `react-native-reanimated/plugin` path still exists but forwards here, and
 * listing both would run the transform twice. It must stay last in the list.
 *
 * The preset was `babel-preset-expo`, which wraps `@react-native/babel-preset`
 * and adds Expo's own transforms on top. One of the things it added was the
 * worklets plugin, automatically — so after this swap the explicit entry below
 * is the ONLY source of it. Deleting the line as a redundant-looking duplicate
 * is a silent break: the app still builds and dies on the first drag.
 */
module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['module:@react-native/babel-preset'],
    plugins: ['react-native-worklets/plugin'],
  }
}
