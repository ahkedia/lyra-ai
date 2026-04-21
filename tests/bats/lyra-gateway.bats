#!/usr/bin/env bats
# Run: bats tests/bats/lyra-gateway.bats
# Requires: https://github.com/bats-core/bats-core (brew install bats-core)

setup() {
    REPO_ROOT="$(cd "$(dirname "${BATS_TEST_FILENAME}")/../.." && pwd)"
    export REPO_ROOT
}

@test "openclaw-wrapper.sh parses under bash -n" {
    run bash -n "${REPO_ROOT}/scripts/openclaw-wrapper.sh"
    [ "$status" -eq 0 ]
}

@test "lyra-gateway-smoke.sh parses under bash -n" {
    run bash -n "${REPO_ROOT}/scripts/lyra-gateway-smoke.sh"
    [ "$status" -eq 0 ]
}

@test "lyra-gateway-smoke live check (skipped unless RUN_LYRA_GATEWAY_SMOKE=1)" {
    if [ "${RUN_LYRA_GATEWAY_SMOKE:-}" != "1" ]; then
        skip "set RUN_LYRA_GATEWAY_SMOKE=1 on the server to run live smoke"
    fi
    run bash "${REPO_ROOT}/scripts/lyra-gateway-smoke.sh"
    [ "$status" -eq 0 ]
}
