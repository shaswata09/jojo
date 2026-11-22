/**
 * The scene's two textures, vendored into `public/transfer/`.
 *
 * The original component pulled both from a third-party image CDN. On a screen
 * whose whole claim is that nothing leaves this device, a runtime request to
 * someone else's host is not a detail — it is the promise broken, visibly, in
 * the network tab. So they are served from the same origin, and the scene
 * still renders with the machine offline.
 *
 * They are no longer the CDN's pixels. Those were vendored with no record of
 * where they came from or on what terms, so they were replaced with a picture
 * this repository draws itself: `scripts/make-transfer-scene.py` writes both
 * files (two devices, and record cards arcing from one to the other, ordered
 * by depth, with the arc's lanes fitted to it — DataTransferScene.tsx carries
 * its packets of light along exactly that arc). Change the picture
 * by changing that script and re-running it, not by dropping in another image.
 *
 * Named here rather than inlined so the still fallback and the shader cannot
 * drift onto different images.
 */
import { publicUrl } from '@/lib/public-url'

export const COLOR_MAP = publicUrl('transfer/scene.png')
export const DEPTH_MAP = publicUrl('transfer/scene-depth.webp')

/** Intrinsic size of both maps — the plane's aspect comes from this. */
export const MAP_WIDTH = 626
export const MAP_HEIGHT = 626
