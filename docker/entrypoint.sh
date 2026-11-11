#!/bin/sh
set -e
cd /app

case "${1:-server}" in
client)
    mkdir -p /data/client/cache /data/client/cache_compressed
    if [ -f assets/cache/index.html ] && [ "$2" != "--force" ]; then
        echo "[client] using the cached client, run the client service with --force to fetch the current one"
    else
        bun scripts/client.js
    fi
    bun scripts/client-release.js --check
    bun scripts/e2ee-anchors.js
    bun scripts/clan-badges.js || echo "[client] warning: could not extract server tag badges from this client build"
    bun scripts/compress-client.js
    ;;
server)
    if [ ! -f assets/cache/index.html ]; then
        echo "[server] the client cache is empty, start the client service first" >&2
        exit 1
    fi
    bun scripts/client-release.js --check
    bun scripts/e2ee-anchors.js
    bun scripts/docker-configure.js
    cd /data/state
    exec bun /app/dist/bundle/start.js
    ;;
*)
    exec "$@"
    ;;
esac
