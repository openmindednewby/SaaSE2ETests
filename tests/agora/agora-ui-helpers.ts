// Helpers for the Agora @ui tier.
//
// Kept separate from agora-helpers.ts so the browser tier does not drag in the API client, and
// so agora-helpers.ts stays under the 300-line file limit.
export { AGORA_WEB_URL, MERCHANT_A, MERCHANT_B } from './agora-helpers.js';

/** Unique-ish suffix so repeat runs never collide on a unique constraint (coupon codes). */
export function uniqueSuffixUi(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
