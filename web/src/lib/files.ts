/**
 * The web import path for how a picked file becomes a Vault record.
 *
 * The implementation is `@/kg/core/files`. It moved down because nothing in it
 * is web-only — it reads a name, a size and a reported type, none of which a
 * browser owns — and because it was on the list of `src/lib` modules the mobile
 * app keeps in step by copying the file across. A rule maintained that way is a
 * rule that disagrees the first time only one copy is edited, which is how the
 * Vault's Files tool and the Profile's Documents panel came to draw two
 * different icons for the same .odp deck before either map was shared at all.
 *
 * Re-exported rather than re-imported at each call site so the two surfaces that
 * file documents — `components/vault/FilesTool.tsx` and `routes/Profile.tsx` —
 * kept their import line when it moved, on the precedent `src/lib/undo.ts` set.
 * Nothing else belongs in here: a helper that reads file CONTENT, or a picker,
 * is web-only and goes next to `storage.ts` under its own name.
 */

export { kindOfFile, sizeLabel } from '@/kg/core/files'
