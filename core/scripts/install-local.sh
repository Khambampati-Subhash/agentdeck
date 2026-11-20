#!/bin/sh
# Builds a release binary into ~/.local/bin (replacing any older one), then
# restarts the core the planned way so running terminals pick up the new build
# (never handing this shell's environment to a core it has to start).
set -eu
cd "$(dirname "$0")/.."
nice -n 10 cargo build --release
bin="${HC_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$bin"
if [ "$(uname -s)" = Darwin ]; then
  app="target/release/AgentDeck Core.app"
  rm -rf "$app"
  sh scripts/mac-bundle target/release/agentdeck-core "$app"
  bash scripts/mac-sign "$app"
  "$app/Contents/MacOS/agentdeck-core" --hc-install-bundle "$app/Contents/MacOS/agentdeck-core" "$bin/agentdeck-core"
else
  install -m 755 target/release/agentdeck-core "$bin/agentdeck-core.new"
  mv -f "$bin/agentdeck-core.new" "$bin/agentdeck-core"
fi
[ -e "$bin/adk" ] || [ -L "$bin/adk" ] || ln -s agentdeck-core "$bin/adk"
sh scripts/restart-core.sh "$bin/agentdeck-core"
