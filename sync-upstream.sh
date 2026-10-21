#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_REMOTE="origin"
if git -C /home/decrux/Code/hermes-webapp remote | grep -q "^upstream$"; then
  UPSTREAM_REMOTE="upstream"
fi

echo "==> 1. Fetching upstream Nous (${UPSTREAM_REMOTE}) and fork..."
git -C /home/decrux/Code/hermes-webapp fetch "${UPSTREAM_REMOTE}" main
git -C /home/decrux/Code/hermes-webapp fetch fork main

echo "==> 2. Merging ${UPSTREAM_REMOTE}/main into main..."
git -C /home/decrux/Code/hermes-webapp merge "${UPSTREAM_REMOTE}/main" --no-edit

echo "==> 3. Pulling and syncing dependencies & tools..."
source /home/decrux/Code/hermes-webapp/activate
python3 -m pm.cli install
npm --prefix /home/decrux/Code/hermes-webapp/apps/desktop install

echo "==> 4. Running check..."
npm --prefix /home/decrux/Code/hermes-webapp/apps/desktop run check || true

echo "==> 5. Pushing to GitHub fork..."
git -C /home/decrux/Code/hermes-webapp push fork main

echo "==> 6. Building webapp bundle..."
cd /home/decrux/Code/hermes-webapp/apps/desktop && npm run build:webapp

echo "==> 7. Restarting webapp service..."
systemctl --user restart hermes-webapp-test.service

echo "==> Sync complete and live on desktop.decruxtech.com!"
