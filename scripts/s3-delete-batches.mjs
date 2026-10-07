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

/** Quiet mode returns only failures; an empty stdout means every key was deleted. */
export function parseDeleteResult(stdout, requested) {
  const text = (stdout ?? '').trim();
  const errors = text ? (JSON.parse(text).Errors ?? []) : [];
  return {
    deleted: requested - errors.length,
    errors: errors.map((e) => `${e.Key}: ${e.Code ?? ''} ${e.Message ?? ''}`.trim()),
  };
}
