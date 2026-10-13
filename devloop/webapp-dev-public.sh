#!/usr/bin/env bash
# Same dev server as webapp-dev.sh, but reachable at https://dev.decruxtech.com
# through the existing Cloudflare tunnel (ingress: dev.decruxtech.com ->
# http://127.0.0.1:5174 in ~/.cloudflared/config.yml).
#
# HERMES_DEV_PUBLIC_HOST switches HMR to wss/443 and whitelists the hostname, so
# the socket survives the Cloudflare hop. The URL is behind the same dashboard
# auth gate as desktop.decruxtech.com: sign in once at
# https://dev.decruxtech.com/login
set -euo pipefail

export HERMES_DEV_PUBLIC_HOST="${HERMES_DEV_PUBLIC_HOST:-dev.decruxtech.com}"

exec "$(dirname "${BASH_SOURCE[0]}")/webapp-dev.sh"
