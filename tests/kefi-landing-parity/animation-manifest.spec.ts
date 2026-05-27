/**
 * Animation-manifest spec — `kefi-landing-parity`.
 *
 * Deterministic motion-parity check without screenshot-diff brittleness.
 * For each tenant we capture the animation/transition properties of three
 * "always-on" element roles (nav, hero badge, register CTA) plus the
 * total animated-element count, and assert kefi matches the standalone.
 *
 * The measurement runs BEFORE any motion-freeze CSS — otherwise every
 * value collapses to "0s". The complementary `dom-parity.spec.ts` does
 * the structure + computed-style asserts that DO need a frozen stage.
 *
 * Failures here mean: an element that animates on the standalone doesn't
 * animate on kefi (or animates differently). That's exactly the
 * regression class screenshot diffs are bad at catching.
 */
import { expect, test } from '@playwright/test';
import { TENANTS } from './parity-tenants.js';
import {
  extractAnimationManifest,
  gotoAndSettle,
  type AnimationManifest,
  type AnimationRole,
} from './parity-helpers.js';

/**
 * Animated-element-count drift we tolerate. Both standalone and kefi may
 * legitimately differ by a handful (e.g. one extra hover-transition on a
 * button) — we care about catastrophic drift (50% missing), not noise.
 */
const ANIMATED_COUNT_TOLERANCE_RATIO = 0.30;

/**
 * Roles where the animation-properties must match exactly. Each role
 * resolves to a single element via `parity-helpers.extractAnimationManifest`.
 */
const STRICT_ROLES: ReadonlyArray<AnimationRole> = ['nav'];

/**
 * Roles where we accept a missing element on either side (the standalone
 * may not have the element at all, e.g. registerCta when registration
 * is closed). We still assert: if both sides have it, the properties match.
 */
const TOLERANT_ROLES: ReadonlyArray<AnimationRole> = ['heroBadge', 'registerCta'];

for (const tenant of TENANTS) {
  test(`@kefi-landing-parity ${tenant.label} animation-manifest matches`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    try {
      const standalone = await captureAnimationManifest(page, tenant.standaloneUrl);
      const kefi = await captureAnimationManifest(page, tenant.kefiUrl);

      const skipped = new Set<AnimationRole>(tenant.knownGaps.skipAnimationRoles ?? []);
      if (skipped.size) {
        test.info().annotations.push({
          type: 'known-gap',
          description: `animation roles skipped: ${Array.from(skipped).join(', ')}`,
        });
      }

      assertStrictRolesMatch(standalone, kefi, skipped);
      assertTolerantRolesMatch(standalone, kefi, skipped);
      assertAnimatedCountInBand(standalone, kefi);
    } finally {
      await context.close();
    }
  });
}

async function captureAnimationManifest(
  page: import('@playwright/test').Page,
  url: string,
): Promise<AnimationManifest> {
  await gotoAndSettle(page, url);
  return extractAnimationManifest(page);
}

function assertStrictRolesMatch(
  standalone: AnimationManifest,
  kefi: AnimationManifest,
  skipped: Set<AnimationRole>,
): void {
  for (const role of STRICT_ROLES) {
    if (skipped.has(role)) continue;
    const std = standalone.byRole[role];
    const kef = kefi.byRole[role];
    expect(std, `standalone reference missing animation role "${role}"`).not.toBeNull();
    expect(kef, `kefi render missing animation role "${role}"`).not.toBeNull();
    if (!std || !kef) continue;
    expect(kef.animationName, `${role} animation-name`).toBe(std.animationName);
    expect(kef.animationDuration, `${role} animation-duration`).toBe(std.animationDuration);
    expect(kef.transitionProperty, `${role} transition-property`).toBe(std.transitionProperty);
    expect(kef.transitionDuration, `${role} transition-duration`).toBe(std.transitionDuration);
  }
}

function assertTolerantRolesMatch(
  standalone: AnimationManifest,
  kefi: AnimationManifest,
  skipped: Set<AnimationRole>,
): void {
  for (const role of TOLERANT_ROLES) {
    if (skipped.has(role)) continue;
    const std = standalone.byRole[role];
    const kef = kefi.byRole[role];
    if (!std || !kef) {
      // Missing on either side is allowed for tolerant roles — record as
      // an annotation so the run remains legible.
      test.info().annotations.push({
        type: 'tolerant-role-absent',
        description: `role "${role}" absent on ${std ? 'kefi' : 'standalone'}`,
      });
      continue;
    }
    expect(kef.animationName, `${role} animation-name`).toBe(std.animationName);
    expect(kef.transitionProperty, `${role} transition-property`).toBe(std.transitionProperty);
    expect(kef.transitionDuration, `${role} transition-duration`).toBe(std.transitionDuration);
  }
}

function assertAnimatedCountInBand(standalone: AnimationManifest, kefi: AnimationManifest): void {
  const ref = Math.max(standalone.animatedElementCount, 1);
  const drift = Math.abs(standalone.animatedElementCount - kefi.animatedElementCount) / ref;
  expect(
    drift,
    `animated element count drift (std=${standalone.animatedElementCount}, kefi=${kefi.animatedElementCount})`,
  ).toBeLessThan(ANIMATED_COUNT_TOLERANCE_RATIO);
}
