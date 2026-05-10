/**
 * Cluster A NO-HANG sweep.
 *
 * Loads every cluster A level with a baseline placement and asserts
 * the sim *resolves* — emits a result line within a wall-clock budget.
 * The ENGINE-level invariant: sim must never hang. Stall detection
 * (Simulation.STALL_THRESHOLD) caps the worst case at ~30 ticks past
 * the last HP change, so even a perfectly-deadlocked board ends fast.
 *
 * Stalemate is an ACCEPTABLE outcome here (level-balance problem,
 * tracked as task #9 — Cluster A rebalance). What's NOT acceptable
 * is a sim that runs past STALL_THRESHOLD or the test timeout.
 */
import { test, expect } from '@playwright/test';
import { runScenario, SOLID_STATE_BASE } from '../shared/gameFixtures';

interface SweepCase {
  level: string;
  /**
   * Placement spec in the URL TestMode format. Always uses column 2
   * (always inside the player zone for every cluster A level) plus
   * varying rows so multiple units don't stack on the same tile.
   */
  place: string;
  /**
   * Tick budget. Most levels resolve in <30 ticks; we give 100
   * before flagging as "effectively stuck."
   */
  maxTicks?: number;
}

const SWEEP: SweepCase[] = [
  { level: 'a01_initialize',           place: 'Tank@2,1:east' },
  { level: 'a02_friendly_fire',        place: 'Tank@2,2:east;Sniper@2,1:east' },
  { level: 'a03_outflank_the_sniper',  place: 'Scout@0,1:east' },
  { level: 'a04_chokepoint',           place: 'Shooter@2,0:east;Tank@2,1:east;Sniper@2,2:east' },
  { level: 'a05_bomb_the_door',        place: 'Shooter@2,1:east;Bomber@2,2:east' },
  { level: 'a06_field_medic',          place: 'Tank@2,1:east;Sniper@2,2:east;Healer@2,3:east' },
  { level: 'a07_silence_the_sniper',   place: 'Tank@2,1:east;Sniper@2,2:east;Jammer@2,3:east' },
  { level: 'a08_mirror_match',         place: 'Shooter@2,0:east;Shooter@2,1:east;Tank@2,2:east;Bomber@2,3:east' },
  { level: 'a09_protect_the_extraction', place: 'Tank@2,1:east;Scout@2,2:east;Reflector@2,3:east' },
  { level: 'a10_full_house',           place: 'Sniper@2,2:east;Bomber@2,1:east;Healer@2,3:east;Jammer@2,4:east;Tank@2,0:east' },
];

test.describe('cluster A sweep — every level resolves', () => {
  for (const c of SWEEP) {
    test(`${c.level} resolves (any outcome) within tick budget`, async ({ page }) => {
      const r = await runScenario(page, SOLID_STATE_BASE, {
        test: '1',
        level: c.level,
        place: c.place,
        autoplay: '1',
      }, 60_000);
      // Engine invariant: sim MUST emit a result. Stall detection
      // bounds even the worst case. If we got here with a parsed
      // result, the engine did its job — the test PASSES.
      expect(['win', 'loss', 'stalemate']).toContain(r.result);
      // Sanity bound — even with stall detection, runs should
      // complete in well under the MAX_TICKS hard cap.
      expect(r.ticks).toBeLessThan(200);
      // Stalemate outcomes are content/balance signals, not engine
      // bugs. We log them via console.warn so they're visible in
      // CI output without failing the test.
      if (r.result === 'stalemate') {
        // eslint-disable-next-line no-console
        console.warn(`[content] ${c.level} stalemates with ${c.place} after ${r.ticks} ticks (reason: ${r.reason}). Level rebalance candidate.`);
      }
    });
  }
});
