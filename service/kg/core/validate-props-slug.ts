/**
 * The slug field every slugged node type's prop schema shares.
 */

import { s } from './schema'

/**
 * `slug` is `min: 1` everywhere it appears: a blank slug passes a `typeof`
 * check, then collides with every other blank one in the `[type, slug]` index,
 * so the second record to arrive silently replaces the first.
 */
export const slug = s.string({ min: 1, label: 'Slug' })
