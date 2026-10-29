#!/usr/bin/env bash
# sync-deploy.sh — one-button deploy workflow for desktop.decruxtech.com
#
#   scripts/sync-deploy.sh status            # what's live right now
#   scripts/sync-deploy.sh ship              # build + test + deploy current branch fixes
#   scripts/sync-deploy.sh update-upstream   # pull nous main safely (staging first, only lands if green)
#
# Topology: Cloudflare tunnel -> 127.0.0.1:9120 -> systemd user service
# hermes-gateway-6e0ae5f8 running `hermes gateway run` from THIS worktree,
# serving apps/desktop/dist-webapp. HERMES_HOME=/home/decrux/.hermes-webapp.
#
# The deploy branch is overlay/core-patches. Every fix branch must be created
# FROM it, so fixes merge or cherry-pick cleanly — never branch off raw
# upstream/main for work that should reach the site.
set -euo pipefail

REPO=/home/decrux/Code/hermes-overlay-core
DEPLOY_BRANCH=overlay/core-patches
SERVICE=hermes-gateway-6e0ae5f8.service
SITE_URL=https://desktop.decruxtech.com
LOCAL_URL=http://127.0.0.1:9120
STAGE_PREFIX=deploy-staging
STAGE_ROOT=/tmp/hermes-deploy-stage

die() { echo "ABORT: $*" >&2; exit 1; }
say() { echo; echo "==> $*"; }

upstream_remote() {
  git -C "$REPO" remote | grep -qx upstream && echo upstream || echo origin
}

need_deploy_branch() {
  local cur
  cur=$(git -C "$REPO" branch --show-current)
  [ "$cur" = "$DEPLOY_BRANCH" ] || die "deploy worktree is on '$cur', expected '$DEPLOY_BRANCH'"
  [ ! -d "$REPO/.git" ] || true
  git -C "$REPO" merge-head >/dev/null 2>&1 && die "a merge is in progress in $REPO — finish or abort it first"
  if [ -n "$(git -C "$REPO" status --porcelain --untracked-files=no)" ]; then
    die "deploy worktree has uncommitted tracked changes — commit or stash them first"
  fi
}

gate() { # run inside a checkout dir: typecheck + ui tests
  local dir=$1
  say "Gate: typecheck"
  (cd "$dir/apps/desktop" && npm run typecheck)
  say "Gate: vitest ui"
  (cd "$dir/apps/desktop" && npm run test:ui)
}

build_and_reload() {
  say "Building web bundle"
  (cd "$REPO/apps/desktop" && npm run build:webapp)
  say "Restarting $SERVICE"
  systemctl --user restart "$SERVICE"
  sleep 4
  if curl -sf -o /dev/null --max-time 10 "$LOCAL_URL/" ; then
    echo "Local backend answering on $LOCAL_URL"
  else
    die "$LOCAL_URL did not answer after restart — deploy NOT live. Check: journalctl --user -u $SERVICE -n 40"
  fi
  echo "Live site: $SITE_URL"
}

cmd_status() {
  echo "Branch : $(git -C "$REPO" branch --show-current) @ $(git -C "$REPO" rev-parse --short HEAD)"
  echo "Service: $(systemctl --user is-active "$SERVICE" 2>/dev/null || echo unknown) ($SERVICE)"
  echo -n "Local  : "; curl -sf -o /dev/null --max-time 5 -w "up (HTTP %{http_code})\n" "$LOCAL_URL/" || echo "DOWN"
  echo -n "Site   : "; curl -sf -o /dev/null --max-time 10 -w "up (HTTP %{http_code})\n" "$SITE_URL/" || echo "unreachable"
  echo "Drift  : $(git -C "$REPO" rev-list --count --left-right "$(upstream_remote)/main...$DEPLOY_BRANCH" | awk '{print "behind upstream "$1", ahead "$2}')"
}

cmd_ship() {
  need_deploy_branch
  gate "$REPO"
  build_and_reload
  say "Shipped. $SITE_URL is live on $(git -C "$REPO" rev-parse --short HEAD)"
}

cmd_update_upstream() {
  need_deploy_branch
  local remote stage tmp
  remote=$(upstream_remote)
  stage="$STAGE_PREFIX-$(date +%Y%m%d-%H%M)"
  tmp="$STAGE_ROOT-$stage"

  say "Fetching $remote/main"
  git -C "$REPO" fetch "$remote" main

  say "Staging upstream + our commits in $tmp"
  git -C "$REPO" worktree add --detach "$tmp" "$remote/main"
  git -C "$tmp" switch -c "$stage"

  if ! git -C "$tmp" merge --no-edit "$DEPLOY_BRANCH"; then
    echo
    echo "Merge conflicts — upstream moved under us. Staging left at $tmp"
    echo "Resolve there, re-run the gates, then: git -C $REPO merge --ff-only $stage"
    exit 1
  fi

  say "Installing deps in staging"
  (cd "$tmp" && npm install --no-audit --no-fund)

  if ! gate "$tmp"; then
    echo
    echo "Upstream broke the build — deploy branch untouched. Staging kept at $tmp for inspection."
    exit 1
  fi

  say "Green — fast-forwarding $DEPLOY_BRANCH"
  git -C "$REPO" merge --ff-only "$stage"
  git -C "$REPO" worktree remove "$tmp" --force
  git -C "$REPO" branch -D "$stage" >/dev/null

  build_and_reload
  say "Updated and live on $(git -C "$REPO" rev-parse --short HEAD)"
}

case "${1:-}" in
  ship)            cmd_ship ;;
  update-upstream) cmd_update_upstream ;;
  status)          cmd_status ;;
  *) echo "usage: $0 {ship|update-upstream|status}" >&2; exit 2 ;;
esac
