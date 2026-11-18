#!/bin/sh
# Runs hooks/status the way Claude Code runs a hook (piped stdio, its own
# session, no controlling tty) inside a scratch core, and checks `hc get`.
# Usage: integrations/claude-code/test.sh [path to agentdeck-core]
set -eu
here=$(cd "$(dirname "$0")" && pwd)
hc=${1:-$here/../../core/target/debug/agentdeck-core}
root=$(mktemp -d /var/tmp/agentdeck-claude-test.XXXXXX)
export HOME=$root ADK_SESSION=test HC_SETTLE_MS=0 \
  XDG_RUNTIME_DIR=$root/run XDG_STATE_HOME=$root/state XDG_CONFIG_HOME=$root/config
trap '"$hc" server stop >/dev/null 2>&1 || true; rm -rf "$root"' EXIT
fail=0

# A stand-in for claude: on each line read, runs one hook detached, like Node's spawn.
cat >"$root/fake-claude" <<EOF
#!/usr/bin/env python3
import subprocess, sys
for line in sys.stdin:
    args = line.split()
    subprocess.run(["$here/hooks/status", *args], start_new_session=True,
                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, input=b"{}")
    print("ran", *args, flush=True)
EOF
chmod +x "$root/fake-claude"

"$hc" run --bg --name c -- "$root/fake-claude" >/dev/null

# Sends one hook event and waits for the status it should leave.
check() {
  want=$1; shift
  "$hc" send --force c "$*" >/dev/null
  i=0
  while [ $i -lt 50 ]; do
    got=$("$hc" get c --json | python3 -c 'import json,sys; s=json.load(sys.stdin).get("status"); print(s if isinstance(s,str) else (s or {}).get("state","none") if s else "none")')
    [ "$got" = "$want" ] && { echo "ok   $* -> $want"; return; }
    i=$((i + 1)); sleep 0.1
  done
  echo "FAIL $* -> want $want, got $got"; fail=1
}

check working working
check blocked blocked permission
check done done
check none clear
exit $fail
