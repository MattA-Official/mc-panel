#!/usr/bin/env bash
# Installs an older release in the "vps" container, puts some data in its database,
# installs the release under test over it, and checks the data and schema came through.
# Usage: upgrade.sh <old version> <new tarball inside the container>
set -euo pipefail
old="$1"
new_tarball="$2"
db=/var/lib/flytower/flytower.db
in_vps() { docker exec vps "$@"; }
# As the panel's user, so SQLite's side files stay writable by the panel.
sql() { docker exec -u flytower vps /opt/flytower/current/bin/bun -e "
  const { Database } = require('bun:sqlite')
  const db = new Database('$db')
  const out = db.query(process.argv[1]).all()
  console.log(JSON.stringify(out))
" "$1"; }
health() { in_vps curl -fsS http://127.0.0.1:3000/api/health; }
wait_health() {
  for _ in $(seq 1 60); do health >/dev/null 2>&1 && return 0; sleep 1; done
  in_vps journalctl -u flytower-panel -u flytower-agent --no-pager -n 80
  return 1
}

echo "::group::Install $old"
curl -fsSL -o "old/install-$old.sh" "https://github.com/MattA-Official/mc-panel/releases/download/v$old/install.sh"
curl -fsSL -o "old/flytower-$old.tar.gz" \
  "https://github.com/MattA-Official/mc-panel/releases/download/v$old/flytower-$old-linux-amd64.tar.gz"
in_vps bash "/src/old/install-$old.sh" --domain localhost --tarball "/src/old/flytower-$old.tar.gz" \
  --no-caddy --no-firewall --setup-token e2e-setup-token
wait_health
health | grep -q "\"version\":\"$old\"" || { echo "not on $old: $(health)"; exit 1; }
echo "::endgroup::"

# Data as a real install would have it: someone set up, with a server.
sql "INSERT INTO users (name) VALUES ('Upgrader')" >/dev/null
sql "INSERT INTO credentials (id, user_id, public_key, nickname) VALUES ('cred', 1, x'00', 'Old phone')" >/dev/null
sql "INSERT INTO servers (name, display_name, loader, mc_version, java_major, memory_mb, port, rcon_port, rcon_password, eula_accepted_at)
     VALUES ('kept', 'Kept', 'fabric', '26.3', 25, 2048, 25565, 25575, 'pw', 0)" >/dev/null
in_vps systemctl restart flytower-panel
wait_health
before="$(sql 'SELECT tag FROM __flytower_migrations ORDER BY tag')"

echo "::group::Upgrade to the release under test"
in_vps bash /src/installer/install.sh --domain localhost --tarball "$new_tarball" \
  --no-caddy --no-firewall --setup-token e2e-setup-token
wait_health
echo "::endgroup::"

health | grep -q '"ok":true' || { echo "agent not reachable after the upgrade: $(health)"; exit 1; }
after="$(sql 'SELECT tag FROM __flytower_migrations ORDER BY tag')"
want="$(ls apps/panel/server/db/migrations/*.sql | wc -l)"
got="$(echo "$after" | grep -o '"tag"' | wc -l)"
[ "$got" = "$want" ] || { echo "migrations: $got of $want applied ($after)"; exit 1; }
sql "SELECT name, display_name FROM servers" | grep -q '"name":"kept"' || { echo "server row lost"; exit 1; }
state="$(in_vps curl -fsS http://127.0.0.1:3000/api/auth/state)"
echo "$state" | grep -q '"needsSetup":false' || { echo "asks for setup again: $state"; exit 1; }
in_vps grep -q NUXT_APP_SECRET /etc/flytower/panel.env
echo "✓ upgraded from $old: $got migrations ($(echo "$before" | grep -o '"tag"' | wc -l) before), data kept"
