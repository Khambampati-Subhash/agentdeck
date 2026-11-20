#!/bin/sh
# Installs agentdeck-core (adk), or updates it:
#
#   HERDR_RELEASES_URL=<release server> sh install.sh
#
# Into ~/.local/bin/agentdeck-core, with `adk` beside it only if no `adk` exists
# (another program may share the name). An adk that is already there is swapped
# the planned way (adk update --from): running terminals keep running. One
# from a package manager is left to it. HC_VERSION=0.2.0 picks a version;
# HERDR_RELEASES_URL is required: AgentDeck has no release server of its own.
set -eu

releases=${HERDR_RELEASES_URL:-}
bin=${HC_INSTALL_DIR:-$HOME/.local/bin}

say() { printf '%s\n' "$*"; }
fail() { say "adk: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "needs $1"; }
need curl
need tar

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=macos ;;
  *) fail "adk runs on Linux and macOS for now" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x86_64 ;;
  arm64 | aarch64) arch=aarch64 ;;
  *) fail "no build for $(uname -m)" ;;
esac
target="$os-$arch"

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp" "$bin/agentdeck-core.staged"' EXIT

[ -n "$releases" ] || fail "set HERDR_RELEASES_URL to an AgentDeck release server; AgentDeck has no default"
manifest="$releases/core/latest.json"
[ -n "${HC_VERSION:-}" ] && manifest="$releases/core/$HC_VERSION/manifest.json"
curl -fsSL "$manifest" -o "$tmp/manifest.json" || fail "cannot reach $manifest"
# Read without jq: the manifest is flat enough for sed once spaces are gone.
flat=$(tr -d '\n ' < "$tmp/manifest.json")
entry=$(printf '%s' "$flat" | sed -n "s/.*\"$target\":{\([^}]*\)}.*/\1/p")
url=$(printf '%s' "$entry" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')
want=$(printf '%s' "$entry" | sed -n 's/.*"sha256":"\([^"]*\)".*/\1/p')
version=$(printf '%s' "$flat" | sed -n 's/^{"version":"\([^"]*\)".*/\1/p')
[ -n "$url" ] && [ -n "$want" ] || fail "no build for $target in $manifest"

# Tells the release server's download counter a new install from an update;
# the file is the same either way. Only plain URLs on the release server in
# use are marked: one with a query or fragment (a mirror's signed URL) is
# fetched exactly as the manifest gives it.
src=install
if [ -x "$bin/agentdeck-core" ]; then src=update; fi
case $url in
  *[?#]*) download=$url ;;
  "$releases"/*) download="$url?src=$src" ;;
  *) download=$url ;;
esac
curl -fsSL "$download" -o "$tmp/hc.tar.gz" || fail "download failed: $url"
[ "$(sha256 "$tmp/hc.tar.gz")" = "$want" ] || fail "the download is damaged (checksum mismatch); try again"
tar -xzf "$tmp/hc.tar.gz" -C "$tmp"
core=$tmp/agentdeck-core
if ! "$core" --version >/dev/null 2>&1; then
  # A noexec mount under the temp dir fails the check with EACCES, which is
  # not "cannot run here": stage on the destination filesystem and re-check.
  mkdir -p "$bin"
  core=$bin/agentdeck-core.staged
  cp "$tmp/agentdeck-core" "$core" && chmod 755 "$core" || fail "cannot stage adk in $bin"
  "$core" --version >/dev/null 2>&1 || fail "the downloaded adk does not run on this machine"
fi
# App completion must converge even before the first bundled release exists.
if [ "${HC_BUNDLE_ONLY:-0}" = 1 ] && [ ! -x "$tmp/AgentDeck Core.app/Contents/MacOS/agentdeck-core" ]; then
  exit 0
fi
mkdir -p "$bin"

bundle=0
if [ "$os" = macos ] && [ "$(id -u)" != 0 ]; then
  case "$bin" in "$HOME"/*) bundle=1 ;; esac
fi
if [ "$bundle" = 1 ] && [ -x "$tmp/AgentDeck Core.app/Contents/MacOS/agentdeck-core" ]; then
  action=installed
  [ ! -x "$bin/agentdeck-core" ] || action=updated
  bundled="$tmp/AgentDeck Core.app/Contents/MacOS/agentdeck-core"
  if [ "$action" = updated ]; then
    installed=$("$bin/agentdeck-core" --version)
    candidate=$("$bundled" --version)
    awk -v old="$installed" -v new="$candidate" 'BEGIN {
      sub(/^adk /, "", old); sub(/^adk /, "", new)
      split(old, a, /[.-]/); split(new, b, /[.-]/)
      for (i=1; i<=3; i++) { if (a[i]+0 > b[i]+0) exit 1; if (a[i]+0 < b[i]+0) exit 0 }
    }' || fail "$candidate is older than $installed; use adk update --from with --force to downgrade"
  fi
  "$bundled" --hc-install-bundle "$bundled" "$bin/agentdeck-core" || fail "installing AgentDeck Core.app failed"
  # A fresh install must not start a core (especially not a system/root core).
  if [ "$action" = updated ]; then
    "$bin/agentdeck-core" server restart >/dev/null || fail "restarting the core failed"
  fi
  say "adk $version $action as AgentDeck Core.app. Recreate pre-update terminals if macOS privacy access is broken; running terminals were kept."
elif [ -x "$bin/agentdeck-core" ]; then
  # Swapped the planned way, so its terminals keep running.
  "$bin/agentdeck-core" update --from "$core" >/dev/null || fail "updating $bin/agentdeck-core failed (see above)"
  say "adk updated to $version."
else
  cp "$core" "$bin/agentdeck-core.new"
  chmod 755 "$bin/agentdeck-core.new"
  mv -f "$bin/agentdeck-core.new" "$bin/agentdeck-core"
  say "adk $version installed into $bin/agentdeck-core."
fi
if ! command -v adk >/dev/null 2>&1 && [ ! -e "$bin/adk" ]; then
  ln -s agentdeck-core "$bin/adk"
fi

case ":$PATH:" in
  *":$bin:"*) ;;
  *) say "Add $bin to your PATH to use adk." ;;
esac
say "Agents: adk --skill. People: adk --help."
