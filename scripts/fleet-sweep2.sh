#!/usr/bin/env bash
# Batch 2: corrected project mappings, the new specs, and ISOLATED re-runs of the
# suspected rate-limit failures.
#
# Every suite is preceded by a >60s cooldown, because the login limiter is 5/60s per IP.
# That cooldown is the whole point of this batch: a test that FAILS in a dense suite and
# PASSES alone after the limiter window has drained is an environment artifact, not a
# product regression — and the two are indistinguishable without this wait.
set -u

OUT="${1:-/tmp/fleet-sweep2}"
COOLDOWN="${COOLDOWN_SECONDS:-75}"
mkdir -p "$OUT"
cd "$(dirname "$0")/.." || exit 1

SUITES="$OUT/suites.txt"

run_suite() {
  local name="$1"; shift
  local log="$OUT/$name.log"
  local tries=0

  while [ "$tries" -lt 140 ]; do
    if E2E_TARGET=prod npx playwright test "$@" --reporter=line >"$log" 2>&1; then
      echo "$name PASS" >>"$SUITES"
      return 0
    fi
    if grep -q "REFUSING TO START" "$log"; then
      tries=$((tries + 1))
      sleep 15
      continue
    fi
    echo "$name FAIL" >>"$SUITES"
    return 1
  done
  echo "$name LOCKED-OUT" >>"$SUITES"
  return 1
}

echo "=== batch2 started $(date -u +%FT%TZ) (cooldown=${COOLDOWN}s) ===" >"$OUT/progress.txt"
while read -r line; do
  [ -z "$line" ] && continue
  name="${line%% *}"
  args="${line#* }"
  echo "    cooling down ${COOLDOWN}s (login limiter drain)" >>"$OUT/progress.txt"
  sleep "$COOLDOWN"
  echo "--> $name $(date -u +%TZ)" >>"$OUT/progress.txt"
  # shellcheck disable=SC2086
  run_suite "$name" $args
  echo "    $name done rc=$? $(date -u +%TZ)" >>"$OUT/progress.txt"
done <"$OUT/plan.txt"
echo "=== batch2 finished $(date -u +%FT%TZ) ===" >>"$OUT/progress.txt"
