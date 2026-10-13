#!/usr/bin/env bash
# Isolated dev-loop environment for apps/desktop. Does NOT touch the live
# gateway (:9119) or webapp (:9129), nor the packaged app at /opt/hermes-desktop.
export REPO=/home/decrux/.hermes/hermes-agent
export D=/home/decrux/.hermes/cache/scratch/hermes-webapp/devloop/sandbox
export DISPLAY=:103
export HERMES_HOME=$D/.hermes
export HERMES_DESKTOP_USER_DATA_DIR=$D/userdata
export HERMES_DESKTOP_CWD=$D/work
export HERMES_DESKTOP_HERMES_ROOT=$REPO
# NOT $REPO/venv/bin/python — that tree is broken (no pydantic_core) and its
# serve run stalls in the lazy source-update retry loop past the 90s port wait.
export HERMES_DESKTOP_PYTHON=$(ls -d /home/decrux/.hermes/tools/python-3.14.7*/bin/python3 | head -1)
export HERMES_DESKTOP_CDP_PORT=9344
export HERMES_GUEST_ONBOARDING=1
export HERMES_DESKTOP_IGNORE_EXISTING=1
export HERMES_DISABLE_LAZY_INSTALLS=1