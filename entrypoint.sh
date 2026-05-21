#!/bin/sh
set -e

# Create data directory if it doesn't exist.
mkdir -p "${DB_DIR:-/data}"

# Prepare providers: copy to a writable temp directory and install
# dependencies if a package.json is present. The original /providers
# volume stays read-only — all writes go to /tmp/providers.
PROVIDERS_SRC="${PROVIDERS:-}"
if [ -n "${PROVIDERS_SRC}" ] && [ -d "${PROVIDERS_SRC}" ]; then
    PROVIDERS_WORK="/tmp/providers"
    rm -rf "${PROVIDERS_WORK}"
    cp -r "${PROVIDERS_SRC}" "${PROVIDERS_WORK}"

    if [ -f "${PROVIDERS_WORK}/package.json" ]; then
        echo "[anybill] Installing provider dependencies..."
        cd "${PROVIDERS_WORK}"

        if [ -f "pnpm-lock.yaml" ]; then
            pnpm install --prod --frozen-lockfile --ignore-scripts
        elif [ -f "yarn.lock" ]; then
            yarn install --production --frozen-lockfile
        else
            npm install --omit=dev --no-audit --no-fund
        fi

        cd /app
        echo "[anybill] Provider dependencies installed."
    fi

    export PROVIDERS="${PROVIDERS_WORK}"
fi

# Start Caddy in the background.
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &

# Start the backend (foreground).
exec node dist/index.js
