#!/usr/bin/env bash
# Symlink overlay contributions into a Hermes home. Dry run unless --apply.
set -euo pipefail

apply=0
if [[ "${1:-}" == "--apply" ]]; then apply=1; shift; fi
home="${1:-$HOME/.hermes-webapp}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[[ -d "$home" ]] || { echo "Hermes home not found: $home" >&2; exit 1; }

link() {  # <source dir> <target dir>
  local src="$1" dst="$2"
  if [[ -L "$dst" ]]; then
    [[ "$(readlink "$dst")" == "$src" ]] && { echo "ok      $dst"; return; }
    echo "relink  $dst -> $src"
    (( apply )) && ln -sfn "$src" "$dst"
  elif [[ -e "$dst" ]]; then
    echo "SKIP    $dst exists and is not an overlay symlink" >&2
  else
    echo "link    $dst -> $src"
    (( apply )) && { mkdir -p "$(dirname "$dst")"; ln -s "$src" "$dst"; }
  fi
  return 0
}

for kind in desktop-plugins plugins skills; do
  [[ -d "$here/$kind" ]] || continue
  for src in "$here/$kind"/*/; do
    [[ -d "$src" ]] || continue
    src="${src%/}"
    link "$src" "$home/$kind/$(basename "$src")"
  done
done

(( apply )) || echo "(dry run: re-run with --apply to make these changes)"
