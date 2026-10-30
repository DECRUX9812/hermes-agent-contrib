# Branch inventory vs HEAD `4064956c37` (2026-10-29)

Method per branch: `git log --oneline HEAD..BRANCH` (count = "not in HEAD"), then `git cherry HEAD BRANCH`
(`+` = patch absent from HEAD, `-` = patch-equivalent already in HEAD). Where patch-ids differed but
subjects matched, HEAD history was grepped for the issue number. For old-base branches,
`git diff --name-only` was scoped to the commit's own files (`git log --format --name-only HEAD..BRANCH`)
and existence in HEAD checked with `git cat-file -e HEAD:<path>`. Mergeability of borderline branches was
probed read-only with `git merge-tree $(git merge-base HEAD B) HEAD B`. No working tree was touched.
HEAD = `vault/bot-mode-refinement` = `overlay/core-patches` = merge of upstream/main `67d47601bc`.

Verdicts: STALE-DUPLICATE (nothing new vs HEAD) · UNIQUE-WORK (patch-absent content, mergeable or new files) ·
DEAD-ANCIENT (old base, content nowhere in HEAD, re-implement — do not merge).

| branch | last commit | date | not in HEAD | patch-equiv? | verdict | key content |
|---|---|---|---|---|---|---|
| b3-toolcards | fcc81cfc28 | 2026-10-26 | 0 | — (ancestor) | STALE-DUPLICATE | tip subject already in HEAD; `rev-list` count 0 |
| b3-toolcards-chain | d577cffb5b | 2026-10-26 | 11 | +11/-0 | UNIQUE-WORK | toolcard sentence-statuses, reachable Review, approval rows, open-page gaps; `tool-cards/model.ts`, `tool-card.tsx`, `approval.tsx` |
| b4-approvals | ccb686ec8e | 2026-10-26 | 0 | — (ancestor) | STALE-DUPLICATE | `rev-list` count 0 |
| b4-approvals-chain | bef7b60c83 | 2026-10-26 | 3 | +3/-0 | UNIQUE-WORK | inline ApprovalCard (s3b), approval anchor/types (s3a); `approval*.tsx`, `approval-journal.ts` |
| b5-toolcard-gaps | 8ca243754d | 2026-10-26 | 1 | +1/-0 | UNIQUE-WORK | WIP parked: tool-card open-page gaps; `tool-card-open-page.tsx` (file absent from HEAD — new) |
| backup/desktop-web-v2-pre-rebase-20261006 | 1bbf81e7be | 2026-10-05 | 4 | not assessed (snapshot) | DEAD-ANCIENT | pre-rebase snapshot (mobile Expo app + browser plugins); base 2026-10-03. Re-implement, do not merge |
| backup/main-before-sync-20261007 | b2f54b2f9a | 2026-10-07 | 1086 | sampled: divergent | DEAD-ANCIENT | pre-sync snapshot; tip `fix(agent): reset retry-loop window`; base 2026-10-06. Re-implement, do not merge |
| backup/polluted-merge | eb0799b826 | 2026-10-01 | 607 | +364/-8 (sampled full cherry) | DEAD-ANCIENT | 768-commit catch-up merge snapshot; base 2026-10-01. Re-implement, do not merge |
| backup/pre-reset-2026-10-21 | c7234ff796 | 2026-10-21 | 1155 | not assessed (snapshot) | DEAD-ANCIENT | uncommitted-checkout snapshot before reset to fork/main; base 2026-10-09. Re-implement, do not merge |
| backup/pre-sync-2026-10-13 | 4e05564517 | 2026-10-13 | 1155 | not assessed (snapshot) | DEAD-ANCIENT | untracked dev-loop snapshot; base 2026-10-09. Re-implement, do not merge |
| bot-mode-2-team-os | 180cc5f253 | 2026-08-23 | 1 | +1/-0 | DEAD-ANCIENT | single Aug-23 Team OS dump (`plugin.js`, `bot_mode_dm.py`); lineage continued in fix/feat-bot-mode-product-closure. Re-implement, do not merge |
| catalog-handflow | 847eac1759 | 2026-09-20 | 1 | +0/-1 | STALE-DUPLICATE | cherry `-`: patch already in HEAD |
| catalog/typesafe-skill-router | 6c46be28b2 | 2026-09-15 | 2 | +0/-2 | STALE-DUPLICATE | both cherry `-` |
| claude/cool-cannon-cx2rw7 | fd16d50fee | 2026-10-11 | 1154 | +792/-10 | DEAD-ANCIENT | consensus voting cards; base 2026-10-09. Re-implement, do not merge |
| deploy/desktop | e62d6f4997 | 2026-10-22 | 1174 | family of main (see DEAD-ANCIENT note) | DEAD-ANCIENT | fork-line snapshot; base 2026-10-20, behind HEAD 3783. Re-implement, do not merge |
| deploy/fork-main | b302cbdf5e | 2026-10-24 | 1185 | +809/-16 | DEAD-ANCIENT | fork-line snapshot (statusbar hide menu, plugin SDK, perf merges, signin redirect); base 2026-10-20, behind 3783. Re-implement; audit tip commits for cherry-pick candidates |
| design/batch-a | 2d0808e02e | 2026-10-26 | 0 | — (ancestor) | STALE-DUPLICATE | `rev-list` count 0 |
| docs/perf-visual | 5179cad676 | 2026-10-27 | 5 | +5/-0 | UNIQUE-WORK | `infographic*.png` + methodology docs only; trivially mergeable |
| factory/3d-pane | 5b9b30240b | 2026-10-06 | 33 | +33/-0, merge-tree CLEAN | UNIQUE-WORK | 3D Pane behaviour + PANE3D.md (base 2026-10-03); probe CLEAN |
| factory/3d-pane-v1 | 6093b46577 | 2026-10-03 | 2 | +2/-0, merge-tree CLEAN | UNIQUE-WORK | squash-merge casualty repair (`electron/main.ts`, ui/*, i18n); probe CLEAN |
| feat/bot-mode-20-teamos-local | fe7ef86523 | 2026-08-23 | 1 | +1/-0 | DEAD-ANCIENT | single Aug-23 Team OS dump (slices 1–7, incl. `venv`); superseded by product-closure lineage. Re-implement, do not merge |
| feat/bot-mode-product-closure | cdc3471047 | 2026-10-27 | 1 | +1/-0, merge-tree CLEAN | UNIQUE-WORK | active-now/needs-you strips, prompt restore, probe coverage; `plugin.js`, `prompts.ts`, `tools/bot_mode_probe.py` (all exist in HEAD, incomparable) |
| feat/bots-product-convergence | 1b4da1c4e6 | 2026-08-23 | 4 | +4/-0 | UNIQUE-WORK | convergence brief + reports + attention-states fix; overlaps fix/bot-mode-attention-truth (same files) — keep one |
| feat/coding-session-registration | 6c40a16f2b | 2026-09-05 | 1 | +1/-0 | UNIQUE-WORK | typed coding-session registration; `process_registry.py`, `terminal_tool*.py`, skill docs |
| feat/desktop-cron-advanced-settings | a731ecf3ce | 2026-09-05 | 1 | +1/-0 | UNIQUE-WORK | cron advanced execution settings parity; `cron-job-model.ts`, `web_server_cron*.py` |
| feat/desktop-inapp-browser-clean | ae8117b2eb | 2026-10-28 | 12 | +12/-0 | UNIQUE-WORK | in-page annotate/draw-on-page, Browser start page, floating-Browser fixes; `preview-annotate-*`, `preview-pane.tsx` |
| feat/desktop-session-switch-perf | 0f4dceae81 | 2026-10-27 | 4 | +0/-4 | STALE-DUPLICATE | all four cherry `-`: already in HEAD |
| feat/desktop-web | e03ccb5396 | 2026-10-03 | 812 | +509/-8 | DEAD-ANCIENT | Oct-01-based desktop-web line (backdrop SDK settings, composer mount, lint); base 2026-10-01. Re-implement, do not merge |
| feat/hermes-next | 3c50ed89ef | 2026-10-15 | 1332 | +910/-11, behind 8655 | DEAD-ANCIENT | merge of next/u3 stack (DESIGN.md sweeps, slash commands, status rows); base 2026-10-13. Re-implement, do not merge |
| feat/inline-visualizations | a460e64c3b | 2026-10-05 | 4 | +4/-0 | UNIQUE-WORK | same bridge SHAs as fix/web-bridge-stubs (36a49dbfb5, a460e64c3b) + claude-mem provider + e2e; redundant sibling — keep one of the three |
| feat/instant-ack | e5ad09b5a6 | 2026-10-26 | 2 | +2/-0 | UNIQUE-WORK | instant-ack feed/store/receipt (`app/chat/instant-ack/` — dir absent from HEAD, all new files) |
| feat/instant-ack-honesty | e5ad09b5a6 | 2026-10-26 | 2 | +2/-0 (same tip SHA as feat/instant-ack) | UNIQUE-WORK | identical tip to feat/instant-ack; redundant pointer — keep one |
| feat/instant-ack-queue | e5ad09b5a6 | 2026-10-26 | 2 | +2/-0 (same tip SHA) | UNIQUE-WORK | identical tip to feat/instant-ack; redundant pointer — keep one |
| feat/skill-usage-key-normalization | 5cf1871317 | 2026-09-05 | 2 | +2/-0 | UNIQUE-WORK | usage-ledger key canonicalization; `tools/skill_usage.py` exists in HEAD, incomparable |
| feat/webapp-desktop-plugin-install | 23ff61033b | 2026-10-28 | 3 | +2/-1 | UNIQUE-WORK | Windows-safe cloned-plugin removal + install_desktop halves; `desktop_plugin_install.py` exists in HEAD |
| fix/105042-neverpushed-lsremote | c153cf88c0 | 2026-09-22 | 1 | +1/-0 BUT touched file absent from HEAD | DEAD-ANCIENT | `electron/update-branch-heal.ts` does NOT exist in HEAD; HEAD f6df13bac6 covers never-pushed branches in source check — likely superseded. Re-implement, do not merge |
| fix/118161-pin-aware-sweep | c76e92fe22 | 2026-09-22 | 1 | +1/-0; no same-issue commit in HEAD | UNIQUE-WORK | orphan sweep spares pinned sessions; `session_reaper.py` exists in HEAD |
| fix/118628-close-tile-monitoring | fc64e60320 | 2026-09-22 | 1 | +1/-0; no same-issue commit in HEAD | UNIQUE-WORK | land interrupted turn's persisted partial; `message-stream.ts` exists in HEAD |
| fix/118738-xai-toolcall-salvage | ab7019fa2a | 2026-09-22 | 1 | +1/-0; no same-issue commit in HEAD | UNIQUE-WORK | salvage xAI tool-call narration; `codex_responses_adapter.py` exists in HEAD |
| fix/118748-reaction-session-scope | 20e54d5f15 | 2026-09-22 | 1 | +1/-0; HEAD grep 118748 hits only an unrelated lint commit | UNIQUE-WORK | scope reaction paints to active session; `desktop-bridge.ts`, `gateway-switch.ts` exist in HEAD |
| fix/118755-reasoning-only-hydrate | 76d4ff382b | 2026-09-22 | 1 | +1/-0 BUT HEAD has 3b5c5cc7fb for same issue (#118755) | UNIQUE-WORK (AMBIGUOUS) | possibly superseded by HEAD `3b5c5cc7fb fix(desktop): keep a reasoning-only stream instead of hydrating over it (#118755)` — diff the two before deciding |
| fix/44580-update-silent-desktop-fail | 7208475b3d | 2026-09-22 | 1 | +1/-0; no same-issue commit in HEAD | UNIQUE-WORK | propagate desktop rebuild failure to exit code; `update_cmd*.py` exist in HEAD |
| fix/bot-mode-attention-truth | 3a4f1a4c5d | 2026-08-23 | 1 | +1/-0 | UNIQUE-WORK | real attention states; `plugin.js`, `sdk/index.ts`, `prompts.ts` — overlaps feat/bots-product-convergence (same files); keep one |
| fix/bot-mode-product-closure | 31d90ad347 | 2026-09-14 | 2 | +2/-0 | UNIQUE-WORK | roster reads shell indexes + seat Bot Chat in Bots workspace; `plugin.js`, `host-state`, `profile-routing` |
| fix/bot-mode-protocol-roster-refresh | 6fbbf1a01f | 2026-09-14 | 2 | +2/-0 | UNIQUE-WORK | capability rebuild refreshes roster; protocol section stops repeating schema; `bot_mode_probe.py`, `conversation_loop.py` |
| fix/bot-mode-visual | 22a2cf6811 | 2026-10-29 | 7 | +1/-5 (1 merge skipped); merge-tree CLEAN | UNIQUE-WORK (partial) | only `6683561600 roster density (bot-row.tsx)` is unique; other 5 commits patch-equiv (already in HEAD) |
| fix/browser-real-profile-password-store-ua | 91e07fa1b2 | 2026-09-25 | 1 | +1/-0 | UNIQUE-WORK | `tools/browser_tool_real_profile.py` absent from HEAD — new-file work, lost if branch deleted |
| fix/context-ollama-gate-muse-spark | cfd7775fc4 | 2026-09-02 | 1 | +1/-0 | UNIQUE-WORK | gate `ollama_num_ctx` to Ollama + muse-spark 1M; `agent_init.py`, `model_metadata.py` exist in HEAD (also present verbatim in local/live-both 29b369f05b — same SHA) |
| fix/desktop-msg-dup | c7fe8502a8 | 2026-10-27 | 0 | — (ancestor) | STALE-DUPLICATE | `rev-list` count 0 |
| fix/desktop-msg-dup-and-scroll | 8309f44fd7 | 2026-10-27 | 1 | +0/-1 | STALE-DUPLICATE | cherry `-`: already in HEAD |
| fix/desktop-new-session-clears-terminal-takeover | 88f93f0363 | 2026-08-06 | 3 | +3/-0 | UNIQUE-WORK | terminal overlay/tab-takeover fixes; `persistent.tsx`, `pane-visibility.ts`, `use-session-actions` |
| fix/desktop-thread-scroll | c7fe8502a8 | 2026-10-27 | 0 | — (ancestor) | STALE-DUPLICATE | same tip SHA as fix/desktop-msg-dup |
| fix/local-runtime-server-extra-flags | d65b144af1 | 2026-09-05 | 2 | +2/-0 | UNIQUE-WORK | `server_extra_args` escape hatch; `local_runtime/*.py`, `config_defaults.py`, `local-models.md` (all exist in HEAD) |
| fix/npm-high-severity-advisories | c687836fec | 2026-08-23 | 1 | +1/-0 | UNIQUE-WORK | dep clearance (`.npmrc`, package files); verify advisories didn't regress before merging |
| fix/remove-opencode-free-tier | 4955e9e261 | 2026-09-18 | 3 | +0/-3 | STALE-DUPLICATE | all cherry `-` |
| fix/restore-upstream-ui-merge | 3f8c053807 | 2026-10-22 | 1175 | +812/-9, family of main | DEAD-ANCIENT | fork-line member; base 2026-10-20. Re-implement, do not merge |
| fix/rollback-diff-truncation-flag | e726330d12 | 2026-09-02 | 1 | +1/-0 | UNIQUE-WORK | `rollback.diff` totalLength flag; `methods_tools.py` exists in HEAD (same SHA also in local/live-both, local/live-20261027 history) |
| fix/statusbar-and-plugin-sdk | cc07241144 | 2026-10-24 | 1183 | +808/-16, family of main | DEAD-ANCIENT | statusbar hide menu + plugin SDK navigate/openSession; base 2026-10-20. Audit tip commits for cherry-pick; do not merge |
| fix/tools-config-warn-unregistered-platform-toolset-88857 | 262a507cbb | 2026-08-24 | 1 | +1/-0 | UNIQUE-WORK | phantom-toolset warning; `tools_config.py` exists in HEAD |
| fix/ui-7-defects | 3ce22642be | 2026-10-28 | 0 | — (ancestor) | STALE-DUPLICATE | `rev-list` count 0 |
| fix/webapp-polish-batch | a54470f8e8 | 2026-10-29 | 2 | +1/-1 | UNIQUE-WORK (partial) | unique: `a54470f8e8 narrowed-filter project join (#146495)`; `9fcf1533cc` patch-equiv (in HEAD) |
| fix/webapp-signin-redirect | 66e2762cc7 | 2026-10-24 | 1181 | +807/-16, family of main | DEAD-ANCIENT | expired-session → sign-in; base 2026-10-20. Audit tip commit for cherry-pick; do not merge |
| fix/web-bridge-stubs | a460e64c3b | 2026-10-05 | 4 | +4/-0 | UNIQUE-WORK | PRIMARY of the bridge trio: bridge wiring + claude-mem provider + e2e; keep this one, treat feat/inline-visualizations + webapp-live as redundant |
| foundry/int-w1-118755 | a352451868 | 2026-09-24 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family: base 2026-09-20, 14 unique patch-ids; Sept WP-01 integration line. Re-implement, do not merge |
| foundry/int-w1-44580 | e726a0d8c5 | 2026-09-24 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family (see note below table) |
| foundry/int-wp01-101939-include-compacted | 512712d65a | 2026-09-24 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/int-wp01-108045-unscoped-pin | dbcb256e5c | 2026-09-24 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/int-wp01-108601-watchdog-flush | 22c4b6be4d | 2026-09-24 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/int-wp01-117867-held-gate-completion-flush | fb0118fddc | 2026-09-24 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/int-wp01-118738-xai-toolcall-salvage | 09bf5f6f03 | 2026-09-24 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family; same issue later fixed on HEAD-line by fix/118738-xai-toolcall-salvage |
| foundry/int-wp01-118748-reaction-scope | 16f8d9339f | 2026-09-24 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family; same issue later fixed on HEAD-line by fix/118748-reaction-session-scope |
| foundry/int-wp01-75801-clean-stream-end-misclassified | dcd1bb4aff | 2026-09-24 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/int-wp01-92570-compress-preview-flag | c923d34a29 | 2026-09-24 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/int-wp01-94486-model-switch-alternation | aa9509e0db | 2026-09-24 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/int-wp01-94778-marker-writer-identity | f3982b15f4 | 2026-09-24 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/int-wp02-102895-delete-stops-turn | 39457a97a1 | 2026-09-24 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/int-wp02-109073-reset-delegate-marker-merge | 06a239a81f | 2026-09-24 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/int-wp02-109450-corrupt-prompt-row | 473f686ee0 | 2026-09-24 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/int-wp02-118161-orphan-sweep-pinned | 8e6aa90e8f | 2026-09-24 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family; same issue later fixed on HEAD-line by fix/118161-pin-aware-sweep |
| foundry/int-wp02-76932-isolated-serve-profile-scope | 75ebfcfba5 | 2026-09-24 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/int-wp02-84525-optimize-live-gateway-refusal | f2f87ea071 | 2026-09-24 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/int-wp02-96522-resume-deadline | 975840b96b | 2026-09-24 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/int-wp02-96793-durable-draft-row | ceab00074a | 2026-09-24 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/int-wp03-105042-healed-branch | 2f8698c401 | 2026-09-24 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/int-wp03-46883-linux-wipe | 5f0c3eb35e | 2026-09-24 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/w1-105042 | 751cb12cf0 | 2026-09-22 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/w1-118161 | 6f0ddd7366 | 2026-09-22 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/w1-118738 | 094e2fb17f | 2026-09-22 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/w1-118748 | 6ffc211099 | 2026-09-22 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/w1-118755 | 8a786ae91a | 2026-09-22 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/w1-44580 | 43ef57ffcc | 2026-09-22 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp01-101939-include-compacted | 9dda4c5e11 | 2026-09-22 | 40 | +14/-0 (measured) | DEAD-ANCIENT | honor include_compacted on messages endpoint; base 2026-09-20 |
| foundry/wp01-108045-unscoped-pin | f4180ff0cc | 2026-09-22 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp01-108601-watchdog-flush | d3006163a1 | 2026-09-22 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp01-117867-held-gate-completion-flush | 242c93d4a5 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp01-118738-xai-toolcall-salvage | 25da63e5e8 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp01-118748-reaction-scope | 2d3d1458ae | 2026-09-22 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp01-75801-clean-stream-end-misclassified | 343bfacb75 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp01-92570-compress-preview-flag | 61a28e528d | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp01-94486-model-switch-alternation | f8fde08853 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp01-94778-marker-writer-identity | c0af817885 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp02-102895-delete-stops-turn | bfab8c4c58 | 2026-09-22 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp02-109073-reset-delegate-marker-merge | 9608cd74da | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp02-109450-corrupt-prompt-row | 38c47f93b1 | 2026-09-22 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp02-118161-orphan-sweep-pinned | 7e5cc932df | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp02-64157-sidebar-error | 14b611d6fe | 2026-09-22 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp02-64157-sidebar-fetch-surface | 2e4ddad5c8 | 2026-09-24 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp02-76932-isolated-serve-profile-scope | 219063e66e | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp02-84525-optimize-live-gateway-refusal | 9dcaf99cc8 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp02-96522-resume-deadline | 37a976f485 | 2026-09-22 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp02-96793-durable-draft-row | 6a4bde3439 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp03-105042-healed-branch | 0f1fa9c9a5 | 2026-09-22 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp03-46883-linux-wipe | 1196a0edfb | 2026-09-22 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp03-53480-update-active-sessions | fa7c573583 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp03-74885-reset-local-commits-2 | 6f17e095d4 | 2026-09-22 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp03-91636-emergency-db-wal | 018c3dfa88 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp04-100122-replay-truncated | 423de263a6 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp04-100122-truncated-replay | 555ec82cf6 | 2026-09-22 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp04-103288-ssh-resolve | 081122fef8 | 2026-09-23 | 40 | +14/-0 (measured) | DEAD-ANCIENT | ssh binary candidate ladder; base 2026-09-20 |
| foundry/wp04-106678-approvals-reap-deny | 33f407faf3 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp04-108325-heartbeat-busy-deadline | 2d7c01aa8b | 2026-09-24 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp04-51203-deps-off-loop | 01a5469677 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp04-74998-ssh-server-alive | f1ed73f9ae | 2026-09-24 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp05-101642-all-profiles-stuck | e3e06f95f5 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp05-118194-disband-interrupts-turn | 7603f216d2 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp05-75308-projects-global | 556c18fa7a | 2026-09-22 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp06-73152-clarify-blank-choices | 849c76e293 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp06-74741-linkify-fences | 86b3fbe81f | 2026-09-22 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp06-82613-moa-delete-dangling-model | a69eace8d1 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp06-93918-live-refine | cecfe858c1 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp07-102268-worktree-gateway-cwd | 4eed112311 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp07-46413-credential-denylist | 2f0b58efed | 2026-09-22 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp07-74649-proxy-path-host | c02e6bc95a | 2026-09-22 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp07-75761-image-upload-collision | e84364021a | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp07-81161-literal-pathspec | e22af2b2aa | 2026-09-22 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp07-98815-real-profile-home | 4836929c9a | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp08-102829-nous-connect-flips-provider | 8fa7522204 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp08-103277-private-url-cache | b5e34fc1be | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp08-107988-getkey-dead-link | ff3b6828c2 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp08-71352-webhooks-profile-state | fdcf63bfcc | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp08-79625-checkpoints-config | a902139553 | 2026-09-22 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp09-102910-tzname-residual-sites | 890f4a56fc | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp09-102910-tzname-surrogates | a56a2ecfbd | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp09-103416-part-resume | 2c966711ed | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp09-105498-stray-keyup-close | 2053da6125 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp09-108982-project-invisible-name | 06f04cee60 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp09-108982-project-name-invisible | 7b4950874b | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp09-39536-posix-python-version-gate | b9733b208a | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp09-65457-ctrlw-terminal-kills-pane | 599e23ad14 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp09-96139-quit-guard-no-window | bdaa3fbd02 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp10-100180-trigger-outcome | d87b7bd314 | 2026-09-22 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp10-105983-cron-max-duration | 13a4e18e48 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp10-43965-cron-orphan-sessions | 12ad9e94e5 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp10-43965-cron-remove-orphan-sessions | f1168e7530 | 2026-09-24 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp10-97635-preflight-state-db | 7b879d4d4e | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp11-107762-update-check-clobbers | 1015647480 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp11-46225-decorative-glyph-aria | f70e757d61 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp11-53688-at-mention-empty-popover | 146b7e69ef | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp11-91603-statusbar-memo | 92bf5565ac | 2026-09-22 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp11-97371-steer-no-turn-silent-buffer | 2a0ed6bdcf | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp12-102975-gateway-pill-target | 743ad6a6c6 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp12-115187-bot-tab-strip-names | 6555825263 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| foundry/wp12-98122-model-tag-explainer | 0c1a2bf4a2 | 2026-09-23 | 40 | +14/-0 (sampled) | DEAD-ANCIENT | foundry family |
| hwh/merge-installed-forkmain | b302cbdf5e | 2026-10-24 | 1185 | family of main (same tip SHA as deploy/fork-main) | DEAD-ANCIENT | identical tip to deploy/fork-main; redundant pointer on the fork line |
| land/desktop-20261027 | ecf4f58e2b | 2026-10-27 | 15 | +13/-0 | UNIQUE-WORK | landing merge: inapp-browser SHAs (ae8117b2eb…) + dup-fix merge; overlaps feat/desktop-inapp-browser-clean — land one, drop the other |
| live-newmain | 6093b46577 | 2026-10-03 | 2 | +2/-0, merge-tree CLEAN | UNIQUE-WORK (AMBIGUOUS) | graft-merge casualty repair; verify repair didn't already land via overlay/core-patches before merging |
| local/desktop-preview-audited | 0f8a2ede33 | 2026-08-16 | 9 | +9/-0, merge-tree CLEAN | UNIQUE-WORK | preview tooltip/locale/default-browser fixes; `preview-toolbar.tsx`, `preview-pane.tsx` |
| local/desktop-preview-stack | 575f41b4b2 | 2026-08-16 | 16 | +16/-0, merge-tree CLEAN | UNIQUE-WORK | 16 audited-PR applications (redact, shiki, cron marker, har-capture…); `gateway/run.py`, `agent/redact.py`, `cron/scheduler.py` |
| local/live-20261027 | e85a3a99dc | 2026-10-29 | 8 | +3/-4 | UNIQUE-WORK (partial) | unique: i18n on-demand, transcript-size counting, warm-cache trim (`catalog.ts`, `sessions.ts`, `session-state-cache.ts`); 4 commits patch-equiv |
| local/live-both | 29b369f05b | 2026-09-02 | 2 | +2/-0 | UNIQUE-WORK | combines fix SHAs 29b369f05b (ollama gate) + e726330d12 (rollback flag) — redundant with those two fix branches; keep one carrier |
| local/session-switch-perf-live | d0112a8d2f | 2026-10-28 | 7 | +3/-4 | UNIQUE-WORK (partial) | same 3 unique perf commits as local/live-20261027 without its merge; redundant sibling — keep one |
| main | 98b79d4560 | 2026-10-22 | 1167 | +804/-9, behind 3783 | DEAD-ANCIENT | fork-line tip (`_find_live_session_by_key` incarnation fix); base 2026-10-20. Re-implement, do not merge |
| merge/v0.22.2-converged | af5b1c3d1c | 2026-10-21 | 1158 | family of main | DEAD-ANCIENT | 283-commit catch-up compile-fix line; base 2026-10-20. Re-implement, do not merge |
| next/a2 | a7a3e06426 | 2026-10-15 | 1308 | +897/-11 | DEAD-ANCIENT | next family: base 2026-10-13 (see note below table). Ambition composer chip + judge chip |
| next/a3 | 2bc36efeb1 | 2026-10-15 | 1321 | +905/-11 | DEAD-ANCIENT | next family; judge-chip target-edit note, /ambition palette |
| next/b1 | eb5867cd65 | 2026-10-14 | 1259 | +869/-11 | DEAD-ANCIENT | next family; bot pane identity/memory editing |
| next/b2 | 99b1c75dd3 | 2026-10-14 | 1263 | +871/-11 | DEAD-ANCIENT | next family; computer timeline, live checklist, routines |
| next/b3 | 109476cdc6 | 2026-10-15 | 1300 | +893/-11 | DEAD-ANCIENT | next family; queued pills in composer |
| next/b4 | 5c6dda8add | 2026-10-15 | 1306 | +897/-11 | DEAD-ANCIENT | next family; queue drains on backend live-run snapshot |
| next/d1 | 99ed97f130 | 2026-10-15 | 1304 | +895/-11 | DEAD-ANCIENT | next family; Desk plugin page port (WIP, gates pending) |
| next/g1 | 285194e60c | 2026-10-14 | 1253 | +865/-11 | DEAD-ANCIENT | next family; group room survives reload (e2e) |
| next/n1 | 3e70960094 | 2026-10-14 | 1219 | +844/-11 | DEAD-ANCIENT | next family; real-backend reload lane |
| next/n2 | d9717229e3 | 2026-10-14 | 1219 | +844/-11 | DEAD-ANCIENT | next family; fork.bot.identity/memory backend |
| next/n3 | c7cbd38819 | 2026-10-14 | 1219 | +844/-11 | DEAD-ANCIENT | next family; fork.routines/computer.timeline backend |
| next/n4 | 64ce49b333 | 2026-10-14 | 1221 | +845/-11 | DEAD-ANCIENT | next family; durable approval journal (fork.approvals.*) |
| next/n5 | 4a6779b032 | 2026-10-14 | 1253 | +865/-11 | DEAD-ANCIENT | next family; browser step thumbnails/DOM snapshots |
| next/r1 | 1c824ad0c0 | 2026-10-15 | 1298 | +892/-11 | DEAD-ANCIENT | next family; red plugin test fixes on integration tip |
| next/r2 | 72b9bc8d14 | 2026-10-15 | 1300 | +893/-11 | DEAD-ANCIENT | next family; sidebar row label after by-id resolve |
| next/r3 | 628c88bb7 | 2026-10-15 | 1311 | +899/-11 | DEAD-ANCIENT | next family; six red thread tests, Interrupted pill |
| next/r4 | 39b0369ff7 | 2026-10-15 | 1317 | +903/-11 | DEAD-ANCIENT | next family; tool-stack fold rhythm, scroll anchor |
| next/r5 | e6372c2235 | 2026-10-15 | 1321 | +905/-11 | DEAD-ANCIENT | next family; one status row per call |
| next/r6 | a152fbe4a3 | 2026-10-15 | 1323 | +906/-11 | DEAD-ANCIENT | next family; re-anchor approval summary tests |
| next/r7 | 28d42ae418 | 2026-10-15 | 1327 | +908/-11 | DEAD-ANCIENT | next family; plugin slash commands in / popover |
| next/s3a | 6f948a48ae | 2026-10-14 | 1285 | +884/-11 | DEAD-ANCIENT | next family; tool calls as one-line pills (ancestry of b4-approvals-chain work — that chain is the HEAD-line carrier) |
| next/s3b | cdba8ea69a | 2026-10-14 | 1283 | +883/-11 | DEAD-ANCIENT | next family; inline ApprovalCard (ancestry of b4-approvals-chain) |
| next/t1 | bd075a9e19 | 2026-10-14 | 1259 | +869/-11 | DEAD-ANCIENT | next family; team board backend (fork.team.*) |
| next/t2 | e39ac3f5ff | 2026-10-15 | 1302 | +894/-11 | DEAD-ANCIENT | next family; goal-first team board |
| next/t3 | 95092ad3b2 | 2026-10-15 | 1296 | +891/-11 | DEAD-ANCIENT | next family; group rooms on hosted backend driver |
| next/u1 | 10c6d27717 | 2026-10-15 | 1307 | +897/-11 | DEAD-ANCIENT | next family; group room reading column (WIP manager snapshot) |
| next/u2 | 3bb24be8db | 2026-10-15 | 1317 | +903/-11 | DEAD-ANCIENT | next family; status vocabulary/palette sweep |
| next/u3 | d225efcfd1 | 2026-10-15 | 1327 | +908/-11 | DEAD-ANCIENT | next family; final DESIGN.md sweep (merged into feat/hermes-next 3c50ed89ef) |
| overlay/core-patches | 4064956c37 | 2026-10-29 | 0 | — (is HEAD) | STALE-DUPLICATE | tip SHA equals HEAD |
| perf/A | e6415b5b70 | 2026-10-24 | 1168 | +804/-10, family of main | DEAD-ANCIENT | i18n on-demand catalogs; fork-line member, base 2026-10-20. Audit tip commit for cherry-pick; do not merge |
| perf/beat-openhuman | b3c71bbf72 | 2026-10-06 | 7 | +6/-0, merge-tree CLEAN | UNIQUE-WORK | inline visualization cards (`visualization-card.tsx`, `visualizations.ts`, `visualization_tool.py`) + perf benchmark doc; shares bridge SHAs with fix/web-bridge-stubs |
| perf/C | 57f08a25e5 | 2026-10-24 | 1170 | +805/-11, family of main | DEAD-ANCIENT | return-refresh floor, hidden-tab poll, duplicate icon; fork-line member. Audit tip commits; do not merge |
| perf/D | 72d2031efe | 2026-10-24 | 1170 | +805/-11, family of main | DEAD-ANCIENT | warm transcript cache trim, pet sentiment; fork-line member. Audit tip commits; do not merge |
| perf/E | 6f57689b99 | 2026-10-24 | 1168 | +804/-10, family of main | DEAD-ANCIENT | rail collapse below 900px; fork-line member. Audit tip commit; do not merge |
| phase3/uiux-a11y | cc91fd02d1 | 2026-09-25 | 1 | +1/-0 | UNIQUE-WORK | theme grid order stability; `appearance-settings.tsx` exists in HEAD |
| polish/desktop-revamp | 273c676dfc | 2026-09-20 | 31 | +12/-0, merge-tree CLEAN | UNIQUE-WORK | empty-chat hero + revamp i18n + hero e2e; `intro.tsx` (Sept-20 base but probe CLEAN) |
| pr-124044 | 3340567e7a | 2026-09-25 | 1 | +1/-0 | UNIQUE-WORK | group chat ms-ordering; `group-chat.ts` exists in HEAD |
| pr-88865 | 35209ec30c | 2026-08-18 | 1 | +1/-0 | UNIQUE-WORK | honor `agent.disabled_toolsets`; `tui_gateway/server.py` exists in HEAD |
| revamp/gc1 | 7cfe1ececd | 2026-10-14 | 1207 | +836/-11 | DEAD-ANCIENT | revamp family: base 2026-10-13 (see note). Plugin pages on activity rail |
| revamp/gc2 | 0983f4c23c | 2026-10-14 | 1207 | +836/-11 | DEAD-ANCIENT | revamp family; group chat speaker runs |
| revamp/gc3 | cdd0d3b005 | 2026-10-14 | 1207 | +836/-11 | DEAD-ANCIENT | revamp family; live working rows with per-bot Stop |
| revamp/gc4 | 1beeb208dd | 2026-10-14 | 1207 | +836/-11 | DEAD-ANCIENT | revamp family; handoff cards + room subscriptions |
| revamp/groupchat | 7aa17971ad | 2026-10-14 | 1235 | +854/-11 | DEAD-ANCIENT | revamp family; merge of gx6 line |
| revamp/gx1 | f2b119f875 | 2026-10-14 | 1218 | +843/-11 | DEAD-ANCIENT | revamp family; members panel by status |
| revamp/gx2 | 73f292a927 | 2026-10-14 | 1218 | +843/-11 | DEAD-ANCIENT | revamp family; room bands, reorder, filters, templates |
| revamp/gx3 | bb410fcaa5 | 2026-10-14 | 1221 | +845/-11 | DEAD-ANCIENT | revamp family; speaker identity, event chips |
| revamp/gx4 | a7797b1142 | 2026-10-14 | 1219 | +844/-11 | DEAD-ANCIENT | revamp family; room chrome on tokens |
| revamp/gx5 | 324408e57a | 2026-10-14 | 1232 | +853/-11 | DEAD-ANCIENT | revamp family; quick filter survives reload |
| revamp/gx6 | 65c04f347b | 2026-10-14 | 1232 | +853/-11 | DEAD-ANCIENT | revamp family; composer drops dead reply mode |
| revamp/sessions | 9a6e313277 | 2026-10-14 | 1217 | +843/-11 | DEAD-ANCIENT | revamp family; split pane keyboard |
| revamp/ss1 | 1386c8a70d | 2026-10-14 | 1209 | +838/-11 | DEAD-ANCIENT | revamp family; sessions grouped by live state |
| revamp/ss2 | 170cfb1920 | 2026-10-14 | 1209 | +838/-11 | DEAD-ANCIENT | revamp family; live peek, overview grid |
| revamp/ss3 | 91120f36a1 | 2026-10-14 | 1210 | +838/-11 | DEAD-ANCIENT | revamp family; 2x2 split sessions, broadcast |
| revamp/tc1 | a24d7c7b74 | 2026-10-14 | 1228 | +850/-11 | DEAD-ANCIENT | revamp family; card view model + per-locale copy (ancestry of b3-toolcards-chain — that chain is the HEAD-line carrier) |
| revamp/tc2 | 4add544f8b | 2026-10-14 | 1228 | +850/-11 | DEAD-ANCIENT | revamp family; live tool activity card |
| revamp/tc3 | 17de5312bc | 2026-10-14 | 1233 | +853/-11 | DEAD-ANCIENT | revamp family; live tool cards in Bot Chat |
| revamp/tc4 | ff098b9f74 | 2026-10-14 | 1233 | +853/-11 | DEAD-ANCIENT | revamp family; live tool cards per working bot |
| revamp/tc5 | 746dff3990 | 2026-10-14 | 1237 | +855/-11 | DEAD-ANCIENT | revamp family; split card body |
| revamp/tc8 | 2bdcf27a84 | 2026-10-14 | 1240 | +858/-11 | DEAD-ANCIENT | revamp family; sentence statuses (ancestry of b3-toolcards-chain e55da382b3) |
| revamp/tc9 | 0fed5d7f55 | 2026-10-14 | 1240 | +858/-11 | DEAD-ANCIENT | revamp family; one approval line (ancestry of b3-toolcards-chain b58331483c) |
| revamp/toolcards | 1f10e521be | 2026-10-14 | 1243 | +859/-11 | DEAD-ANCIENT | revamp family; merge of tc9 line |
| revamp/w1 | 6924177a89 | 2026-10-14 | 1173 | +808/-11 | DEAD-ANCIENT | revamp family; titlebar More-tools menu |
| revamp/w2 | 98d5a7b0c6 | 2026-10-14 | 1174 | +809/-11 | DEAD-ANCIENT | revamp family; skeleton rows on hydrate |
| revamp/w3 | 299efcf5fd | 2026-10-14 | 1170 | +805/-11 | DEAD-ANCIENT | revamp family; card-based settings layout |
| revamp/w4 | bb567c1db2 | 2026-10-14 | 1173 | +808/-11 | DEAD-ANCIENT | revamp family; inline three-button approval card |
| revamp/w5 | a1b98b316b | 2026-10-14 | 1174 | +809/-11 | DEAD-ANCIENT | revamp family; renderer perf pass notes |
| revamp/w6 | c2a4c082f5 | 2026-10-14 | 1204 | +834/-11 | DEAD-ANCIENT | revamp family; hide idle session status dot (also merged into sync/nous-2026-10-13) |
| sync/2026-09-25 | f5768057da | 2026-09-26 | 247 | +96/-58 | DEAD-ANCIENT | old sync snapshot; tip is a Revert of upstream PR #74710; base 2026-09-26. Re-implement, do not merge |
| sync/nous-2026-10-13 | a4ab4c4985 | 2026-10-14 | 1207 | family of revamp (rail restore + revamp/w6 merge) | DEAD-ANCIENT | base 2026-10-13; revamp-family content. Re-implement, do not merge |
| sync/upstream-20261008 | 971d006849 | 2026-10-08 | 1112 | +752/-10, behind HEAD 10057 | DEAD-ANCIENT | upstream-sync snapshot (38880bd2f1); base 2026-10-08. Re-implement, do not merge |
| uiux/laptop-exp | 977b0fc2f1 | 2026-09-25 | 59 | +24/-0, merge-tree CLEAN | UNIQUE-WORK | Sept-25 devin UX merges (sidebar search, composer, rail) + changelog; probe CLEAN but base is 5 weeks old — cherry-pick, do not merge whole |
| vault/bot-mode-refinement | 4064956c37 | 2026-10-29 | 0 | — (is HEAD) | STALE-DUPLICATE | tip SHA equals HEAD |
| vault/feature-inventory | 5813c11384 | 2026-10-29 | 1 | +0/-1 | STALE-DUPLICATE | cherry `-`: already in HEAD |
| vault/group-room-polish | 911eda9c55 | 2026-10-29 | 1 | +0/-1 | STALE-DUPLICATE | cherry `-`: already in HEAD |
| vault/left-pane-facelift | 9b531b4567 | 2026-10-29 | 0 | — (ancestor) | STALE-DUPLICATE | `rev-list` count 0 |
| vault/warm-paper | 1c261b096a | 2026-10-29 | 1 | +0/-1 | STALE-DUPLICATE | cherry `-`: already in HEAD |
| w1/approvals-plugin | 9f399f8a2b | 2026-10-26 | 0 | — (ancestor) | STALE-DUPLICATE | `rev-list` count 0 |
| w1/approvals-single | bbc348486b | 2026-10-27 | 0 | — (ancestor) | STALE-DUPLICATE | `rev-list` count 0 |
| w1/i18n-dead | a9211edd60 | 2026-10-27 | 0 | — (ancestor) | STALE-DUPLICATE | `rev-list` count 0 |
| w1/interrupt-card | d6f2bd7d87 | 2026-10-26 | 0 | — (ancestor) | STALE-DUPLICATE | `rev-list` count 0 |
| w1/items | 43c586c9c2 | 2026-10-27 | 0 | — (ancestor) | STALE-DUPLICATE | `rev-list` count 0 |
| w2/core | 6def56b5f7 | 2026-10-27 | 0 | — (ancestor) | STALE-DUPLICATE | `rev-list` count 0 |
| w2/wip | 96c3765b6e | 2026-10-27 | 0 | — (ancestor) | STALE-DUPLICATE | `rev-list` count 0 |
| webapp-live | 23f36478ed | 2026-10-06 | 2 | +2/-0 | UNIQUE-WORK | bridge SHAs 1455d8944/23f36478e (predecessors of fix/web-bridge-stubs 36a49dbfb5/a460e64c3b) — redundant sibling; keep fix/web-bridge-stubs |
| wip/grok-bot-handover | d5943bde4c | 2026-10-26 | 15 | +15/-0 | UNIQUE-WORK | WIP handover merge + b5 gap WIP + b4-approvals-chain SHAs (bef7b60c83…); overlaps b4-approvals-chain/b5 — land those instead; tree unchanged by d5943bde4c itself |
| wip/inline-visualizations | 6c02ab1b3c | 2026-10-26 | 4 | +0/-4 | STALE-DUPLICATE | all cherry `-`: already in HEAD |

## Family notes (evidence for grouped verdicts)

- **foundry family (100 branches):** every branch has exactly `rev-list HEAD..B = 40` and `merge-base` dated
  2026-09-20. Full `git cherry` measured on 34 of 100 (30 in first batch + wp01-101939, wp04-103288,
  wp01-101939 second listing, next/u3 and revamp rows excluded) — all returned exactly +14/-0; e.g.
  `foundry/wp01-101939-include-compacted: 14 0`, `foundry/wp04-103288-ssh-resolve: 14 0`. The remaining 66
  share identical ahead-count, base date, and tip-date window (2026-09-22..24), so the +14/-0 pattern is
  asserted by sampling, not measured per branch. Several foundry fixes (118738, 118748, 118161, 118755)
  were re-done on the HEAD line as `fix/1187xx-*` branches (see UNIQUE WORK) — that is why the family is
  DEAD-ANCIENT rather than mergeable: the surviving fixes already have HEAD-line carriers.
- **next family (28 branches):** base 2026-10-13 for all; per-branch `git cherry` measured for every branch
  (+844…+908 / -11). superseded as a merge unit by the Oct-29 upstream merge; HEAD-line carriers exist for
  s3a/s3b content (`b4-approvals-chain`) and tc content (`b3-toolcards-chain`).
- **revamp family (29 branches):** base 2026-10-13 for all; per-branch `git cherry` measured for every branch
  (+805…+859 / -11). Same supersession note as next.
- **fork line (main, deploy/desktop, deploy/fork-main, hwh/merge-installed-forkmain,
  merge/v0.22.2-converged, fix/restore-upstream-ui-merge, fix/statusbar-and-plugin-sdk,
  fix/webapp-signin-redirect, perf/A, perf/C, perf/D, perf/E):** all share base 2026-10-20 and sit
  3783 commits behind HEAD (HEAD's upstream merge) with ~804–812 unique patch-ids each. `git merge-base
  --is-ancestor` both directions = NO for main vs HEAD (divergent lines). Individual tip fixes (statusbar
  hide menu, signin redirect, i18n/perf passes) are cherry-pick audit candidates, not merge candidates.
- **Redundant-pointer groups (safe to collapse to one carrier):** feat/instant-ack{-honesty,-queue} share
  tip SHA e5ad09b5a6; fix/context-ollama-gate-muse-spark SHA cfd7775fc4 == local/live-both tip parent;
  e726330d12 in fix/rollback + local/live-both; bridge SHAs 36a49dbfb5/a460e64c3b in fix/web-bridge-stubs,
  feat/inline-visualizations, perf/beat-openhuman; b4-approvals-chain SHAs inside wip/grok-bot-handover.

## UNIQUE WORK — what is lost per branch if deleted (sha + file evidence)

- `b3-toolcards-chain`: 11 commits (4669a0a3…d577cffb5b) — `tool-cards/model.ts`, `tool-card.tsx`,
  `tool/approval.tsx`, per-locale `tool_cards` strings. Absent from HEAD by patch-id; files exist in HEAD.
- `b4-approvals-chain`: 3 commits (bb343e53, 97b001f74, bef7b60c83) — inline ApprovalCard + approval journal.
- `b5-toolcard-gaps`: 8ca243754d — `tool-card-open-page.tsx` and 7 siblings; files absent from HEAD (new work).
- `docs/perf-visual`: 5 commits (48babeb7…5179cad676) — `infographic*.png` + methodology notes.
- `factory/3d-pane`: 33 commits — 3D Pane behaviour + PANE3D.md (merge-tree CLEAN).
- `factory/3d-pane-v1` + `live-newmain`: 6093b46577 merge-casualty repair (AMBIGUOUS for live-newmain — verify
  against overlay/core-patches first).
- `feat/bot-mode-product-closure`: cdc3471047 — strips + prompt restore + probe (`plugin.js`, `prompts.ts`,
  `tools/bot_mode_probe.py`).
- `feat/bots-product-convergence` / `fix/bot-mode-attention-truth`: same-file attention-states work
  (cecb6e8835 / 3a4f1a4c5d) — keep one carrier.
- `feat/coding-session-registration`: 6c40a16f2b — `process_registry.py`, `terminal_tool*.py`.
- `feat/desktop-cron-advanced-settings`: a731ecf3ce — cron settings parity both ends.
- `feat/desktop-inapp-browser-clean` / `land/desktop-20261027`: 12 inapp-browser commits (ae8117b2eb…2f281613b8)
  — keep one carrier (land/ adds the dup-fix merge ecf4f58e2b).
- `feat/inline-visualizations` / `fix/web-bridge-stubs` / `webapp-live` / `perf/beat-openhuman`: bridge wiring
  + claude-mem provider + e2e; primary carrier `fix/web-bridge-stubs` (a460e64c3b); beat-openhuman additionally
  holds `visualization-card.tsx` + benchmark doc.
- `feat/instant-ack` (+ `-honesty`, `-queue`, same tip): 82f9339aa4 + e5ad09b5a6 — whole `app/chat/instant-ack/`
  directory is absent from HEAD.
- `feat/skill-usage-key-normalization`: b93b2c08bd + 5cf18713177 — `tools/skill_usage.py`.
- `feat/webapp-desktop-plugin-install`: 8e3bae5b50 + 23ff61033b — Windows-safe plugin removal/install halves.
- `fix/118161-pin-aware-sweep`: c76e92fe22 — `session_reaper.py`.
- `fix/118628-close-tile-monitoring`: fc64e60320 — `message-stream.ts` + test.
- `fix/118738-xai-toolcall-salvage`: ab7019fa2a — `codex_responses_adapter.py`.
- `fix/118748-reaction-session-scope`: 20e54d5f15 — `desktop-bridge.ts`, `gateway-switch.ts`, reactions store.
- `fix/118755-reasoning-only-hydrate`: 76d4ff382b — AMBIGUOUS vs HEAD 3b5c5cc7fb (same #118755); diff before merge.
- `fix/44580-update-silent-desktop-fail`: 7208475b3d — `update_cmd*.py`.
- `fix/bot-mode-product-closure`: 26295f8cfd + 31d90ad347 — roster-from-shell + Bot Chat seating.
- `fix/bot-mode-protocol-roster-refresh`: ab5a999bb3 + 6fbbf1a01f — roster refresh + schema trim.
- `fix/bot-mode-visual`: 6683561600 only — roster density in `bot-row.tsx` (other 5 commits already in HEAD).
- `fix/browser-real-profile-password-store-ua`: 91e07fa1b2 — new file `tools/browser_tool_real_profile.py`.
- `fix/context-ollama-gate-muse-spark`: cfd7775fc4 — ollama clamp gate (also tip of local/live-both).
- `fix/desktop-new-session-clears-terminal-takeover`: 3 commits — terminal overlay/tab-takeover.
- `fix/local-runtime-server-extra-flags`: 498cb54d37 + d65b144af1 — llama-server extra-args hatch.
- `fix/npm-high-severity-advisories`: c687836fec — dep clearance (re-verify advisories first).
- `fix/rollback-diff-truncation-flag`: e726330d12 — `rollback.diff` totalLength.
- `fix/tools-config-warn-unregistered-platform-toolset-88857`: 262a507cbb — phantom-toolset warning.
- `fix/webapp-polish-batch`: a54470f8e8 only — narrowed-filter project join (#146495).
- `local/desktop-preview-audited`: 9 commits — preview tooltip/locale/default-browser.
- `local/desktop-preview-stack`: 16 commits — audited PR applications #87952–#87959 Batch.
- `local/live-20261027` / `local/session-switch-perf-live`: 3 shared perf commits (d0112a8d2f, 7db9f80b8a,
  6614f3b4b9 + cache/AC P fixes) — keep one carrier.
- `local/live-both`: redundant combiner of the ollama + rollback SHAs — keep a single-fix carrier instead.
- `phase3/uiux-a11y`: cc91fd02d1 — theme grid order.
- `polish/desktop-revamp`: 12 commits — empty-chat hero + revamp i18n + e2e (merge-tree CLEAN).
- `pr-124044`: 3340567e7a — group-chat ms ordering (`group-chat.ts`).
- `pr-88865`: 35209ec30c — `disabled_toolsets` (`tui_gateway/server.py`).
- `uiux/laptop-exp`: 24 unique commits — Sept-25 devin UX batch (merge-tree CLEAN; cherry-pick, don't merge whole).
- `wip/grok-bot-handover`: 15 commits but mostly redundant (contains b4/b5 SHAs); only d5943bde4c is its own and
  it changes no tree — land b4-approvals-chain + b5 instead.

## SAFE TO DELETE — nothing unique vs HEAD (25 branches)

Ahead-of-HEAD count 0 (tip is an ancestor of HEAD): `b3-toolcards`, `b4-approvals`, `design/batch-a`,
`fix/desktop-msg-dup`, `fix/desktop-thread-scroll`, `fix/ui-7-defects`, `overlay/core-patches` (= HEAD),
`vault/bot-mode-refinement` (= HEAD), `vault/left-pane-facelift`, `w1/approvals-plugin`, `w1/approvals-single`,
`w1/i18n-dead`, `w1/interrupt-card`, `w1/items`, `w2/core`, `w2/wip`.
All-`minus` cherry (every commit patch-equivalent in HEAD): `catalog-handflow` (+0/-1),
`catalog/typesafe-skill-router` (+0/-2), `feat/desktop-session-switch-perf` (+0/-4),
`fix/desktop-msg-dup-and-scroll` (+0/-1), `fix/remove-opencode-free-tier` (+0/-3),
`vault/feature-inventory` (+0/-1), `vault/group-room-polish` (+0/-1), `vault/warm-paper` (+0/-1),
`wip/inline-visualizations` (+0/-4).

## DEAD-ANCIENT — re-implement, do not merge (183 branches)

All branches in the table marked DEAD-ANCIENT: 5 `backup/*` snapshots, `bot-mode-2-team-os`,
`feat/bot-mode-20-teamos-local` (lineage continued in the product-closure branches above),
`claude/cool-cannon-cx2rw7`, the 12-branch fork line (`main`, `deploy/*`, `hwh/*`, `merge/*`,
`fix/restore-*`, `fix/statusbar-*`, `fix/webapp-signin-redirect`, `perf/A/C/D/E`), `feat/desktop-web`,
`feat/hermes-next`, `fix/105042-neverpushed-lsremote` (touched file absent from HEAD; HEAD f6df13bac6
covers the area), 100 `foundry/*`, 28 `next/*`, 29 `revamp/*`, 3 `sync/*`.
Per-branch counts, base dates, and cherry evidence are in the table rows; family sampling notes above.
Explicit note: for these branches re-implementation of the surviving idea on HEAD is required — none of
them merges cleanly in any meaningful sense (hundreds of unique patch-ids on Sept/Oct bases), and several
have HEAD-line carriers already (foundry 1187xx → fix/1187xx-*, next s3a/s3b → b4-approvals-chain,
revamp tc* → b3-toolcards-chain). The fork-line tip fixes (statusbar hide menu cc07241144, signin redirect
66e2762cc7, perf passes e6415b5b70/57f08a25e5/72d2031efe/6f57689b99) are the only cherry-pick audit
candidates in that family.

## CORRECTION (2026-10-29, after the first landing attempt)

The "merge-tree CLEAN" column above was produced with the **legacy 3-argument form**
`git merge-tree <merge-base> HEAD <branch>`, which prints a combined diff and does **not**
signal conflicts in its output structure. Re-probing every UNIQUE-WORK row with the modern
oracle `git merge-tree --write-tree --name-only HEAD <branch>`:

| branch | legacy probe said | modern oracle says |
|---|---|---|
| `factory/3d-pane` | CLEAN | **592 conflicted paths** |
| `factory/3d-pane-v1` | CLEAN | **585 conflicted paths** |
| all other UNIQUE-WORK rows | — | re-probed, see `plan-fast.json` |

Only 7 of the 42 candidate branches are actually mergeable in one shot:
`feat/desktop-inapp-browser-clean`, `feat/instant-ack`, `feat/skill-usage-key-normalization`,
`fix/118738-xai-toolcall-salvage`, `local/live-20261027`, `local/session-switch-perf-live`,
`phase3/uiux-a11y`.

`docs/perf-visual` is a separate case: it is an **orphan branch** (root commit, no common
ancestor), so `merge-tree` fails with 0 conflicted paths and `merge_base_days` is null. Its 5
commits must be cherry-picked onto HEAD, never merged.

Consequence: "merges clean" must never be inferred from the legacy form, and a
CONFLICT verdict is not a reason to skip a branch — it is a reason to land it per-commit
(`git cherry-pick -x` of its patch-absent commits) rather than as a whole-branch merge.


