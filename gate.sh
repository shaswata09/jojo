#!/usr/bin/env bash
# Every migration step ends here, and every step must leave it green.
#
# Deliberately NOT `npm run build` in web: it wipes `dist/`, and a build is not
# what this gate is for. `tsc -b` is the compile half; the bundler half is
# proven separately at the one step where the bundler is the risk.
set -uo pipefail
fail=0
run() { printf '  %-34s' "$1"; shift; if "$@" >/tmp/gate.$$ 2>&1; then echo "ok"; else echo "FAIL"; tail -5 /tmp/gate.$$; fail=1; fi; }

echo "service"
if [ -f service/vitest.config.mts ] || [ -f service/vitest.config.ts ]; then
  run "lint (the layer guards)" npm -w @jojo/service run lint
  run "tsc"                     npm -w @jojo/service exec -- tsc -b
  run "test"                    npm -w @jojo/service run test
else
  echo "  (not populated yet — step 2)"
fi

echo "web"
run "tsc"  npm -w web exec -- tsc -b --force
run "lint" npm -w web run lint
run "test" npm -w web run test

echo "mobile"
run "tsc"  npm -w jojo-mobile exec -- tsc --noEmit
run "lint" npm -w jojo-mobile run lint
run "test" npm -w jojo-mobile run test

rm -f /tmp/gate.$$
[ $fail -eq 0 ] && echo "GATE GREEN" || echo "GATE RED"
exit $fail
