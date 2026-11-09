#!/usr/bin/env bash
# Flytower installer. Safe to run again: it upgrades in place and keeps secrets and data.
#
#   curl -fsSL https://github.com/MattA-Official/mc-panel/releases/download/v<version>/install.sh \
#     | sudo bash -s -- --domain panel.example.com
#
set -euo pipefail

REPO="MattA-Official/mc-panel"
PREFIX="/opt/flytower"
# Releases are signed with this key (installer/release-key.pem; a test keeps them equal).
RELEASE_KEY="$(cat <<'KEY'
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAvYI8I2s8fiJ85JYPWsQCU56IZCNqHv+jJB3CqjERe+U=
-----END PUBLIC KEY-----
KEY
)"
STATE_DIR="/var/lib/flytower"
CONFIG_DIR="/etc/flytower"
SERVERS_DIR="/srv/flytower/servers"
SYSTEMD_DIR="/etc/systemd/system"
PANEL_PORT=3000

domain=""
version="latest"
pr=""
tarball=""
setup_token=""
with_caddy=1
with_firewall=1

say() { printf '\033[1;33m==>\033[0m %s\n' "$*"; }
die() {
  printf '\033[1;31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: install.sh --domain <host> [options]

  --domain <host>       The panel's address, e.g. panel.example.com. Its DNS must point here.
  --version <x.y.z>     Install this release instead of the latest.
  --tarball <file>      Install from a release tarball already on this machine.
  --pr <number>         Install the test build of that pull request (for testing, not for
                        real servers). It's signed like a release.
  --setup-token <text>  Use this setup token instead of generating one.
  --no-caddy            Don't install or configure Caddy (bring your own HTTPS proxy).
  --no-firewall         Don't touch ufw.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) domain="${2:-}"; shift 2 ;;
    --version) version="${2#v}"; shift 2 ;;
    --tarball) tarball="${2:-}"; shift 2 ;;
    --pr) pr="${2:-}"; shift 2 ;;
    --setup-token) setup_token="${2:-}"; shift 2 ;;
    --no-caddy) with_caddy=0; shift ;;
    --no-firewall) with_firewall=0; shift ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
done

[[ -n "$domain" ]] || { usage >&2; die "--domain is required (passkeys need HTTPS on a real name)"; }
[[ "$domain" =~ ^[A-Za-z0-9.-]+$ ]] || die "--domain should be a host name like panel.example.com"
[[ -z "$pr" || "$pr" =~ ^[0-9]+$ ]] || die "--pr should be a pull request number, like 70"

# ---------------------------------------------------------------- checks

[[ $EUID -eq 0 ]] || die "run this as root (sudo bash ...)"
[[ -d /run/systemd/system ]] || die "this machine isn't running systemd"

# shellcheck source=/dev/null
. /etc/os-release
case "${ID:-}" in
  ubuntu) dpkg --compare-versions "${VERSION_ID:-0}" ge 24.04 || die "Ubuntu 24.04 or newer is needed" ;;
  debian) dpkg --compare-versions "${VERSION_ID:-0}" ge 12 || die "Debian 12 or newer is needed" ;;
  *) die "only Ubuntu 24.04+ and Debian 12+ are supported for now (found ${PRETTY_NAME:-unknown})" ;;
esac

case "$(uname -m)" in
  x86_64) arch=amd64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) die "unsupported CPU architecture $(uname -m)" ;;
esac

for tool in curl tar sha256sum useradd systemctl; do
  command -v "$tool" >/dev/null || die "$tool is missing"
done

# ---------------------------------------------------------------- release

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

if [[ -z "$tarball" ]]; then
  if [[ -n "$pr" ]]; then
    # Pull request builds live under a pr-<number> tag, which the updater never offers.
    base="https://github.com/$REPO/releases/download/pr-$pr"
    curl -fsSL -o "$work/SHA256SUMS" "$base/SHA256SUMS" ||
      die "there's no test build for pull request $pr"
    name="$(grep -o "flytower-[^ ]*-linux-$arch\.tar\.gz" "$work/SHA256SUMS" | head -n1)"
    [[ -n "$name" ]] || die "pull request $pr's build has nothing for $arch"
    say "Downloading the test build of pull request $pr ($arch)"
  else
    if [[ "$version" == latest ]]; then
      # The newest v-tagged release, pre-releases included; test builds (pr-*) are skipped.
      version="$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=30" |
        sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p' | head -n1)"
      [[ -n "$version" ]] || die "couldn't find the latest release"
    fi
    base="https://github.com/$REPO/releases/download/v$version"
    name="flytower-$version-linux-$arch.tar.gz"
    say "Downloading Flytower $version ($arch)"
    curl -fsSL -o "$work/SHA256SUMS" "$base/SHA256SUMS"
  fi
  curl -fsSL -o "$work/$name" "$base/$name"
  command -v openssl >/dev/null || die "openssl is missing (needed to check the release's signature)"
  curl -fsSL -o "$work/SHA256SUMS.sig" "$base/SHA256SUMS.sig" ||
    die "this release isn't signed; refusing to install it"
  printf '%s\n' "$RELEASE_KEY" >"$work/release-key.pem"
  base64 -d "$work/SHA256SUMS.sig" >"$work/SHA256SUMS.sig.bin" 2>/dev/null ||
    die "this release's signature is unreadable; refusing to install it"
  openssl pkeyutl -verify -pubin -inkey "$work/release-key.pem" -rawin \
    -in "$work/SHA256SUMS" -sigfile "$work/SHA256SUMS.sig.bin" >/dev/null 2>&1 ||
    die "this release's signature doesn't match Flytower's key; refusing to install it"
  (cd "$work" && grep " $name\$" SHA256SUMS | sha256sum -c --quiet -) ||
    die "the download didn't match its checksum; try again"
  if [[ -n "$pr" ]]; then
    echo "Signature checked: this is a genuine Flytower test build."
  else
    echo "Release signature checked: this is a genuine Flytower release."
  fi
  tarball="$work/$name"
fi

[[ -f "$tarball" ]] || die "no such file: $tarball"
mkdir -p "$work/unpack"
tar -xzf "$tarball" -C "$work/unpack"
root="$(find "$work/unpack" -mindepth 1 -maxdepth 1 -type d | head -n1)"
[[ -f "$root/VERSION" && -x "$root/bin/bun" ]] || die "$tarball isn't a Flytower release"
version="$(cat "$root/VERSION")"

say "Installing Flytower $version"
release="$PREFIX/releases/$version"
rm -rf "$release.new"
mkdir -p "$PREFIX/releases"
cp -a "$root" "$release.new"
rm -rf "$release"
mv "$release.new" "$release"
ln -sfn "$release" "$PREFIX/current.new"
mv -T "$PREFIX/current.new" "$PREFIX/current"
bun="$PREFIX/current/bin/bun"

# ---------------------------------------------------------------- users and folders

if ! getent group flytower >/dev/null; then groupadd --system flytower; fi
if ! id -u flytower >/dev/null 2>&1; then
  useradd --system --gid flytower --home-dir "$STATE_DIR" --no-create-home \
    --shell /usr/sbin/nologin flytower
fi

install -d -m 0750 -o flytower -g flytower "$STATE_DIR"
install -d -m 0755 "$CONFIG_DIR" "$CONFIG_DIR/servers" "$(dirname "$SERVERS_DIR")" "$SERVERS_DIR"
install -d -m 0755 "$PREFIX/runtimes"

# ---------------------------------------------------------------- panel config

env_file="$CONFIG_DIR/panel.env"
secret=""
if [[ -f "$env_file" ]]; then
  secret="$(sed -n 's/^NUXT_APP_SECRET=//p' "$env_file")"
fi
if [[ -z "$secret" ]]; then
  secret="$(head -c 48 /dev/urandom | base64 | tr -d '\n/+=' | head -c 64)"
fi

umask 077
cat >"$env_file.new" <<EOF
# Written by the Flytower installer. Re-running it rewrites this file but keeps the secret.
NUXT_APP_SECRET=$secret
NUXT_RP_ID=$domain
NUXT_VERSION=$version
NUXT_SERVERS_DIR=$SERVERS_DIR
HOST=127.0.0.1
PORT=$PANEL_PORT
NITRO_HOST=127.0.0.1
NITRO_PORT=$PANEL_PORT
EOF
chown root:flytower "$env_file.new"
chmod 0640 "$env_file.new"
mv "$env_file.new" "$env_file"
umask 022

# ---------------------------------------------------------------- systemd

cat >"$SYSTEMD_DIR/flytower-agent.service" <<EOF
# Managed by Flytower. Changes are overwritten.
[Unit]
Description=Flytower system helper
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$PREFIX/current/bin/bun $PREFIX/current/agent/agent.js
Environment=FLYTOWER_VERSION=$version
Environment=FLYTOWER_PANEL_GROUP=flytower
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

cat >"$SYSTEMD_DIR/flytower-panel.service" <<EOF
# Managed by Flytower. Changes are overwritten.
[Unit]
Description=Flytower panel
After=network-online.target flytower-agent.service
Wants=network-online.target flytower-agent.service

[Service]
User=flytower
Group=flytower
UMask=0007
EnvironmentFile=$env_file
WorkingDirectory=$STATE_DIR
ExecStart=$PREFIX/current/bin/bun $PREFIX/current/panel/server/index.mjs
Restart=always
RestartSec=2
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ReadWritePaths=$STATE_DIR $SERVERS_DIR

[Install]
WantedBy=multi-user.target
EOF

cat >"$SYSTEMD_DIR/flytower-mc.slice" <<'EOF'
# Managed by Flytower. Every Minecraft server runs in this slice.
[Unit]
Description=Flytower Minecraft servers

[Slice]
MemoryAccounting=yes
CPUAccounting=yes
EOF

systemctl daemon-reload
systemctl enable --quiet flytower-agent.service flytower-panel.service
systemctl restart flytower-agent.service
systemctl restart flytower-panel.service

# ---------------------------------------------------------------- caddy

if [[ $with_caddy -eq 1 ]]; then
  if ! command -v caddy >/dev/null; then
    say "Installing Caddy"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https gnupg >/dev/null
    curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' |
      gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      >/etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy >/dev/null
  fi
  caddyfile=/etc/caddy/Caddyfile
  if [[ -f "$caddyfile" ]] && ! grep -q '^# Managed by Flytower' "$caddyfile" &&
    grep -vE '^\s*(#|$)' "$caddyfile" | grep -vqE '^\s*(:80 \{|root \* /usr/share/caddy|file_server|\})\s*$'; then
    die "$caddyfile has your own changes. Add this block to it, re-run with --no-caddy, and reload Caddy:
    $domain {
      reverse_proxy 127.0.0.1:$PANEL_PORT
    }"
  fi
  cat >"$caddyfile" <<EOF
# Managed by Flytower. Re-running the installer rewrites this file.
$domain {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$PANEL_PORT
}
EOF
  systemctl reload-or-restart caddy
fi

# ---------------------------------------------------------------- firewall

if [[ $with_firewall -eq 1 ]]; then
  if ! command -v ufw >/dev/null; then
    apt-get install -y -qq ufw >/dev/null
  fi
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp comment 'flytower https redirect' >/dev/null
  ufw allow 443/tcp comment 'flytower panel' >/dev/null
  ufw --force enable >/dev/null
fi

# ---------------------------------------------------------------- setup token

if [[ -z "$setup_token" ]]; then
  # 20 characters from an alphabet without look-alikes.
  setup_token="$(tr -dc 'ABCDEFGHJKMNPQRSTVWXYZ23456789' </dev/urandom | head -c 20)"
fi
FLYTOWER_TOKEN="$setup_token" "$bun" -e \
  "await Bun.write('$STATE_DIR/setup-token.hash', await Bun.password.hash(process.env.FLYTOWER_TOKEN, 'argon2id'))"
chown flytower:flytower "$STATE_DIR/setup-token.hash"
chmod 0600 "$STATE_DIR/setup-token.hash"
# The panel picks the token up at boot.
systemctl restart flytower-panel.service

# ---------------------------------------------------------------- done

say "Waiting for the panel"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PANEL_PORT/api/health" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "http://127.0.0.1:$PANEL_PORT/api/health" >/dev/null ||
  die "the panel didn't start; see: journalctl -u flytower-panel -n 50"

cat <<EOF

  Flytower $version is installed.

  Open        https://$domain
  Setup token $setup_token

  The token works once, within 24 hours. If you've already finished setup, ignore it.
  Lost it? Run this installer again for a new one.

EOF
