#!/usr/bin/env bash
# Hot-reload dev server for the browser-hosted Desktop ("Webapp") surface.
#
#   devloop/webapp-dev.sh                 # 127.0.0.1:5174, real backend on :9129
#   HERMES_DEV_PORT=5175 devloop/webapp-dev.sh
#   HERMES_DEV_NO_REACT_COMPILER=1 devloop/webapp-dev.sh   # faster cold start
#   HERMES_DEV_PUBLIC_HOST=dev.decruxtech.com devloop/webapp-dev.sh
#        ^ only when the tunnel has an ingress for that hostname; switches HMR to
#          wss/443 so the socket survives the Cloudflare hop.
#
# The first page load transforms ~1.5k modules (React Compiler babel pass), so
# expect tens of seconds once. Every save after that is sub-second HMR.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

exec "$REPO/node_modules/.bin/vite" --config "$REPO/devloop/webapp-dev.config.ts" --configLoader runner
