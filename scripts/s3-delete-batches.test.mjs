// Run: node --test scripts/s3-delete-batches.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkKeys, deletePayload, parseDeleteResult, S3_DELETE_BATCH_MAX } from './s3-delete-batches.mjs';

const keys = (n) => Array.from({ length: n }, (_, i) => `run-${i}/report.json`);

test('2300 keys become three delete-objects calls of 1000, 1000 and 300', () => {
  const batches = chunkKeys(keys(2300));
  assert.deepEqual(batches.map((b) => b.length), [1000, 1000, 300]);
  assert.equal(batches.flat().length, 2300, 'every key lands in exactly one batch');
  assert.equal(batches[2][0], 'run-2000/report.json', 'order is preserved across batch boundaries');
});

test('exactly 1000 keys is one batch; none is zero batches', () => {
  assert.equal(chunkKeys(keys(S3_DELETE_BATCH_MAX)).length, 1);
  assert.deepEqual(chunkKeys([]), []);
});

test('a batch size above the S3 limit is refused', () => {
  assert.throws(() => chunkKeys(keys(3), 1001), /1\.\.1000/);
  assert.throws(() => chunkKeys(keys(3), 0), /1\.\.1000/);
});

test('payload lists every key in quiet mode', () => {
  assert.deepEqual(JSON.parse(deletePayload(['a', 'b/c'])), { Objects: [{ Key: 'a' }, { Key: 'b/c' }], Quiet: true });
});

test('empty quiet output counts every key as deleted; Errors are subtracted and named', () => {
  assert.deepEqual(parseDeleteResult('', 1000), { deleted: 1000, errors: [] });
  const out = JSON.stringify({ Errors: [{ Key: 'x', Code: 'AccessDenied', Message: 'no' }] });
  assert.deepEqual(parseDeleteResult(out, 5), { deleted: 4, errors: ['x: AccessDenied no'] });
});
