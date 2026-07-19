#!/usr/bin/env bash
# Fleet E2E sweep runner. Waits for the prod canary lock to free before each suite,
# so it never collides with the concurrent workstream and never deletes a lock it
# does not own. One suite at a time, output captured per suite.
set -u

OUT="${1:-/tmp/fleet-sweep}"
mkdir -p "$OUT"
cd "$(dirname "$0")/.." || exit 1

SUITES="$OUT/suites.txt"

run_suite() {
  local name="$1"; shift
  local log="$OUT/$name.log"

  # Wait for the canary lock to free (max ~35 min, TTL is 30).
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

echo "=== fleet sweep started $(date -u +%FT%TZ) ===" >"$OUT/progress.txt"
while read -r line; do
  [ -z "$line" ] && continue
  name="${line%% *}"
  args="${line#* }"
  echo "--> $name $(date -u +%TZ)" >>"$OUT/progress.txt"
  # shellcheck disable=SC2086
  run_suite "$name" $args
  echo "    $name done rc=$? $(date -u +%TZ)" >>"$OUT/progress.txt"
done <"$OUT/plan.txt"
echo "=== fleet sweep finished $(date -u +%FT%TZ) ===" >>"$OUT/progress.txt"
