#!/usr/bin/env bash
# Restart the deployed mira-panel service: stop whoever listens on the port,
# then start a fresh detached server from THIS checkout's packages/server
# and verify /healthz answers.
#
# Refuses to run from a git worktree: a server started there keeps serving
# from a cwd inside .git/wt/... even after the worktree is deleted — the
# 2026-10-15 ghost-process incident. Run from the main checkout, usually
# via `just restart` / `just deploy`.
#
# Env overrides: PORT (default 15932).
set -euo pipefail

PORT="${PORT:-15932}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/mira-panel"
LOG_FILE="$LOG_DIR/server.log"

# A worktree's .git is a file pointing into the main repo's .git/worktrees/.
if [ -f "$ROOT/.git" ]; then
  echo "restart-service: refusing to run from a git worktree ($ROOT)" >&2
  echo "restart-service: the production server must start from the main checkout" >&2
  exit 1
fi

listening() { ss -tln 2>/dev/null | grep -qE ":$PORT "; }

echo "mira-panel restart on port $PORT"

# -- stop ---------------------------------------------------------------
pids="$(ss -tlnp 2>/dev/null | grep -E ":$PORT " | grep -oP 'pid=\K[0-9]+' | sort -u || true)"
if [ -n "$pids" ]; then
  echo "stopping pid(s): $pids"
  # Unquoted on purpose: the word split fans the signal out over the pid list.
  kill $pids 2>/dev/null || true
  for _ in $(seq 1 20); do listening || break; sleep 0.5; done
  if listening; then
    echo "still listening after 10s — escalating to SIGKILL" >&2
    kill -9 $pids 2>/dev/null || true
    sleep 1
  fi
else
  echo "no running listener on :$PORT"
fi

# -- start --------------------------------------------------------------
mkdir -p "$LOG_DIR"
cd "$ROOT/packages/server"
setsid nohup npm start >>"$LOG_FILE" 2>&1 &
echo "started (launcher pid $!) — log: $LOG_FILE"

# -- verify -------------------------------------------------------------
for _ in $(seq 1 20); do
  if curl -sf -m 2 "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
    echo "healthz: ok"
    tail -n 2 "$LOG_FILE"
    exit 0
  fi
  sleep 0.5
done

echo "restart FAILED — /healthz did not answer within 10s; last log lines:" >&2
tail -n 20 "$LOG_FILE" >&2
exit 1
