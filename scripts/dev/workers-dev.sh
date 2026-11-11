#!/bin/sh
set -e
cd "$(dirname "$0")/../.."
root="$PWD"
port="${1:?usage: workers-dev.sh <port> <db-name>}"
db="${2:?usage: workers-dev.sh <port> <db-name>}"
case "$port" in
    ""|0*|*[!0-9]*) echo "use a port from 1 through 65000" >&2; exit 1 ;;
esac
case "$db" in
    ""|*[!a-z0-9_]*) echo "use lowercase letters, digits and underscores for the database name" >&2; exit 1 ;;
esac
wrangler="${WRANGLER:-bunx wrangler@4.79.0}"
state="$root/workers/.dev"
mkdir -p "$state"
umask 077

if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "TCP port $port is already occupied" >&2
    exit 1
fi

existing=$(psql --host=localhost --port=5432 --username="$USER" postgres -Atc "SELECT 1 FROM pg_database WHERE datname = '$db'")
if [ -z "$existing" ]; then
    createdb --host=localhost --port=5432 --username="$USER" "$db"
    echo "created database $db"
fi

[ -f dist/api/Server.js ] || bun run build:src >/dev/null
DATABASE="postgres://$USER@localhost:5432/$db" bun dist/apply-migrations.js >"$state/migrations.log" 2>&1 || {
    echo "migrations failed, see $state/migrations.log" >&2
    exit 1
}

if [ ! -f "$state/jwt.key" ]; then
    openssl ecparam -name secp521r1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out "$state/jwt.key"
    openssl ec -in "$state/jwt.key" -pubout -out "$state/jwt.key.pub" 2>/dev/null
fi
[ -f "$state/federation.key" ] || openssl genpkey -algorithm ed25519 -out "$state/federation.key"
[ -f "$state/secrets" ] || printf 'REQUEST_SIGNATURE=%s\nCDN_SIGNATURE_KEY=%s\nEVENT_SECRET=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" >"$state/secrets"
. "$state/secrets"
[ -f "$state/e2ee-recovery.key" ] || openssl rand -hex 32 >"$state/e2ee-recovery.key"

origin="http://localhost:$port"
config=$(cat <<JSON | tr -d '\n '
{
  "general": { "serverName": "$origin" },
  "api": { "endpointPublic": "$origin/api/v9" },
  "cdn": { "endpointPublic": "$origin/", "endpointPrivate": "$origin/" },
  "gateway": { "endpointPublic": "ws://localhost:$port/" },
  "security": { "requestSignature": "$REQUEST_SIGNATURE", "cdnSignatureKey": "$CDN_SIGNATURE_KEY", "captcha": { "blockAutomatedBrowsers": false } },
  "federation": { "announce": false },
  "limits": { "rate": { "routes": { "auth": { "login": { "count": 1000, "window": 60 }, "register": { "count": 1000, "window": 60 } } } } }
}
JSON
)
pem() { awk 'BEGIN { ORS = "\\n" } { print }' "$1"; }
for worker in api gateway router; do
    {
        echo "CONFIG_JSON='$config'"
        echo "EVENT_SECRET=$EVENT_SECRET"
        if [ "$worker" = router ]; then
            echo "REQUEST_SIGNATURE=$REQUEST_SIGNATURE"
            echo "CDN_SIGNATURE_KEY=$CDN_SIGNATURE_KEY"
        else
            echo "JWT_PRIVATE_KEY=\"$(pem "$state/jwt.key")\""
            echo "JWT_PUBLIC_KEY=\"$(pem "$state/jwt.key.pub")\""
        fi
        if [ "$worker" = api ]; then
            echo "FEDERATION_KEY=\"$(pem "$state/federation.key")\""
            echo "E2EE_RECOVERY_MASTER_KEY=$(cat "$state/e2ee-recovery.key")"
        fi
    } >"workers/$worker/.dev.vars"
done

[ -f workers/router/.deploy/public/_meowcord/client.json ] || bun scripts/workers/prepare-assets.mjs
(cd workers/api && bun install --frozen-lockfile >/dev/null && bun build.ts)

echo "starting the router on $origin, database $db, log $state/wrangler.log"
cd workers/api
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgres://$USER:local@localhost:5432/$db" \
    CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=600000 WRANGLER_SEND_METRICS=false \
    $wrangler dev --local --ip 127.0.0.1 --port "$port" --inspector-port "$((port + 9))" --persist-to "$state/state" --show-interactive-dev-session=false \
    -c ../router/wrangler.jsonc -c wrangler.jsonc -c ../gateway/wrangler.jsonc 2>&1 | tee "$state/wrangler.log"
