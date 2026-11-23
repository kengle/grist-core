#!/usr/bin/env bash
# One container, two processes: the Grist server, and the MCP bridge on loopback.
# If either process exits, the other is stopped and the container exits non-zero,
# so a half-dead container is never left running.
set -uo pipefail

child_pids=()

stop_all() {
    local pid
    for pid in "${child_pids[@]:-}"; do
        [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
    done
}

on_signal() {
    trap - TERM INT
    stop_all
    wait 2>/dev/null || true
    exit 143
}
trap on_signal TERM INT

# Grist, exactly as the image's original CMD ran it.
./sandbox/run.sh > >(sed -u 's/^/[grist] /') 2> >(sed -u 's/^/[grist] /' >&2) &
child_pids+=($!)

# The MCP bridge; it only listens on the loopback interface.
node apps/mcp-bridge/dist/server.js > >(sed -u 's/^/[mcp] /') 2> >(sed -u 's/^/[mcp] /' >&2) &
child_pids+=($!)

wait -n
status=$?
stop_all
wait 2>/dev/null || true
# Either process stopping means the container must stop too.
[[ $status -eq 0 ]] && status=1
exit "$status"
