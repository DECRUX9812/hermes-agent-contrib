#!/bin/bash
# rebase-drill.sh: throwaway rebase of overlay/core-patches onto the latest upstream (Nous) main.
#
# Read-only toward everything that matters:
#   - works in a fresh temp clone under ~/Code/drill/tmp.*, deleted on exit
#   - the temp clone has NO push URL (every remote's pushurl is "DISABLED-drill")
#   - never cds into, fetches into, or writes to ~/Code/hermes-overlay-core or any live checkout
#     (budget.sh is only run with an explicit ref, and only reads)
# Records per-commit conflicts and timing, then appends a report to ~/Code/drill/DRILL-LOG.md.
# Conflicts are "resolved" by taking the patch side, purely so later commits can be measured.
set -uo pipefail

DRILL=${DRILL:-$HOME/Code/drill}
MIRROR=${MIRROR:-$DRILL/hermes-nous-mirror.git}
FORK_URL=${FORK_URL:-https://github.com/DECRUX9812/hermes-agent-contrib.git}
PATCH_REF=${PATCH_REF:-overlay/core-patches}
LOG=${LOG:-$DRILL/DRILL-LOG.md}
BUDGET=${BUDGET:-$HOME/Code/repair-work/budget.sh}
MIN_FREE_GB=${MIN_FREE_GB:-20}

[ "$(id -u)" = 0 ] && { echo "do not run as root" >&2; exit 2; }
renice -n 19 $$ >/dev/null 2>&1; ionice -c3 -p $$ >/dev/null 2>&1
free_gb=$(df -BG --output=avail "$DRILL" | tail -1 | tr -dc 0-9)
[ "$free_gb" -lt "$MIN_FREE_GB" ] && { echo "only ${free_gb}G free (< ${MIN_FREE_GB}G); stopping" >&2; exit 3; }
[ -d "$MIRROR" ] || { echo "no mirror at $MIRROR" >&2; exit 4; }

now_ms() { local e=${EPOCHREALTIME/[.,]/}; echo $(( 10#$e / 1000 )); }  # bash clock; date +%s%3N gave negative deltas
T0=$(now_ms)
STAMP=$(date '+%Y-%m-%d %H:%M %Z')

# 1. Refresh the mirror (fetch only; a mirror never pushes from here).
git -C "$MIRROR" config remote.origin.pushurl DISABLED-drill
t=$(now_ms)
if [ "${DRILL_FETCH:-1}" = 1 ]; then git -C "$MIRROR" fetch -q --prune origin 2>&1 | tail -3
else echo "mirror refresh skipped (DRILL_FETCH=0)" >&2; fi
T_FETCH=$(( $(now_ms) - t ))

WORK=$(mktemp -d "$DRILL/tmp.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
cd "$WORK" || exit 5

# 2. Temp clone sharing the mirror's objects; disable every push URL.
git clone -q --shared --no-checkout "$MIRROR" repo && cd repo || exit 6
git config remote.origin.pushurl DISABLED-drill
git config user.name drill; git config user.email drill@localhost
git config rerere.enabled false
t=$(now_ms)
git fetch -q "$FORK_URL" "+refs/heads/$PATCH_REF:refs/drill/patches" || { echo "fetch of $PATCH_REF failed" >&2; exit 7; }
git config remote.origin.pushurl DISABLED-drill
T_PFETCH=$(( $(now_ms) - t ))

UP=$(git rev-parse --verify -q refs/remotes/origin/main) || { echo "no main in mirror" >&2; exit 8; }
PATCHES=$(git rev-parse refs/drill/patches)
BASE=$(git merge-base "$UP" "$PATCHES")
N_UP=$(git rev-list --count "$BASE..$UP")
mapfile -t COMMITS < <(git rev-list --reverse --no-merges "$BASE..$PATCHES")

git checkout -q -b drill "$UP" || exit 8

ROWS=""; CLEAN=0; CONFL=0; TOTAL_FILES=0; EMPTY=0; declare -A HOT=()
for c in "${COMMITS[@]}"; do
  subj=$(git log -1 --format=%s "$c" | cut -c1-80 | tr '|' '/')
  t=$(now_ms)
  if git cherry-pick --allow-empty --keep-redundant-commits -x "$c" >/dev/null 2>&1; then
    ms=$(( $(now_ms) - t )); CLEAN=$((CLEAN+1))
    ROWS+="| ${c:0:10} | $subj | clean | | $ms |"$'\n'
    continue
  fi
  mapfile -t U < <(git diff --name-only --diff-filter=U)
  for f in "${U[@]}"; do
    HOT[$f]=$(( ${HOT[$f]:-0} + 1 ))
    if git cat-file -e ":3:$f" 2>/dev/null; then git checkout -q --theirs -- "$f" && git add -- "$f"; else git rm -q -- "$f"; fi
  done
  if ! git -c core.editor=true cherry-pick --continue >/dev/null 2>&1; then
    git commit -q --allow-empty -C "$c" >/dev/null 2>&1 || { git cherry-pick --skip >/dev/null 2>&1; EMPTY=$((EMPTY+1)); }
  fi
  ms=$(( $(now_ms) - t )); CONFL=$((CONFL+1)); TOTAL_FILES=$((TOTAL_FILES+${#U[@]}))
  ROWS+="| ${c:0:10} | $subj | **${#U[@]} conflicted** | $(printf '%s ' "${U[@]}" | sed 's/ $//') | $ms |"$'\n'
done
RESULT=$(git rev-parse HEAD)
T_ALL=$(( $(now_ms) - T0 ))

budget_awk='{a=$1;d=$2;f=$3; c="other"
 if (f ~ /^tests\// && f ~ /\.py$/) c="pytests";
 else if (f ~ /\.py$/) c="pycore";
 else if (f ~ /^apps\/desktop\// && f ~ /i18n|locales/) c="i18n";
 else if (f ~ /^apps\/desktop\// && f ~ /\.test\.|__tests__|\/test\//) c="dtests";
 else if (f ~ /^apps\/desktop\//) c="desktop";
 n[c]++; A[c]+=a; D[c]+=d}
END{for (c in n) printf "%-8s %3d files +%d/-%d\n", c, n[c], A[c], D[c]}'
DRILL_BUDGET=$(git diff --numstat "$UP" "$RESULT" | awk "$budget_awk" | sort)
# budget.sh reads ~/Code/hermes-overlay-core (read-only) and needs the patch SHA there; never fetch into it.
if [ -x "$BUDGET" ] && git -C "$HOME/Code/hermes-overlay-core" cat-file -e "$PATCHES^{commit}" 2>/dev/null; then
  LIVE_BUDGET="$("$BUDGET" "$PATCHES" 2>&1)"; LIVE_SRC="budget.sh ${PATCHES:0:10}"
else
  LIVE_BUDGET=$(git diff --numstat "$BASE" "$PATCHES" | awk "$budget_awk" | sort); LIVE_SRC="budget.sh rules, computed in the drill clone (SHA not in hermes-overlay-core yet)"
fi

{
  echo
  echo "## Drill $STAMP"
  echo
  echo "- upstream main: \`${UP:0:10}\` ($N_UP commits past the patch base \`${BASE:0:10}\`)"
  echo "- patches: \`${PATCHES:0:10}\` ($PATCH_REF, ${#COMMITS[@]} commits)"
  echo "- result: $CLEAN clean, $CONFL conflicted ($TOTAL_FILES conflicted file-hits), $EMPTY dropped as empty"
  echo "- timing: total ${T_ALL} ms (mirror fetch ${T_FETCH} ms, patch fetch ${T_PFETCH} ms)"
  echo
  echo "| commit | subject | outcome | files | ms |"
  echo "|---|---|---|---|---|"
  printf '%s' "$ROWS"
  if [ ${#HOT[@]} -gt 0 ]; then
    echo; echo "Conflict hot spots (file: commits):"; echo
    for f in "${!HOT[@]}"; do echo "- \`$f\`: ${HOT[$f]}"; done | sort -t: -k2 -rn
  fi
  echo; echo "Patch budget after the drill rebase (vs new upstream main):"; echo; echo '```'; echo "$DRILL_BUDGET"; echo '```'
  echo; echo "Patch budget today, vs the current base \`${BASE:0:10}\` ($LIVE_SRC):"; echo; echo '```'; echo "$LIVE_BUDGET"; echo '```'
} >> "$LOG"
echo "drill done: $CLEAN clean / $CONFL conflicted / ${T_ALL} ms -> $LOG"
