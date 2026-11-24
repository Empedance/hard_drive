#!/usr/bin/env bash
# Run every HarDisk project for development.
#
#   ./dev.sh [start]        start backend + all frontends (default)
#   ./dev.sh stop           stop everything started by this script
#   ./dev.sh status         show what is running
#   ./dev.sh start api web  start only some services
#
# Services: api (8080), web (5173), admin (5174), docs (5177),
#           sheets (5178), images (5179), landing (3000)
# Logs: .dev-logs/<service>.log   PIDs: .dev-logs/<service>.pid
# Prerequisites: Java 21+, Node 20+, MySQL running, coude-disk-bakend/.env
# configured (DB_PASSWORD, JWT_SECRET). Nothing secret lives in this script.

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS="$ROOT/.dev-logs"
mkdir -p "$LOGS"

ALL=(api web admin docs sheets images landing)

dir_of()  { case $1 in
  api) echo coude-disk-bakend;; web) echo cloud-disk-frontend;;
  admin) echo cloud-disk-super-admin-frontend;; docs) echo cloud-disk-docs-frontend;;
  sheets) echo cloud-disk-sheets-frontend;; images) echo cloud-disk-images-frontend;;
  landing) echo cloud-disk-landing;; esac; }
port_of() { case $1 in api) echo 8080;; web) echo 5173;; admin) echo 5174;;
  docs) echo 5177;; sheets) echo 5178;; images) echo 5179;; landing) echo 3000;; esac; }

port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

is_running() {
  local pidf="$LOGS/$1.pid"
  [[ -f $pidf ]] && kill -0 "$(cat "$pidf")" 2>/dev/null
}

start_one() {
  local s=$1 d port; d="$ROOT/$(dir_of "$s")"; port=$(port_of "$s")
  if is_running "$s"; then echo "[$s] already running (port $port)"; return; fi
  if port_busy "$port"; then echo "[$s] port $port is already in use by another process; skipping"; return; fi
  if [[ $s == api ]]; then
    [[ -f $d/.env ]] || { echo "[api] $d/.env missing (copy .env.example and set DB_PASSWORD, JWT_SECRET)"; return; }
    (cd "$d" && exec ./mvnw -q spring-boot:run) >"$LOGS/$s.log" 2>&1 &
  else
    [[ -d $d/node_modules ]] || { echo "[$s] installing dependencies..."; (cd "$d" && npm ci) >"$LOGS/$s.install.log" 2>&1 || { echo "[$s] npm ci failed, see $LOGS/$s.install.log"; return; }; }
    [[ -f $d/.env.local || -f $d/.env ]] || [[ ! -f $d/.env.example ]] || cp "$d/.env.example" "$d/.env.local"
    (cd "$d" && exec npm run dev) >"$LOGS/$s.log" 2>&1 &
  fi
  echo $! >"$LOGS/$s.pid"
  echo "[$s] starting on port $port (log: .dev-logs/$s.log)"
}

stop_one() {
  local s=$1 pidf="$LOGS/$1.pid"
  if is_running "$s"; then
    local pid; pid=$(cat "$pidf")
    pkill -P "$pid" 2>/dev/null; kill "$pid" 2>/dev/null
    # children of children (mvn -> java, npm -> vite)
    local p; for p in $(lsof -nP -tiTCP:"$(port_of "$s")" -sTCP:LISTEN 2>/dev/null); do kill "$p" 2>/dev/null; done
    echo "[$s] stopped"
  else
    echo "[$s] not running"
  fi
  rm -f "$pidf"
}

status_one() {
  local s=$1 port; port=$(port_of "$s")
  if port_busy "$port"; then echo "[$s] UP   http://localhost:$port"; else echo "[$s] down (port $port)"; fi
}

cmd=${1:-start}; [[ $# -gt 0 ]] && shift
svcs=("$@"); [[ ${#svcs[@]} -eq 0 ]] && svcs=("${ALL[@]}")
for s in "${svcs[@]}"; do
  [[ " ${ALL[*]} " == *" $s "* ]] || { echo "Unknown service '$s'. Choose from: ${ALL[*]}"; exit 1; }
done

case $cmd in
  start)
    for s in "${svcs[@]}"; do start_one "$s"; done
    echo
    echo "Ctrl+C stops everything started here. (Or run: ./dev.sh stop)"
    trap 'echo; for s in "${svcs[@]}"; do stop_one "$s"; done; exit 0' INT TERM
    while true; do sleep 1; done
    ;;
  stop)   for s in "${svcs[@]}"; do stop_one "$s"; done ;;
  status) for s in "${svcs[@]}"; do status_one "$s"; done ;;
  *) echo "Usage: $0 [start|stop|status] [api web admin docs sheets images landing]"; exit 1 ;;
esac
