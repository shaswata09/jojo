/**
 * Whether an address is this machine or the person's own network.
 *
 * The rule lives in core (`service/kg/core/local-target.ts`) so the phone's
 * "Keep a copy" refuses the same addresses the posting readers do; this module
 * keeps the import path every web caller and `posting-target.test.ts` use.
 */
export { isLocalTarget } from '@jojo/service/core/local-target'
