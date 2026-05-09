/**
 * Solid State scenario tests. Drives the deployed game via its URL
 * test-mode (?test=1&level=...&place=...&autoplay=1) and asserts the
 * canonical [TEST] line printed to the browser console.
 *
 * These scenarios intentionally exercise BOTH happy paths and known
 * bug repros — when the bug is unfixed the corresponding test fails;
 * when the fix lands, the test goes green and locks the regression in.
 */
import { test, expect } from '@playwright/test';
import { runScenario, SOLID_STATE_BASE } from '../shared/gameFixtures';

test.describe('solid-state — scenario harness', () => {
  test('A-01 INITIALIZE: Tank advances and eliminates Shooter', async ({ page }) => {
    const r = await runScenario(page, SOLID_STATE_BASE, {
      test: '1',
      level: 'a01_initialize',
      place: 'Tank@2,1:east',
      autoplay: '1',
    });
    expect(r.result).toBe('win');
    expect(r.reason).toMatch(/All_hostile_units_eliminated/);
    expect(r.ticks).toBeGreaterThan(0);
    expect(r.ticks).toBeLessThan(10);
  });

  test('A-01 INITIALIZE: Tank placed too far west still wins (sanity)', async ({ page }) => {
    const r = await runScenario(page, SOLID_STATE_BASE, {
      test: '1',
      level: 'a01_initialize',
      place: 'Tank@0,1:east',
      autoplay: '1',
    });
    expect(r.result).toBe('win');
  });

  /**
   * Locks in the fix for the user-reported bug: on REACH levels,
   * friendly bots with no in-vision enemy now fall back to stepping
   * toward `win_target_tile` (Simulation._maybe_reach_fallback). Before
   * the fix this scenario stalemated at 600 ticks because the Scout
   * had no objective once it ran out of things to engage.
   *
   * Place a Scout at (0,1). It walks east, eventually past the
   * Shooter at (5,1) — survives or not depends on combat math, but
   * either way the sim resolves quickly instead of hanging at 600.
   */
  test('A-03 EXTRACTION: REACH level resolves quickly, never stalemates', async ({ page }) => {
    const r = await runScenario(page, SOLID_STATE_BASE, {
      test: '1',
      level: 'a03_outflank_the_sniper',
      place: 'Scout@0,1:east',
      autoplay: '1',
    }, 60_000);
    // Whatever the outcome, the sim must NOT stalemate — that's the bug.
    expect(r.result).not.toBe('stalemate');
    expect(r.ticks).toBeLessThan(50);
  });
});
