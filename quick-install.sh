#!/usr/bin/env bash
# Turnkey 1-Command Installer for Hermes Plus Overlay
# Stacks easily on top of any stock Hermes installation (~/.hermes or ~/.hermes-webapp)
set -euo pipefail

BOLD="\033[1m"
GREEN="\033[32m"
CYAN="\033[36m"
YELLOW="\033[33m"
RESET="\033[0m"

echo -e "${BOLD}${CYAN}🐴 Hermes Plus Overlay — Turnkey Installer${RESET}"
echo "=================================================="

# 1. Detect target Hermes Home
TARGET_HOME="${HERMES_HOME:-}"
if [[ -z "$TARGET_HOME" ]]; then
  if [[ -d "$HOME/.hermes-webapp" ]]; then
    TARGET_HOME="$HOME/.hermes-webapp"
  elif [[ -d "$HOME/.hermes" ]]; then
    TARGET_HOME="$HOME/.hermes"
  else
    TARGET_HOME="$HOME/.hermes"
    mkdir -p "$TARGET_HOME"
  fi
fi

echo -e "Target Hermes Home: ${BOLD}${GREEN}$TARGET_HOME${RESET}"

# 2. Run symlink installer with --apply
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo -e "\nApplying overlay symlinks..."
"$HERE/install.sh" --apply "$TARGET_HOME"

# 3. Create plugin directories if missing
mkdir -p "$TARGET_HOME/desktop-plugins" "$TARGET_HOME/plugins" "$TARGET_HOME/skills"

# 4. Verification Check
echo -e "\n${BOLD}Verifying active plugins in $TARGET_HOME/desktop-plugins:${RESET}"
for p in "$TARGET_HOME/desktop-plugins"/*; do
  if [[ -e "$p" ]]; then
    echo -e "  ✅ $(basename "$p") -> $(readlink "$p" || echo "local")"
  fi
done

echo -e "\n${BOLD}${GREEN}🎉 Hermes Plus Overlay successfully stacked on top of Hermes!${RESET}"
echo -e "Your webapp and desktop app now load all overlay plugins dynamically."
