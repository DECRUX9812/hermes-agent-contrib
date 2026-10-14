# Fork first-run onboarding: inventory before porting onto upstream

Read-only analysis. Nothing in the merge worktree was changed. Every claim below comes from `git show` / `git ls-tree` / `git grep` on the two commits, or from file reads listed in section 1. Items marked "not read" were not opened in depth. Items marked "not found" were searched for in MERGE_HEAD non-test files and not located.

## 1. Scope and sources

- **HEAD (fork):** `fd16d50fee` (feat(desktop): consensus voting cards for team decisions), branch `claude/cool-cannon-cx2rw7` in the sync worktree.
- **MERGE_HEAD (upstream):** `601b550b4b` (NousResearch/hermes-agent).
- **Method:** `git show <rev>:<path>`, `git ls-tree -r --name-only <rev>`, `git grep -l -F` for symbol presence. No checkout, stash, reset, merge or index write.

### Fork-only onboarding files (present in HEAD, not in MERGE_HEAD tree)
- Python: `tui_gateway/methods_onboarding.py` (128 lines), `tui_gateway/methods_start_chat.py`, `tui_gateway/start_chat.py`, `tools/start_chat_tool.py`, `tools/setup_choose_tool.py` (348 lines), `agent/initiate_setup_prompt.py`, `agent/initiate_setup_facts.py`, `hermes_cli/setup_profile.py` (not in MERGE_HEAD; `git cat-file -e` returns no).
- Skill: `optional-skills/productivity/initiate-setup/SKILL.md` and `templates/handoff.md`.
- Desktop store: `apps/desktop/src/store/onboarding-gate.ts` (190), `onboarding-answers.ts`, `onboarding-intro.ts`, `onboarding-plugins.ts`, `onboarding-presence.ts`, `onboarding-scope.ts`, `start-chat.ts`, `onboarding.ts` (1385, shared with upstream).
- Desktop onboarding-chat: `apps/desktop/src/components/onboarding-chat/` (`assembly.ts`, `chip.tsx`, `gate.tsx`, `intro.ts`, `intro-copy.tsx`, `options.tsx`, `setup-session.ts`, `signpost.ts`, `skip.tsx`).
- Desktop kickoff: `apps/desktop/src/app/contrib/onboarding-kickoff.ts` (276), `onboarding-kickoff-machine.ts` (173), `hooks/desktop-onboarding-metrics.ts` (152, present on both sides, fork version differs).
- Desktop components: `apps/desktop/src/components/onboarding/index.tsx` (954), `flow.tsx` (381), `providers.tsx`, `free-tier-setup-notice.tsx`, `glyph.tsx`; `assistant-ui/clarify/setup-pickers.tsx` (330); `assistant-ui/start-chat-tool.tsx`.
- Electron/TUI: `apps/desktop/electron/guest-onboarding.ts` (23), `ui-tui/src/app/setupHandoff.ts` (55).
- i18n: `apps/desktop/src/i18n/en_onboarding.ts` (88), `types_onboarding.ts`, the `freeTier` block in `en.ts`, and `enHandoffTour` in `en_app_tour.ts`.
- Tests: `tests/agent/test_onboarding.py`, `tests/hermes_cli/test_setup_profile_*.py` (3), `tests/hermes_cli/test_tui_first_run_routing.py`, `tests/tools/test_setup_choose_name_card.py`, `tests/tui_gateway/test_first_contact_onboarding.py`, desktop `onboarding-chat/gate.test.tsx`, `onboarding/skip-gate.test.tsx`, `onboarding-chat/intro.test.ts`, `onboarding/flow.test.tsx`, `onboarding/index.test.tsx`, `onboarding/free-tier-intro.test.ts`, `onboarding/free-tier-setup-notice.test.tsx`, `store/start-chat.test.ts`.
- E2E: `apps/desktop/e2e/onboarding.spec.ts` (47), `e2e/core/onboarding-first-chat.spec.ts` (143).

### Upstream first-run files (present in MERGE_HEAD, not in HEAD)
- Python: `agent/onboarding_flow.py` (beats, `apply`, `applies_to`, `_ended`), `agent/onboarding_record.py` (KEY `onboarding_run`, `start`, `advance`, `load`, `delete_chat`, `on_ended`), `agent/onboarding_text.py` (CHAT_TITLE "Getting started", GREETING, `opening_prompt`, per-locale questions), `agent/onboarding_first_tasks.py` (FIRST_TASKS, MAX_PICKS=4), `agent/onboarding_facts.py` (`read_facts`, `suggested_name`), `tools/setup_beat_tool.py` (214), `hermes_cli/onboarding_run.py` (70), `hermes_cli/onboarding_due.py` (99), `tui_gateway/methods_onboarding.py` (353, rewritten), `electron/first-run-setup-gate.ts`.
- Desktop: `store/setup-beat.ts`, `store/onboarding-run.ts`, `store/onboarding-phase.ts`, `store/onboarding-session.ts`, `components/onboarding/first-run/` (`assembly.ts`, `intro.ts`, `intro-copy.tsx`, `intro-copy.css`, `kickoff.ts`, `layout.test.ts`), `components/assistant-ui/setup-beat/` (`setup-beat-tool.tsx`, `beat-cards.tsx`, `plugins-card.tsx`, `receipt.tsx`, `card-type.ts`), `components/onboarding/onboarding-end.tsx`, `components/onboarding/skip-setup.tsx`, `app/settings/onboarding-settings.tsx`, `app/session/hooks/use-message-stream/gateway-event/onboarding.ts`.
- Upstream tests: `tests/agent/test_onboarding_flow.py`, `test_onboarding_first_tasks.py`, `tests/tools/test_setup_beat_tool.py`, `tests/tui_gateway/test_onboarding_{e2e,endings,fresh_launch,run_rpc,session,welcome_claim}.py`, `tests/hermes_cli/test_onboarding_{due,run}.py`.

### RPC methods and events, both sides

| Method / event | HEAD (fork) | MERGE_HEAD (upstream) |
|---|---|---|
| `onboarding.state` | yes: returns `eligible, intro, failed_starts, completed_at, profile` (error 5076 path) | yes, **same name, different shape**: `run, eligible, session_id, run_id` (unscoped, per the comment at `methods_onboarding.py:8`) |
| `onboarding.set_run` | no | yes |
| `onboarding.start` | no | yes (uses `free_tier_bootstrap`, `read_facts`, `opening_prompt`) |
| `onboarding.skip` | no | yes |
| `onboarding.ensure_setup_profile` | yes | no (not found) |
| `onboarding.ensure_setup_session` | yes | no (not found) |
| `onboarding.reset_setup_profile` | yes | no (not found) |
| `onboarding.record_failed_start` | yes | no (not found) |
| `onboarding.mark_seen` (RPC) | yes | no as RPC; `mark_seen`/`is_seen` survive as Python functions in `agent/onboarding.py` |
| `session.start_chat` | yes | no (not found; `tui_gateway/start_chat.py` and `tools/start_chat_tool.py` absent) |
| `onboarding.ended` (global event) | no | yes, broadcast from `register()` in `methods_onboarding.py:353` |
| Tool `setup_choose` (toolset `setup`) | yes | no; `shared_metrics_contract.py` lists it as retired |
| Tool `start_chat` (toolset `start_chat`) | yes | no; also listed as retired |
| Tool `setup_beat` (toolset `onboarding`) | no | yes (`tools/setup_beat_tool.py:208-214`) |

**Name collision:** `onboarding.state` exists on both sides with different response shapes. Any fork port must rename it (for example `fork.onboarding.state`).

---

## 2. Fork behaviour inventory

Columns: id | behaviour | fork file:symbol | state stored where | user-visible copy / screens | upstream coverage (yes/partial/no, with upstream file:symbol) | port target.

| id | behaviour | fork file:symbol | state stored where | user-visible copy / screens | upstream coverage | port target |
|---|---|---|---|---|---|---|
| F01 | `setup_choose` agent tool: question, accent, theme, layout, connectors, plugins, tour, fork, machine_use cards; 12 options max; skip ladder of 3 steps | `tools/setup_choose_tool.py:setup_choose_tool` (245-287), `_follow_up` (130-161), `_remember` (168-184), `_CLOSED` (242), registered 343-348 | picks and pick_ids in setup-profile state; cards in `<home>/setup-cards/<session_id>.json` via `record_cards` | Clarify pickers (see S17), `_NO_CONNECTORS`, `_NO_PLUGINS` messages | partial: `tools/setup_beat_tool.py` (beats `name, theme, layout, connectors, plugins, tour, build`). Fork kinds `question`, `fork`, `machine_use` have no beat (not found upstream) | setup_beat step (add a beat only where a fork kind has no equivalent) |
| F02 | `start_chat` agent tool and `session.start_chat` RPC: opens a new chat in the target profile with a message, title max 40, `from_setup` detection, retry on rejection | `tools/start_chat_tool.py` (schema, 47 lines); `tui_gateway/start_chat.py:start_chat` (36-92); `tui_gateway/methods_start_chat.py` (21-44) | new session in target profile; retry outcome in session DB via `tool_row_retry` / `set_tool_row_retry`; `mark_completed` in setup state | Tool card copy in S18 | no: upstream has no `session.start_chat` or `start_chat` tool. Upstream handoff is `onboarding.start` plus the `build` beat | fork.onboarding.* RPC (new name, e.g. `fork.onboarding.start_chat`); tool re-registered under a fork-owned toolset |
| F03 | Start-chat handoff card: starting / untitled / retry / open / failure states, `$startChatRetries`, superseded logic | `apps/desktop/src/components/assistant-ui/start-chat-tool.tsx` (StartChatTool 56; retry 86-97; showRetry 122); `apps/desktop/src/store/start-chat.ts` (readStartChatResult 14-35, startChatSuperseded 87-110, retryStartChat 112+) | in-memory atoms; outcome read from tool result | `t.assistant.startChat` (en.ts 5515-5524): "Couldn't start that chat.", "Retry", "Open" | no | fork.onboarding.* RPC for retry (only if the handoff card is kept) |
| F04 | `onboarding.ensure_setup_profile`: creates the setup profile under `_setup_profile_lock`; mirrors launch credentials on create | `tui_gateway/methods_onboarding.py:13-23`; `hermes_cli/setup_profile.py:ensure_setup_profile` (79-93) | profile dir named `hermes-setup` (SETUP_PROFILE_NAME) plus SETUP_PROFILE_MARKER | none direct; `SETUP_SOUL` text (about line 36) is agent-facing | no: `ensure_setup_profile` not found. `hermes_cli/setup_profile.py` absent. Upstream uses one session with `onboarding_record` instead of a second profile | fork.onboarding.ensure_setup_profile (decide first whether a separate profile is still wanted; see section 4 risks) |
| F05 | `onboarding.ensure_setup_session`: finds or creates the chat titled SETUP_CHAT_TITLE; seeds messages when `message_count` is 0 | `tui_gateway/methods_onboarding.py:26-48` | session row in the setup profile | chat title from SETUP_CHAT_TITLE | partial: `agent/onboarding_record.py:start` (87) and `agent/onboarding_text.py` CHAT_TITLE "Getting started", `opening_prompt` (116). Find-by-title reuse not found | fork.onboarding.ensure_setup_session if reuse is kept; otherwise setup_beat step (opening) |
| F06 | `onboarding.reset_setup_profile`: clears setup sessions then resets state (error codes 4072, 5074); default reset True | `tui_gateway/methods_onboarding.py:73-85`, `_clear_setup_sessions` (111-124); `setup_profile.py:reset_setup_profile` (96-112) | setup profile state reset to `_FRESH_STATE` | none | no: not found. Closest is `onboarding.set_run` (flag only) | fork.onboarding.reset_setup_profile |
| F07 | `onboarding.record_failed_start`: counts failed starts; MAX_FAILED_STARTS=3 | `tui_gateway/methods_onboarding.py:61-64`; `setup_profile.py:record_failed_start` (191-196) | setup state key `failed_starts` | `abandonGuide` path in `onboarding-gate.ts` | no: name not found; upstream `onboarding_due.py` (BOOT_WAIT_SECONDS=8.0) and `onboarding_run.py` have no failure counter | fork.onboarding.record_failed_start |
| F08 | `onboarding.mark_seen`: marks the intro as seen (latch so the intro does not replay) | `tui_gateway/methods_onboarding.py:67-70`; `setup_profile.py:mark_intro_seen` (199-200); also `agent/onboarding.py:mark_seen` (232-252) | setup state key `intro`; `agent/onboarding.py` flag | intro not replayed | partial: `agent/onboarding.py` still has `mark_seen`/`is_seen`; `hermes_cli/onboarding_run.py:set_run` writes an optional seen flag; root `config.yaml` `onboarding.run` | fork.onboarding.mark_seen only if the fork intro latch is kept; otherwise drop (upstream `onboarding.run` latch covers it) |
| F09 | `onboarding.state` (fork shape): `eligible, intro, failed_starts, completed_at, profile`; `eligible` is `GUEST_ONBOARDING_ENV == "1"` | `tui_gateway/methods_onboarding.py:51-58`, `_onboarding_state_result` (100-108); `setup_profile.py:onboarding_eligible` (141-143), `read_state` (146-150), `_public_state` (240-242, hides `owner_profile`, `setup_disabled_toolsets`) | setup profile state | none direct; drives gate in `gate.tsx` | partial: name collision. Upstream `onboarding.state` (`methods_onboarding.py:10`) returns `run, eligible, session_id, run_id` | fork.onboarding.state (rename; never reuse `onboarding.state`) |
| F10 | Onboarding gate: phases `idle, pending, guided, left, skipped, done`; decides whether the guided intro runs | `apps/desktop/src/store/onboarding-gate.ts` (phases 12, `$onboardingGate` 27, `beginOnboardingFlow` 93-100, `completeGuide` 144-150, `leaveGuide` 152-157); `components/onboarding-chat/gate.tsx` (calls `onboarding.state` at 38) | in-memory atom; answers in localStorage `hermes-onboarding-wizard-answers-v1` (`onboarding-answers.ts`) | none direct | partial: upstream `store/onboarding-run.ts`, `store/onboarding-phase.ts`, `store/onboarding-session.ts` exist (not read in depth; phase names not compared) | drop after parity check (upstream phase store replaces it; re-map phases before deleting) |
| F11 | Kickoff machine: states `waiting-backend, preparing, opening, started, off, failed`; `NO_DEADLINE=0`; backend-boot wait offers a skip exit; one transient retry | `apps/desktop/src/app/contrib/onboarding-kickoff-machine.ts` (createKickoffMachine 68-173, failureKind 28-45, NO_DEADLINE 18); `onboarding-kickoff.ts` (steps 149-194, adoptGuideSession 81-119, stalled check 226-236, notify "Welcome chat needs attention" 262-266); log prefix `[setup] kickoff` | in-memory | notify title "Welcome chat needs attention" (hardcoded English, not i18n) | partial: `components/onboarding/first-run/kickoff.ts` and `kickoff.test.ts` exist (not read) | drop after parity check; carry the English notify string into i18n |
| F12 | Onboarding metrics: `guidePhaseTransition`, `signInTransition`, `closeOnboardingStep`, `recordOnboarding` | `apps/desktop/src/app/contrib/hooks/desktop-onboarding-metrics.ts` (onboardingTransition 20, guidePhaseTransition 88-103, signInTransition 105-123, observeOnboardingMetrics 125-152) | telemetry; check opt-in gate before porting (rubric: outbound telemetry needs opt-in) | none | partial: same file path exists upstream; symbol parity not compared | drop/replace after symbol diff; keep the opt-in gate |
| F13 | Skip flow: "Skip setup" in intro; switches to default profile and marks seen; `dismissFirstRunOnboarding` writes cached `skipped` | `components/onboarding-chat/skip.tsx` (button 22); `onboarding-chat/intro.ts:skipIntro` (119-129); `store/onboarding.ts:dismissFirstRunOnboarding` (738) | intro latch via `onboarding.mark_seen`; cached `skipped` in `onboarding.ts` | "Skip setup", "Switching you over to your default profile" (both hardcoded English) | partial: upstream `onboarding.skip` RPC (`methods_onboarding.py:218`), `components/onboarding/skip-setup.tsx`, `skip-setup.test.tsx`, `onboarding-end.tsx` | drop (replaced by upstream `onboarding.skip`) after confirming the default-profile switch is kept (see risk 2) |
| F14 | Intro copy: typed-in lines and timing (START_MS 660, HOLD_MS 250, SPRING_MS 530); intro view states `off, starting, intro, ended` | `components/onboarding-chat/intro-copy.tsx` (LINES line 16; timing constants); `intro.ts` (openIntro 68-71, failIntro 73-77, endIntroView 80-103, leaveIntro 106-110); `store/onboarding-intro.ts` (IntroView 11, `$introView` 13, `$introStartExit` 17) | in-memory | "Hi, I'm Hermes." / "Let's set things up for you. Then we'll get something cool done." (hardcoded; same text as upstream `GREETING` in `agent/onboarding_text.py`) | partial: `components/onboarding/first-run/intro-copy.tsx`, `intro.ts`, `intro-copy.css` (not read) | drop after parity check; take the copy from `onboarding_text.GREETING` through i18n |
| F15 | Signpost: handoff tour after onboarding; waits for rail, sessions and model-pill selectors | `components/onboarding-chat/signpost.ts` (`showHandoffTour`, translateNow keys `handoffTour.*`) | i18n keys | `enHandoffTour` in `i18n/en_app_tour.ts`: profile, sessions, stay, local titles and text | partial: upstream `gui_tour` beat (`setup_beat_tool` `tour` beat, TOUR_OPTIONS "quick" / "full") in `agent/onboarding_flow.py:182` | setup_beat step (tour beat); keep the rail/sessions/model waits |
| F16 | First-contact agent prompt: `first_contact_turn_note`, `SETUP_OFFER_NOTE`, `setup_command` per platform; scripted opening and card order in `initiate_setup_prompt.py`; optional skill `initiate-setup` | `agent/onboarding.py` (first_contact_turn_note 154-197, SETUP_OFFER_NOTE 137-143, setup_command 150-152); `agent/initiate_setup_prompt.py`, `agent/initiate_setup_facts.py`; `optional-skills/productivity/initiate-setup/SKILL.md` | none (prompt text) | `/initiate-setup` builtin; `/initiate_setup` (Telegram), `/hermes initiate-setup` (Slack) | partial: `agent/onboarding_text.py:opening_prompt` (116), `facts_block`, `agent/onboarding_facts.py:read_facts`; `initiate-setup` skill name not found upstream | setup_beat step (opening prompt via `opening_prompt`); drop the optional skill and `initiate_setup_*` modules after the card order is re-checked |
| F17 | E2E expectations: provider-picker overlay on first boot; custom-endpoint flow then first chat renders once; visual snapshot `onboarding-overlay` | `apps/desktop/e2e/onboarding.spec.ts` (47); `e2e/core/onboarding-first-chat.spec.ts` (143) | n/a | Provider picker, API-key form, custom endpoint input, "connect" | partial: upstream `e2e/onboarding.spec.ts`, `e2e/core/onboarding-first-chat.spec.ts`, `e2e/update/first-run.spec.ts` exist (contents not compared). No fork spec covers the setup chat, name card or `start_chat` | drop the fork spec as-is; re-add setup-chat coverage per section 5 |
| F18 | Guest-onboarding Electron gate: `HERMES_GUEST_ONBOARDING` env and `--guest-onboarding` flag; sets `GATEWAY_ON_ALL_ADAPTERS_DOWN=stay_alive` | `apps/desktop/electron/guest-onboarding.ts` (GUEST_ONBOARDING_ENV, GUEST_ONBOARDING_FLAG, guestOnboardingEnabled, desktopBackendSpawnEnv); `apps/desktop/src/lib/onboarding-enabled.ts` reads `window.hermesDesktop.guestOnboardingEnabled` | process env for the backend | none | no: `guestOnboardingEnabled` not found on MERGE_HEAD; `HERMES_GUEST_ONBOARDING` appears in 2 non-test files on MERGE_HEAD (not checked). Upstream `electron/first-run-setup-gate.ts` is a different gate | drop (replaced by upstream first-run gate), but the `stay_alive` backend setting must be decided explicitly (risk 3). Do not add a new `HERMES_*` env var for it; config goes in config.yaml |
| F19 | ui-tui `setupHandoff`: TUI external-CLI setup, then `setup.status`; not part of the desktop setup chat | `ui-tui/src/app/setupHandoff.ts:runExternalSetup` (55 lines) | none | TUI transcript and status messages | partial: name appears in 3 non-test files on MERGE_HEAD; contents not compared | drop from the desktop port scope; keep as-is unless the merge changed it |
| F20 | Provider picker and setup UI screens (all fork screens; see section 3) | `components/onboarding/index.tsx`, `flow.tsx`, `providers.tsx`, `free-tier-setup-notice.tsx`, `glyph.tsx` | in-memory; `onboarding.ts` cache | see section 3 | partial: `components/onboarding/` exists on both sides; `flow.tsx`, `index.tsx`, `free-tier-setup-notice.tsx`, `providers.tsx`, `glyph.tsx` are in both; upstream adds `onboarding-end.tsx`, `skip-setup.tsx` | drop duplicates after diff; keep fork copy only where no upstream file exists |
| F21 | Setup chat layout and chips: `assembly.ts` (`assembleChatOnboarding`, `takeGuideShape`, `snapshotChatLayout`, `useSetupChatView`), `chip.tsx`, `options.tsx` (accents, LAYOUTS with ELITE_LAYOUT_ID `terminal-deck`, connector hidden list `discord, discordbot, microsoft_teams`) | `components/onboarding-chat/assembly.ts`, `chip.tsx`, `options.tsx` | `$chatOnboardingThreadIds` in memory; layout applied via `set_theme` | layout cards "Basic" / "Elite" (upstream `LAYOUT_OPTIONS`) | partial: `components/onboarding/first-run/assembly.ts` and `layout.test.ts` exist; `chip.tsx` and `options.tsx` not found upstream; upstream `LAYOUT_OPTIONS` has the same ids | setup_beat step (`layout` and `theme` beats); carry the connector hidden list into the upstream connectors beat |

Summary: 21 rows. Primary port targets: setup_beat step 4 (F01, F15, F16, F21), fork.onboarding.* RPC 8 (F02 to F09), plugin hook 0, drop 9 (F10, F11, F12, F13, F14, F17, F18, F19, F20). Rows F05, F08 and F16 name a fallback target; a single decision per row is needed before porting.

Coverage tally: 0 fully covered, 15 partially covered, 6 not covered (F02, F03, F04, F06, F07, F18).

---

## 3. UI screens and copy

| screen | component file | en_onboarding / en.ts keys (by name, from fork reads) |
|---|---|---|
| S01 Provider picker overlay (`DesktopOnboardingOverlay`, index.tsx:200) | `apps/desktop/src/components/onboarding/index.tsx` | `onboarding.headerTitle` "Let's get you set up with Hermes Agent", `headerDesc`, `lookingUpProviders`, `otherProviders`, `chooseLater`, `haveApiKey`, `recommended`, `connected` |
| S02 Free-tier ready panel (`FreeTierReadyPanel`, index.tsx:482-540) | same | `freeTier.readyTitle` "Hermes is ready.", `freeTier.readyCaption` "Free · connectors included", `freeTier.begin` "Begin", `freeTier.signInInstead` "Sign in with a Nous account instead", `onboarding.defaultModel`, `freeTier.pro`, `freeTier.free`, `freeTier.price`, `freeTier.change` |
| S03 Preparing panel (index.tsx:550) | same | `onboarding.preparingInstall`, `onboarding.starting` "Starting Hermes…", `onboarding.setupSlowTitle`, `setupSlowBody`, `continueWithoutSetup` |
| S04 Model/provider picker (`Picker`, index.tsx:608) and `FeaturedProviderRow`, `KeyProviderRow`, `FireworksProviderRow`, `LocalModelsProviderRow`, `OpenRouterProviderRow` (`providers.tsx`) | `index.tsx`, `providers.tsx` | `featuredPitch`, `fireworksPitch`, `localModelsTitle`, `localModelsPitch`, `openRouterPitch`, `apiKeyOptions.{fireworks, openrouter, openai, gemini, xai, local}`, `freeTier` tag |
| S05 API key form (`ApiKeyForm`, index.tsx:742) | `index.tsx` | `onboarding.getKey`, `pasteApiKey`, `localApiKeyPlaceholder`, `localModelNamePlaceholder`, `couldNotSave`, `backToSignIn`, `useApiKeyInstead` |
| S06 "Choose later" link (`ChooseLaterLink`, index.tsx:727) | `index.tsx` | `onboarding.chooseLater` |
| S07 Flow panel and subtitles (`FlowPanel`, flow.tsx:30) | `apps/desktop/src/components/onboarding/flow.tsx` | `onboarding.flowSubtitles`, `signInFailed`, `signInExpired`, `tryAgain`, `externalPending`, `errorDetails` |
| S08 Device code (`DeviceCode`, flow.tsx:168) | `flow.tsx` | `onboarding.deviceCodeOpened`, `onboarding.docs` |
| S09 Confirming model (`ConfirmingModelPanel`, flow.tsx:236) | `flow.tsx` | `onboarding.defaultModel`, `onboarding.change` |
| S10 Free-tier setup notice (`FreeTierSetupNotice`, free-tier-setup-notice.tsx:52) | `apps/desktop/src/components/onboarding/free-tier-setup-notice.tsx` | `freeTier.setupFailed.{gateClosed, paused, rateLimited, unreachable, serverError, powRequired, locked, generic, signInBelow, retrying, tryAgain}`; `data-testid="free-tier-setup-notice"` |
| S11 Glyph header and buttons (`GlyphText`, `DecodedLabel`, `HackeryButton`) | `apps/desktop/src/components/onboarding/glyph.tsx` | none (decorative) |
| S12 Intro copy (typed lines) | `apps/desktop/src/components/onboarding-chat/intro-copy.tsx` | none: hardcoded LINES (line 16) |
| S13 Skip button and tip | `apps/desktop/src/components/onboarding-chat/skip.tsx` | none: "Skip setup" (line 22) and "Switching you over to your default profile" (line 16) are hardcoded English |
| S14 Handoff tour (signpost) | `apps/desktop/src/components/onboarding-chat/signpost.ts` | `handoffTour.{profileTitle, profileText, sessionsTitle, sessionsText, stayTitle, stayText, localTitle, localText}` in `i18n/en_app_tour.ts` |
| S15 Setup-chat chips and layout cards | `apps/desktop/src/components/onboarding-chat/chip.tsx`, `options.tsx` | accent and layout labels from the option tables; no i18n keys confirmed |
| S16 Setup-chat notices | `apps/desktop/src/store/onboarding.ts`, `onboarding-chat/intro.ts` | hardcoded: "Hermes is ready" (index ~303), "Runtime not ready" (~803), "Welcome chat needs attention" (kickoff.ts 262-266) |
| S17 Setup clarify pickers (ThemePicker, AccentPicker, LayoutPicker, ChipPicker, ConnectorPicker, PluginPicker, QuestionPills) | `apps/desktop/src/components/assistant-ui/clarify/setup-pickers.tsx` | `t.assistant.setupChoose.*` |
| S18 Start-chat tool card | `apps/desktop/src/components/assistant-ui/start-chat-tool.tsx` | `t.assistant.startChat.{starting, startingUntitled, untitled, notStarted, retry, inProfile, open, openFailed}` (en.ts 5515-5524) |
| S19 Free-tier intro ack (`ackFreeTierIntro`, `clearFreeTierIntro`) | `apps/desktop/src/store/onboarding.ts` (868, 874) | `freeTier` keys; surfaced in `gate.tsx` |

Upstream-only screens (no fork equivalent, for reference): `components/assistant-ui/setup-beat/*` (setup beat cards, plugins card, receipt), `components/onboarding/onboarding-end.tsx`, `components/onboarding/skip-setup.tsx`, `app/settings/onboarding-settings.tsx`. Their keys were not read.

---

## 4. Upstream capabilities not in the fork

1. **`setup_beat` tool** (`tools/setup_beat_tool.py`): ordered beats `name, theme, layout, connectors, plugins, tour, build` (`agent/onboarding_flow.py:175-186`). Each beat has a card, picks, and optional `values` and `when` gates. Name card shows `suggested_name` only.
2. **Record-driven state machine** (`agent/onboarding_flow.py` `apply`): pure function from (record, event, facts) to (record, result, reminder). Run completes when the `build` beat settles. Ended runs refuse `setup_beat` with a fixed message.
3. **Run persistence** (`agent/onboarding_record.py`): `onboarding_run` key in the session DB; `start`, `advance`, `load`, `open_session_ids`, `active_session_id`, `delete_chat`, `on_ended` listeners that feed `onboarding.ended`.
4. **Boot-time due check** (`hermes_cli/onboarding_due.py`): `begin_boot`, `read`, `invalidate`, `BOOT_WAIT_SECONDS = 8.0`.
5. **First-install latch and root flag** (`hermes_cli/onboarding_run.py`): `should_run`, `latch_first_install`, `set_run` writing root `config.yaml` `onboarding.run`.
6. **First-task catalogue** (`agent/onboarding_first_tasks.py`): `FIRST_TASKS` with eligibility by facts (OS, connected connectors, plugins), `MAX_PICKS = 4`, `OWN_TASK`, `EVERY_TASK_SKILL = "humanizer"`, `task_skills`.
7. **Facts reader** (`agent/onboarding_facts.py`): `read_facts` (OS mapping, locale), `suggested_name`.
8. **Localised greeting and questions** (`agent/onboarding_text.py`): `ui_language`, `greeting`, `question`, traditional Chinese handling.
9. **`onboarding.start`, `onboarding.skip`, `onboarding.set_run`** RPCs and the `onboarding.ended` event (`tui_gateway/methods_onboarding.py`).
10. **Layout and theme side effects** from setup beats: `APPLIED_BY` maps `theme` and `layout` to `set_theme`; `gui_tour` is accepted as a general tool result.
11. **Shared metrics contract** (`shared_metrics_contract.py`): retires fork tool names `setup_choose` and `start_chat` (lines 161-162). Any port reusing those names collides with the contract.
12. **Desktop stores**: `store/setup-beat.ts`, `store/onboarding-run.ts`, `store/onboarding-phase.ts`, `store/onboarding-session.ts`, `app/session/hooks/use-message-stream/gateway-event/onboarding.ts`.
13. **Electron**: `electron/first-run-setup-gate.ts` and tests (`first-run-setup-gate.test.ts`, `first-run-setup-main-process.test.ts`).
14. **Tests**: 8 upstream TUI gateway onboarding test files, `test_setup_beat_tool.py`, `test_onboarding_flow.py`, `test_onboarding_first_tasks.py`, `test_onboarding_due.py`, `test_onboarding_run.py`.

**Risks to resolve before porting (also in section 5):**
1. **Profile isolation:** fork's `hermes-setup` profile (F04, F05, F06) has no upstream analogue; upstream runs first-run in one session. Decide whether isolation is still required.
2. **Skip switches to the default profile** (F13): upstream `onboarding.skip` does not switch profile as far as checked; confirm the fork behaviour is either kept or intentionally dropped.
3. **`stay_alive` backend setting** (F18): `GATEWAY_ON_ALL_ADAPTERS_DOWN=stay_alive` is set only for guest onboarding. Upstream gate does not reference it. Dropping it changes gateway behaviour when all adapters are down.
4. **Hardcoded English copy** (S12, S13, S16, F11): "Skip setup", the switching tip, intro LINES, "Hermes is ready", "Runtime not ready", "Welcome chat needs attention". These are outside i18n on the fork side and will be lost or left untranslated if the files are dropped without moving the strings.
5. **Name collision** on `onboarding.state` (section 1) and retired tool names `setup_choose`, `start_chat` (section 4, item 11).

---

## 5. Verification checklist

Nothing has been checked. Each box is verified only after the port and its test pass.

### Fork behaviours
- [ ] F01 setup_choose tool (all nine kinds, 12-option cap, skip ladder, follow-up and handoff)
- [ ] F02 start_chat tool and session.start_chat (title cap 40, from_setup, retry, mark_completed)
- [ ] F03 Start-chat handoff card (starting, retry, superseded, open, failure)
- [ ] F04 onboarding.ensure_setup_profile (creation, launch-credential mirror, lock)
- [ ] F05 onboarding.ensure_setup_session (find-by-title, seed messages when empty)
- [ ] F06 onboarding.reset_setup_profile (clears sessions and state)
- [ ] F07 onboarding.record_failed_start (counter, MAX_FAILED_STARTS=3 behaviour)
- [ ] F08 onboarding.mark_seen (intro not replayed after seen)
- [ ] F09 onboarding.state under the new fork name (fields eligible, intro, failed_starts, completed_at, profile)
- [ ] F10 Onboarding gate (all six phases; beginOnboardingFlow conditions)
- [ ] F11 Kickoff machine (all six states, one transient retry, skip exit on boot wait)
- [ ] F12 Metrics (guidePhaseTransition, signInTransition, closeOnboardingStep, recordOnboarding) and opt-in gate
- [ ] F13 Skip flow (intro skip, default-profile switch, cached skipped)
- [ ] F14 Intro copy and timing, intro view states
- [ ] F15 Handoff tour signpost (waits for rail, sessions, model pill)
- [ ] F16 First-contact prompt and initiate-setup opening and card order
- [ ] F17 E2E expectations (provider overlay, custom endpoint first chat, setup chat coverage added)
- [ ] F18 Guest-onboarding Electron gate and stay_alive decision
- [ ] F19 ui-tui setupHandoff unchanged or intentionally dropped
- [ ] F20 Provider picker and setup UI screens (duplicates resolved)
- [ ] F21 Setup chat layout, chips and connector hidden list

### Screens and copy
- [ ] S01 Provider picker overlay (index.tsx)
- [ ] S02 Free-tier ready panel (index.tsx)
- [ ] S03 Preparing panel (index.tsx)
- [ ] S04 Model/provider picker and provider rows (index.tsx, providers.tsx)
- [ ] S05 API key form (index.tsx)
- [ ] S06 Choose-later link (index.tsx)
- [ ] S07 Flow panel and subtitles (flow.tsx)
- [ ] S08 Device code (flow.tsx)
- [ ] S09 Confirming model (flow.tsx)
- [ ] S10 Free-tier setup notice, all failure variants (free-tier-setup-notice.tsx)
- [ ] S11 Glyph header and buttons (glyph.tsx)
- [ ] S12 Intro copy (intro-copy.tsx); hardcoded lines moved to i18n
- [ ] S13 Skip button and tip (skip.tsx); hardcoded strings moved to i18n
- [ ] S14 Handoff tour copy (signpost.ts, en_app_tour.ts)
- [ ] S15 Setup-chat chips and layout cards (chip.tsx, options.tsx)
- [ ] S16 Setup-chat notices (hardcoded strings: "Hermes is ready", "Runtime not ready", "Welcome chat needs attention")
- [ ] S17 Clarify setup pickers (setup-pickers.tsx)
- [ ] S18 Start-chat tool card (start-chat-tool.tsx)
- [ ] S19 Free-tier intro acknowledgement (onboarding.ts)

## 6. Port status (working log, not verification)

- Restored upstream `tui_gateway/methods_onboarding.py` and contract modules; regenerated `apps/shared/src/gateway-contract.generated.ts` and `.openrpc.json`.
- Removed fork-only `tui_gateway/methods_start_chat.py`, `tui_gateway/start_chat.py`, `tools/start_chat_tool.py`, `tools/setup_choose_tool.py`.
- `_TOOL_LIFECYCLE_UI_TOOLS` and `_LONG_HANDLERS` in `tui_gateway/server.py` reconciled to upstream plus fork-namespaced entries.
- F04–F09 Python RPCs ported to `tui_gateway/methods_fork_onboarding.py` as `fork.onboarding.{ensure_setup_profile,ensure_setup_session,state,record_failed_start,mark_seen,reset_setup_profile}`. Registration verified (no collision with upstream `onboarding.*`). Tests not yet ported or verified.
- Still open on Python side: F01 and F02/F03 (`setup_choose`, `start_chat`) are not rebuilt; `/initiate-setup` slash builtin (formerly in fork `methods_onboarding.py`) is not registered; `agent/initiate_setup_prompt.py`, `agent/initiate_setup_facts.py`, `agent/first_task_prompt.py` still reference `setup_choose`/`start_chat`; `hermes_cli/setup_profile.py` `_SETUP_TOOLSETS` still lists `start_chat`; `run_agent.py:260` and `agent/agent_init.py:2354` keep `setup_choose_callback`; `tests/tui_gateway/test_first_contact_onboarding.py`, `tests/hermes_cli/test_stream_json.py`, `tests/hermes_cli/test_tui_first_run_routing.py`, `tests/tools/test_setup_choose_name_card.py`, `tests/agent/test_onboarding.py` reference fork names.
- Desktop: not started (77 tsc errors from the earlier merge still stand).
- Merge fixes found by running the onboarding tests: restored `clear_named_profile_deleted` import and `SETUP_PROFILE_MARKER = ".setup-profile.json"` in `hermes_cli/profiles.py` (fork constant, HEAD:111; core touchpoint); `agent/initiate_setup_facts.py` Spark check now uses upstream `products.nvidia_platform()` (upstream removed `is_nvidia_arm_soc`).
- Verified green after these fixes: `tests/hermes_cli/test_onboarding_run.py`, `tests/tui_gateway/test_onboarding_run_rpc.py`, `tests/hermes_cli/test_setup_profile_answers.py`.
- Open test failure: `tests/tui_gateway/test_profiles_list_delete_race.py::test_concurrent_profile_use_cannot_restore_retired_name` (profile lifecycle fence, not onboarding-specific). Not yet investigated against HEAD.
- Not yet run: the full `tests/tui_gateway/` suite with no `-x` (an earlier `-x` run surfaced `session.delete` failing with `ProfileDB` missing `get_session_model_config_value`, a fork DB method likely lost in the merge).
