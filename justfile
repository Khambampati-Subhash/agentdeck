# AgentDeck: both halves. Each half keeps its own justfile (`app/`, `core/`).
set shell := ["bash", "-cu"]
export PATH := env_var("HOME") + "/.local/bin:" + env_var("PATH")

dev_root := "/var/tmp/agentdeck-dev"

default:
    @just --list

# Ghostty submodules, after a clone.
init:
    git submodule update --init --depth 1

build:
    cd core && cargo build --locked
    cd app && cargo build --locked

# The first core run after a rebuild can time out on macOS (first-launch scan): rerun before debugging.
test:
    cd core && cargo test --locked --no-fail-fast
    cd app && cargo test --locked

# AgentDeck and stock Herdr side by side, in a sandbox (P2 done-when).
side-by-side:
    scripts/side-by-side

# Fails if shipped code names herdr.dev (see scripts/offline-allow.txt).
offline:
    scripts/check-offline

# Our own scripts' tests.
scripts:
    python3 -I -B -m unittest discover -s scripts -p 'test_*.py'

# The offline guard, our scripts, core's own fmt, cargo-deny, clippy (Unix and Windows) and suite, the app's mod tests (Bun) and suite.
check: offline scripts
    cd core && just check
    cd app && just test
    cd app && just docs-check

# Opens our build in a scratch home and core session, never the real Herdr setup.
dev: build
    mkdir -p {{dev_root}}/app
    test -f {{dev_root}}/app/settings.json || printf '{ "core": "%s" }\n' "$PWD/core/target/debug/agentdeck-core" > {{dev_root}}/app/settings.json
    cd {{dev_root}} && AGENTDECK_HOME={{dev_root}}/app ADK_SESSION=adk-dev "{{justfile_directory()}}/app/target/debug/agentdeck"

# Builds a release and installs ~/Applications/AgentDeck.app, plus agentdeck and adk in ~/.local/bin.
install *args:
    scripts/install-mac-app {{args}}

# Copies settings from the AgentOS install into ~/.config/agentdeck (asks first).
migrate *args:
    scripts/migrate-agentos {{args}}

# Talk to the dev core: `just adk ls`.
adk *args:
    ADK_SESSION=adk-dev core/target/debug/agentdeck-core {{args}}

# Stops the dev core (its terminals end) and removes the scratch home.
dev-clean:
    -ADK_SESSION=adk-dev core/target/debug/agentdeck-core server stop
    rm -rf {{dev_root}}

# Prints the version from VERSION.
version:
    @cat VERSION

# Creates an annotated release tag locally (refuses unless on a clean main that equals origin/main).
tag:
    #!/usr/bin/env bash
    set -euo pipefail
    BRANCH=$(git rev-parse --abbrev-ref HEAD)
    if [[ "$BRANCH" != "main" ]]; then
        echo "Error: must be on main branch (currently on $BRANCH)" >&2
        exit 1
    fi
    if [[ -n "$(git status --porcelain)" ]]; then
        echo "Error: working tree is not clean" >&2
        exit 1
    fi
    git fetch origin main
    if [[ "$(git rev-parse main)" != "$(git rev-parse origin/main)" ]]; then
        echo "Error: local main differs from origin/main (pull or push first)" >&2
        exit 1
    fi
    VERSION=$(cat VERSION)
    TAG="agentdeck-v$VERSION"
    scripts/release-check "$TAG"
    git tag -a "$TAG" -m "Release $TAG"
    echo "Created tag $TAG (not pushed)"
