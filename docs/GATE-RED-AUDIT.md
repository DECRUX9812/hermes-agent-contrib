# Gate-red audit — the 32 failing test files, classified (2026-10-30)

Source: `/tmp/ship-p0.log` from the post-consolidation `sync-deploy.sh ship` gate
(32 files, 61 assertions of 12,582). Each row: the failing assertion and a verdict.
**Spec moved** = the app's behaviour changed deliberately and the test still
asserts the old rule. **Needs code read** = cannot decide from the assertion alone.
**Behaviour suspect** = smells like a real break, fix the code not the test.

## Root causes (deliberate changes carry most of it)

- `fc94068435` — Graphite is the default skin, `paper` retired. Every
  `nous-*`/`paper`/`simple` assertion that followed moved with it.
- `9b531b4567` + `f8046c204b`/`3b3f8afff3` — left-pane facelift and titlebar
  cluster rework: quiet captions, renamed strips, "More" label, browser glyph.
  Every test querying `Sessions`, `Artifacts`, `Search sessions…`, or the old
  sidebar button names is asserting pre-facelift chrome.
- Interface default flipped to Simple (same sweep) — every `advanced` default
  expectation moved.

## Verdicts, file by file

| file | assertion | verdict |
|---|---|---|
| themes/persist-accent ×2 | expected `graphite` to be `nous` | spec moved (fc94068) |
| themes/classic-skin ×2 | expected `graphite` to be `nous` | spec moved (fc94068) |
| store/appearance-apply | `graphite-accent-8a2be2` vs `nous-accent-*` | spec moved |
| themes/backend-sync | default-named skin key undefined | spec moved (default rename) |
| session …/theme-requests | set_theme picker card | spec moved |
| store/interface-mode ×4 | `simple` vs `advanced` defaults | spec moved (Simple default) |
| pane-shell/tree/mode-layout-memory | `simple` vs `advanced` | spec moved |
| pane-shell/edit-mode | hidden reveal = Advanced-only | spec moved |
| chat/sidebar/chat-sidebar ×5 | `Sessions`, `Artifacts`, `Search sessions…` not found | spec moved (facelift rename) |
| shell/titlebar-controls ×2 | `Show/Hide right sidebar` buttons gone | spec moved (titlebar rework) |
| i18n/overlay-completeness | `ar: titlebar.moreActions` +7 new keys | spec moved (update known-gaps list) |
| pane-shell/tree/hide-only-strip-tabs | `hermes-bots:pane` not in hides | spec moved (pane id → routines) |
| pane-shell/tree/side-collapse-persistence | `minimized: undefined` fields | spec moved (shape drift) |
| store/profile-rail-prefs ×2 | `{picker:true}` vs `{dropdown:true}` | spec moved (door UI → picker) |
| shell/../floating-panes ×2 | `48px` vs `46px`, `188` vs `186` | spec moved (chrome metrics, fc94068) |
| pane-shell …/floating-mode-memory | `37px` equality | spec moved (same metrics) |
| status-stack/subagent-section ×3 | `N Subagent(s)` button missing | spec moved (renamed section) |
| status-stack/subagent-hydration | same | spec moved |
| status-stack/default-collapse | same | spec moved |
| chat/close-tab | suite load: mock lacks `$activeGatewayProfile` | spec moved (mock drift) |
| sdk/settings | persistence schema shape | spec moved |
| gateway/…/primary-reauth-notice | `Open Gateways` count | spec moved (dedupe) |
| terminal-drop ×6 | unquotable-shell refusal strings | spec moved (deliberate safety default) |
| pane-shell …/tool-panel-close ×4 | pointerdown on missing element + null | needs code read (menu moved or dropped?) |
| pane-shell …/collapse-restore-affordance ×2 | pointerdown — no DOM element | needs code read (gutter removed in facelift?) |
| pane-shell …/tree-group ×3 | `+0` vs `5`, null | needs code read (hide-tabs persist) |
| store/panes ×2 | width/open persist → null | needs code read (persist write path) |
| store/sidebar-collapse-persistence ×2 | null vs `[review]` | needs code read |
| store/statusbar-prefs ×2 | bar visibility inverted | needs code read |
| settings/file-browser-setting | toggle persist false | needs code read |
| pane-shell/tree/dock-enforce | stacked Bots pane not re-homed | needs code read |
| touch-styles | `diff-lines` rule unscoped to browser host | behaviour suspect (missing scope on real rule) |

## Fix order

1. **Spec-moved sweep (~26 files)**: update assertions to the new rules —
   graphite skin ids, Simple default, facelift labels, routines pane id,
   new chrome metrics, known-gaps i18n list, the profile-door picker shape.
2. **Needs-read sweep (~8 files)**: pane persistence + affordance cluster —
   this is where a real regression could hide; read the persist write path
   and the strip-gutter render before touching tests.
3. **touch-styles**: add the missing `html[data-hermes-desktop-host=browser]`
   scope to the `diff-lines` rule — likely the only real code fix in the set.
