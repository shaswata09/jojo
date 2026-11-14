#!/usr/bin/env bash
# Every migration step ends here, and every step must leave it green.
#
# The same checks CI's gate job runs, in the same order, so green here means
# green there. Two differences, both about this being a working tree:
#
#  - The web build goes to a scratch directory, not `dist/`: `npm run build`
#    wipes `dist/`, and somebody may be serving it. The steps are the build
#    script's, minus the second `tsc -b` (the "tsc" line above it already ran
#    it, with --force): pack the extension, the icons, `vite build`, the SPA
#    fallback, and `make-sw` — which is where `precache-guard` fails a worker
#    that would not boot offline. It adds a few seconds; a bundle that does not
#    build is a release that cannot ship, and this used to find that out in CI.
#  - Nothing is skipped silently. The service suite was skipped when its
#    vitest config was not where this looked, so moving or renaming that file
#    turned the gate green with zero service tests run (R35). It fails now.
set -uo pipefail
fail=0
log=$(mktemp)
out=$(mktemp -d)
trap 'rm -rf "$log" "$out"' EXIT
run() { printf '  %-34s' "$1"; shift; if "$@" >"$log" 2>&1; then echo "ok"; else echo "FAIL"; tail -5 "$log"; fail=1; fi; }

echo "service"
if [ -f service/vitest.config.mts ] || [ -f service/vitest.config.ts ]; then
  run "lint (the layer guards)" npm -w @jojo/service run lint
  run "tsc"                     npm -w @jojo/service exec -- tsc -b
  # test:coverage, as CI runs it: the same suite plus the kg/core and kg/agent
  # coverage floors in service/vitest.config.mts.
  run "test (+ coverage floors)"  npm -w @jojo/service run test:coverage
else
  echo "  FAIL: no service/vitest.config.mts or .ts — the service suite would not run."
  echo "        If the config moved, update gate.sh (and CI) to find it."
  fail=1
fi

echo "web"
run "tsc"  npm -w web exec -- tsc -b --force
run "lint" npm -w web run lint
run "test" npm -w web run test
build_web() {
  npm -w web run pack-extension &&
    npm -w web run make-pwa-icons &&
    (cd web && npx vite build --outDir "$out" --emptyOutDir) &&
    JOJO_DIST="$out" node web/scripts/spa-fallback.mjs &&
    JOJO_DIST="$out" node web/scripts/make-sw.mjs
}
run "build (+ precache guard)"  build_web

echo "mobile"
run "tsc"  npm -w jojo-mobile exec -- tsc --noEmit
run "lint" npm -w jojo-mobile run lint
run "test" npm -w jojo-mobile run test

[ $fail -eq 0 ] && echo "GATE GREEN" || echo "GATE RED"
exit $fail
