/**
 * The scene's two textures, vendored into `public/transfer/`.
 *
 * The original component pulled both from a third-party image CDN. On a screen
 * whose whole claim is that nothing leaves this device, a runtime request to
 * someone else's host is not a detail — it is the promise broken, visibly, in
 * the network tab. Same pixels, served from the same origin, and the scene
 * still renders with the machine offline.
 *
 * Named here rather than inlined so the still fallback and the shader cannot
 * drift onto different images.
 */
export const COLOR_MAP = '/transfer/scene.png'
export const DEPTH_MAP = '/transfer/scene-depth.webp'

/** Intrinsic size of both maps — the plane's aspect comes from this. */
export const MAP_WIDTH = 626
export const MAP_HEIGHT = 626
