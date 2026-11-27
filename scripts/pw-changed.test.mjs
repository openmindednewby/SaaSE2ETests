import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildArgs, fullRunReason, isFullRunFile } from './pw-changed.mjs';

test('a named spec with a line filter is an explicit selection, not changed-only', () => {
  assert.equal(fullRunReason(['tests/nextgame/home.spec.ts:42']), 'named spec file');
});

test('a plain named spec is an explicit selection', () => {
  assert.equal(fullRunReason(['tests/nextgame/home.spec.ts']), 'named spec file');
});

test('a project flag alone keeps changed-only selection', () => {
  assert.equal(fullRunReason(['--project=nextgame']), '');
});

test('--full forces the full run', () => {
  assert.equal(fullRunReason(['--full']), '--full / E2E_FULL=1');
});

test('a config or fixture change forces the full run, a spec change does not', () => {
  assert.equal(isFullRunFile('playwright.config.ts'), true);
  assert.equal(isFullRunFile('fixtures/auth.fixture.ts'), true);
  assert.equal(isFullRunFile('tsconfig.json'), true);
  assert.equal(isFullRunFile('tests/health/services-health.spec.ts'), false);
});

test('changed mode appends --only-changed with the base and drops --full', () => {
  assert.deepEqual(buildArgs(['--project=x', '--full'], { mode: 'changed', base: 'abc123' }), ['test', '--project=x', '--only-changed=abc123']);
});

test('app mode appends the app spec folders', () => {
  assert.deepEqual(buildArgs([], { mode: 'app', specs: ['tests/nextgame'] }), ['test', 'tests/nextgame']);
});
