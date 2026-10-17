# mira-panel service control — production restart tooling.
#
# The server serves the bundle built by `npm run build`; `restart` only
# re-launches the process. After merging code into main, `deploy` is the
# recipe you want. The heavy lifting lives in scripts/restart-service.sh
# (port lookup -> kill -> setsid start -> healthz verify).
#
# Preview deploy from a git worktree: `just restart force` (or pass --force
# to the script) — stop that server before deleting the worktree.

port := env_var_or_default("PORT", "15932")
log := env_var_or_default("XDG_STATE_HOME", env_var("HOME") + "/.local/state") + "/mira-panel/server.log"

default:
    @just --list

# Listener + health of the running service
status:
    @ss -tlnp | grep -E ':{{port}} ' || echo "not listening on :{{port}}"
    @curl -sf -m 2 "http://127.0.0.1:{{port}}/healthz" && echo " <- healthz ok" || echo "healthz FAILED"

# Kill the running server and start a fresh one (no rebuild).
# Append `force` to allow a preview deploy from a git worktree.
restart force="":
    ./scripts/restart-service.sh {{ if force == "" { "" } else { "--force" } }}

# Rebuild the web bundle, then restart — the post-merge deploy
deploy:
    npm run build
    ./scripts/restart-service.sh

# Follow the service log
logs:
    @tail -f "{{log}}"
