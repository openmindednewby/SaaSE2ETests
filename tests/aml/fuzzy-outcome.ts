// AM-READY-5 §7 — the outcomes a screened row can have against an expected name.
// Own file: each exported enum lives alone (/lint-rules).
//
// 🔴 WHY THREE OBSERVED OUTCOMES AND NOT TWO. The service can FIND a row at score 1 and then
// deliberately withhold it: COV-12 deceased-hide returns it in `suppressedMatches` with
// `suppressedDeceasedCount >= 1` instead of `matchedEntities`. A harness that reads only
// `matchedEntities` scores that perfect, intended behaviour as a recall MISS — which is exactly
// how this suite reported 60% exact recall against an index that was returning 15 of 16 rows.
// Collapsing SUPPRESSED into MATCHED would hide the opposite change (suppression silently turning
// off) just as thoroughly, so the two are counted and printed separately, never summed away.
//
// 🔴 `Absent` is INFERRED, not served. Nothing on the response says "not in the index". It is only
// claimed for an EXACT-name screen — where the query IS the indexed string — that comes back in
// neither list. At that point the row is a seed/ingest gap, not a scorer result.
export const enum Outcome {
  Matched = 'matched',
  Suppressed = 'suppressed',
  Missed = 'missed',
  Absent = 'absent-from-index',
}
