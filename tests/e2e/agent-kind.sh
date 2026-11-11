#!/usr/bin/env bash
# Prints which agent the "vps" container is running, rust or bun, once systemd has started
# it. bin/flytower-agent execs the one it picks, so the unit's main process is that program.
set -euo pipefail
exe=''
for _ in $(seq 1 30); do
  exe="$(docker exec vps sh -c 'pid=$(systemctl show -p MainPID --value flytower-agent)
    [ "$pid" != 0 ] && readlink "/proc/$pid/exe"' 2>/dev/null || true)"
  case "$exe" in
    # The Rust agent deletes its start marker once it's listening.
    */flytower-agent-rust)
      docker exec vps test -e /run/flytower/agent-rust-starting || { echo rust; exit 0; } ;;
    */bun) echo bun; exit 0 ;;
  esac
  sleep 1
done
echo "the agent isn't running: ${exe:-nothing}" >&2
docker exec vps journalctl -u flytower-agent --no-pager -n 30 >&2 || true
exit 1
