import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Pure helpers for SeaweedFS retention: `aws s3api delete-objects` accepts at most 1000 keys per call.
 * canary-incluster-cleanup.mjs does the I/O; s3-delete-batches.test.mjs covers this module.
 */

export const S3_DELETE_BATCH_MAX = 1000;

export function chunkKeys(keys, size = S3_DELETE_BATCH_MAX) {
  if (!Number.isInteger(size) || size < 1 || size > S3_DELETE_BATCH_MAX)
    throw new Error(`batch size ${size} must be an integer in 1..${S3_DELETE_BATCH_MAX}`);
  const batches = [];
  for (let i = 0; i < keys.length; i += size) batches.push(keys.slice(i, i + size));
  return batches;
}

export function deletePayload(keys) {
  return JSON.stringify({ Objects: keys.map((Key) => ({ Key })), Quiet: true });
}

/**
 * A 1000-key payload on argv overflows the kernel's per-argument limit (spawnSync E2BIG), so the
 * payload goes to a temp file and the CLI reads it through `--delete file://...`.
 */
export function deleteArgsViaFile(keys, dir = mkdtempSync(join(tmpdir(), 's3-delete-'))) {
  const file = join(dir, 'delete.json');
  writeFileSync(file, deletePayload(keys), 'utf8');
  return {
    arg: pathToFileURL(file).href,
    file,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Quiet mode returns only failures; an empty stdout means every key was deleted. */
export function parseDeleteResult(stdout, requested) {
  const text = (stdout ?? '').trim();
  const errors = text ? (JSON.parse(text).Errors ?? []) : [];
  return {
    deleted: requested - errors.length,
    errors: errors.map((e) => `${e.Key}: ${e.Code ?? ''} ${e.Message ?? ''}`.trim()),
  };
}
