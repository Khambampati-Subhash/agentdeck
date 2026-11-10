# AgentOS: both halves. Each half keeps its own justfile (`app/`, `core/`).
set shell := ["bash", "-cu"]
export PATH := env_var("HOME") + "/.local/bin:" + env_var("PATH")

dev_root := "/var/tmp/agentos-dev"

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

# Core's own fmt, cargo-deny, clippy (Unix and Windows) and suite.
check:
    cd core && just check
    cd app && cargo test --locked

# Opens our build in a scratch home and core session, never the real Herdr setup.
dev: build
    mkdir -p {{dev_root}}/app
    test -f {{dev_root}}/app/settings.json || printf '{ "core": "%s" }\n' "$PWD/core/target/debug/herdr-core" > {{dev_root}}/app/settings.json
    cd {{dev_root}} && HERDR_APP_HOME={{dev_root}}/app HC_SESSION=aos "{{justfile_directory()}}/app/target/debug/herdr-app"

# Talk to the dev core: `just hc ls`.
hc *args:
    HC_SESSION=aos core/target/debug/herdr-core {{args}}

# Stops the dev core (its terminals end) and removes the scratch home.
dev-clean:
    -HC_SESSION=aos core/target/debug/herdr-core server stop
    rm -rf {{dev_root}}
