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

# The offline guard, core's own fmt, cargo-deny, clippy (Unix and Windows) and suite, the app suite.
check: offline
    cd core && just check
    cd app && cargo test --locked

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
