#!/bin/bash
# Staged full-mirror build: each stage lands on disk, so a dropped connection loses one stage only.
set -u
cd ~/Code/drill
M=hermes-nous-mirror.git
URL=https://github.com/NousResearch/hermes-agent.git
log(){ echo "$(date '+%H:%M:%S') $*"; }
if [ ! -d $M ]; then git init -q --bare $M && git -C $M remote add --mirror=fetch origin $URL; fi
git -C $M config remote.origin.pushurl DISABLED-drill
git -C $M config http.lowSpeedLimit 1000; git -C $M config http.lowSpeedTime 120
fetch_try(){ for i in 1 2 3 4; do log "stage $1 try $i"; if nice -n 19 ionice -c3 git -C $M fetch --no-tags origin "${@:2}"; then log "stage $1 ok"; return 0; fi; sleep 20; done; log "stage $1 FAILED"; return 1; }
fetch_try main '+refs/heads/main:refs/heads/main' || exit 1
fetch_try heads+tags '+refs/heads/*:refs/heads/*' '+refs/tags/*:refs/tags/*'
fetch_try all-refs   # mirror refspec +refs/*:refs/* (includes refs/pull/*)
log done; du -sh $M
