#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
: "${CI:?release integrations require an isolated CI runner}"
: "${CHROME_PATH:?install Chromium and set CHROME_PATH}"
: "${E2EE_TEST_DATABASE_NAME:?set the disposable database name}"
case "$E2EE_TEST_DATABASE_NAME" in
    meowcord_release_ci) ;;
    *) echo "refusing an unrecognized database name" >&2; exit 1 ;;
esac
PORT="${PORT:-3001}"
export PORT
existing=$(psql postgres -Atc "SELECT 1 FROM pg_database WHERE datname = '$E2EE_TEST_DATABASE_NAME'")
[ -z "$existing" ] || { echo "refusing existing release database" >&2; exit 1; }
for file in .env* config.json; do
    [ -e "$file" ] || [ -L "$file" ] || continue
    [ "$file" = .env.example ] && continue
    echo "refusing existing runtime configuration: $file" >&2
    exit 1
done
server_pid=""
database_owned=0
cleanup() {
    trap - EXIT INT TERM
    if [ -n "$server_pid" ]; then
        kill "$server_pid" 2>/dev/null || true
        for attempt in $(seq 1 30); do
            kill -0 "$server_pid" 2>/dev/null || break
            sleep 1
        done
        if kill -0 "$server_pid" 2>/dev/null; then
            kill -KILL "$server_pid" 2>/dev/null || true
        fi
        wait "$server_pid" 2>/dev/null || true
    fi
    if [ "$database_owned" = 1 ]; then
        dropdb --if-exists --force "$E2EE_TEST_DATABASE_NAME"
    fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
database_owned=1
scripts/dev/worktree-setup.sh "$PORT" "$E2EE_TEST_DATABASE_NAME"
server_pid=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN)
[ -n "$server_pid" ]
bun -e 'const path="config.json"; const config=await Bun.file(path).json(); config.externalRequests={thirdParty:true,discordGames:true,discordAssetFallback:true}; await Bun.write(path,JSON.stringify(config));'
kill "$server_pid"
stopped=0
for attempt in $(seq 1 30); do
    if ! kill -0 "$server_pid" 2>/dev/null; then stopped=1; break; fi
    sleep 1
done
[ "$stopped" = 1 ]
bun dist/bundle/start.js > server.log 2>&1 &
server_pid=$!
ready=0
for attempt in $(seq 1 60); do
    kill -0 "$server_pid"
    if curl -sf --max-time 1 "http://localhost:$PORT/readyz" >/dev/null; then ready=1; break; fi
    sleep 1
done
[ "$ready" = 1 ]
psql "$E2EE_TEST_DATABASE_NAME" -c 'DELETE FROM rate_limits'
bun scripts/dev/parity-probe.mjs
psql "$E2EE_TEST_DATABASE_NAME" -c 'DELETE FROM rate_limits'
bun scripts/dev/e2ee-test.mjs
psql "$E2EE_TEST_DATABASE_NAME" -c 'DELETE FROM rate_limits'
bun scripts/dev/voice-probe.mjs --browser "$CHROME_PATH"
