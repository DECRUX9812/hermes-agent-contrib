/** Overlay styles — injected into the shadow root. Everything is prefixed
 *  `hr-` and the host is `all: initial`-boxed so page CSS can't bleed in.
 *
 *  Design language: "premium toy" — deep frosted glass, hairline borders,
 *  generous radii, per-bot accent threading, spring motion. */
export const OVERLAY_CSS = `
:host {
  all: initial;
  /* design tokens — must live on :host; :root doesn't exist inside a shadow tree */
  --glass: rgba(13, 15, 23, 0.8);
  --glass-solid: rgba(13, 15, 23, 0.92);
  --hairline: rgba(255, 255, 255, 0.09);
  --hairline-soft: rgba(255, 255, 255, 0.055);
  --ink: #eceef6;
  --ink-dim: #a6abc0;
  --ink-faint: #6e7390;
  --accent: #7c5cff;
  --accent-soft: rgba(124, 92, 255, 0.22);
  --mint: #4ef0c0;
  --danger: #ff5d7a;
  --shadow-lg: 0 24px 70px rgba(0, 0, 0, 0.55), 0 6px 18px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.07);
  --spring: cubic-bezier(0.2, 0.9, 0.25, 1.15);
}
* { box-sizing: border-box; font-family: -apple-system, 'SF Pro', Inter, system-ui, sans-serif; }

.hr-canvas {
  position: fixed; inset: 0; width: 100vw; height: 100vh;
  pointer-events: none; z-index: 2147483640;
}

/* ── mascot hit rects + name chips ── */
.hr-hit {
  position: fixed; width: 80px; height: 80px; z-index: 2147483642;
  cursor: grab; pointer-events: auto; touch-action: none;
  transform: translate(-50%, -50%);
  border-radius: 50%;
}
.hr-hit:active { cursor: grabbing; }
.hr-hit .hr-name {
  position: absolute; left: 50%; top: calc(100% - 6px); transform: translateX(-50%) translateY(4px) scale(.92);
  padding: 4px 11px; border-radius: 999px;
  background: var(--glass-solid); color: var(--ink); font-size: 11px;
  font-weight: 650; white-space: nowrap; letter-spacing: .01em;
  opacity: 0; transition: opacity .16s, transform .16s var(--spring); pointer-events: none;
  backdrop-filter: blur(12px); border: 1px solid var(--hairline);
  box-shadow: 0 6px 20px rgba(0,0,0,.4);
}
.hr-hit:hover .hr-name, .hr-hit.dragging .hr-name { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
.hr-hit.dragging { cursor: grabbing; }
.hr-hit .hr-badge {
  position: absolute; right: 4px; top: 4px; min-width: 17px; height: 17px;
  border-radius: 9px; background: var(--danger); color: #fff; font-size: 10px;
  font-weight: 700; display: none; align-items: center; justify-content: center;
  padding: 0 5px; box-shadow: 0 0 0 3px rgba(255,93,122,.22), 0 2px 6px rgba(0,0,0,.4);
}
.hr-hit.working .hr-badge { display: flex; animation: hr-badge-pulse 1.4s infinite; }
@keyframes hr-badge-pulse { 50% { box-shadow: 0 0 0 6px rgba(255,93,122,.14), 0 2px 6px rgba(0,0,0,.4); } }

/* ── chat panels ── */
.hr-panel {
  position: fixed; z-index: 2147483644; width: 320px;
  background: var(--glass); border: 1px solid var(--hairline);
  border-radius: 20px; color: var(--ink); font-size: 13px;
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(22px) saturate(1.4); -webkit-backdrop-filter: blur(22px) saturate(1.4);
  overflow: hidden; pointer-events: auto;
  display: flex; flex-direction: column;
  animation: hr-pop .28s var(--spring);
  transform-origin: top center;
}
@keyframes hr-pop { from { transform: scale(.9) translateY(10px); opacity: 0; } }

.hr-panel-head {
  display: flex; align-items: center; gap: 10px; padding: 12px 14px 10px;
}
.hr-avatar {
  width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
  box-shadow: 0 0 0 2px var(--hairline), 0 2px 8px rgba(0,0,0,.35);
  background: #22253a; object-fit: cover;
}
.hr-avatar.hr-avatar-txt {
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700;
}
.hr-panel-head .hr-meta { flex: 1; min-width: 0; }
.hr-panel-head .hr-title { font-weight: 680; font-size: 13.5px; letter-spacing: -.01em; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hr-panel-head .hr-status { font-size: 10.5px; color: var(--ink-dim); display: flex; align-items: center; gap: 5px; margin-top: 1px; }
.hr-panel-head .hr-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; box-shadow: 0 0 6px currentColor; }
.hr-panel-x {
  background: rgba(255,255,255,.05); border: 1px solid transparent; color: var(--ink-dim);
  cursor: pointer; font-size: 12px; width: 26px; height: 26px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  transition: all .15s;
}
.hr-panel-x:hover { background: rgba(255,93,122,.18); color: #ffb3c0; border-color: rgba(255,93,122,.3); }

.hr-panel-log {
  flex: 1; min-height: 56px; max-height: 300px; overflow-y: auto;
  padding: 4px 12px 10px; display: flex; flex-direction: column; gap: 7px;
  scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.16) transparent;
}
.hr-panel-log::-webkit-scrollbar { width: 5px; }
.hr-panel-log::-webkit-scrollbar-thumb { background: rgba(255,255,255,.16); border-radius: 3px; }

.hr-msg {
  max-width: 86%; padding: 8px 12px; border-radius: 16px; line-height: 1.45; font-size: 12.5px;
  animation: hr-msg-in .22s var(--spring); overflow-wrap: break-word;
}
@keyframes hr-msg-in { from { transform: translateY(6px); opacity: 0; } }
.hr-msg.user {
  align-self: flex-end; color: #fff; border-bottom-right-radius: 5px;
  background: linear-gradient(135deg, #6a51ff 0%, #8a5cff 100%);
  box-shadow: 0 3px 14px rgba(106, 81, 255, 0.35);
}
.hr-msg.bot {
  align-self: flex-start; background: rgba(255,255,255,.075);
  border: 1px solid var(--hairline-soft); border-bottom-left-radius: 5px;
}
.hr-msg .hr-who { font-size: 10px; margin-bottom: 2px; font-weight: 680; letter-spacing: .02em; }
.hr-msg.sys {
  align-self: center; background: none; color: var(--ink-faint); font-size: 10.5px;
  padding: 2px 10px; border: 0; text-align: center;
}

/* typing — three real dots */
.hr-msg.typing { display: flex; align-items: center; gap: 7px; padding: 10px 13px; }
.hr-msg.typing .hr-who { margin-bottom: 0; }
.hr-dots { display: inline-flex; gap: 4px; }
.hr-dots i {
  width: 5px; height: 5px; border-radius: 50%; background: var(--ink-dim);
  animation: hr-dot-bounce 1.1s infinite;
}
.hr-dots i:nth-child(2) { animation-delay: .15s; }
.hr-dots i:nth-child(3) { animation-delay: .3s; }
@keyframes hr-dot-bounce { 0%, 60%, 100% { transform: translateY(0); opacity: .5; } 30% { transform: translateY(-4px); opacity: 1; } }

/* target chip */
.hr-target-chip {
  display: flex; align-items: center; gap: 7px; margin: 0 12px 8px;
  padding: 6px 10px; background: var(--accent-soft); border: 1px solid rgba(124,92,255,.35);
  border-radius: 10px; font-size: 11px; font-weight: 550; color: #cabdff;
  animation: hr-msg-in .2s var(--spring);
}
.hr-target-chip .hr-x { margin-left: auto; cursor: pointer; opacity: .65; font-size: 11px; padding: 0 2px; }
.hr-target-chip .hr-x:hover { opacity: 1; }

/* composer — one pill, controls inside */
.hr-composer { padding: 8px 12px 12px; }
.hr-compose-pill {
  display: flex; align-items: flex-end; gap: 6px;
  background: rgba(0,0,0,.3); border: 1px solid var(--hairline);
  border-radius: 20px; padding: 5px 5px 5px 13px;
  transition: border-color .18s, box-shadow .18s;
}
.hr-compose-pill:focus-within { border-color: rgba(124,92,255,.6); box-shadow: 0 0 0 3px rgba(124,92,255,.16); }
.hr-compose-pill textarea {
  flex: 1; resize: none; border: 0; background: none; outline: none;
  color: var(--ink); padding: 4px 0 5px; font-size: 13px; line-height: 1.35;
  font-family: inherit; min-height: 22px; max-height: 96px;
  user-select: text; -webkit-user-modify: read-write; caret-color: #a78bff;
}
.hr-compose-pill textarea::placeholder { color: var(--ink-faint); }
.hr-btn {
  border: 0; border-radius: 50%; width: 30px; height: 30px; cursor: pointer; flex-shrink: 0;
  background: rgba(255,255,255,.07); color: var(--ink-dim); font-size: 13px;
  display: flex; align-items: center; justify-content: center; transition: all .15s;
}
.hr-btn:hover { background: rgba(255,255,255,.13); color: var(--ink); transform: scale(1.06); }
.hr-btn.send { background: linear-gradient(135deg, #6a51ff, #8a5cff); color: #fff; opacity: .55; }
.hr-btn.send.ready { opacity: 1; box-shadow: 0 2px 10px rgba(106,81,255,.45); }
.hr-btn.mic.on { background: var(--danger); color: #fff; animation: hr-pulse 1.2s infinite; }
@keyframes hr-pulse { 50% { box-shadow: 0 0 0 7px rgba(255,93,122,.2); } }

/* ── launcher ── */
.hr-launcher {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483641;
  width: 48px; height: 48px; border-radius: 50%; pointer-events: auto;
  background: var(--glass); border: 1px solid var(--hairline);
  box-shadow: var(--shadow-lg); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(16px); transition: transform .18s var(--spring), box-shadow .18s;
}
.hr-launcher:hover { transform: scale(1.1); box-shadow: 0 24px 70px rgba(0,0,0,.55), 0 0 0 4px rgba(124,92,255,.2); }
.hr-launcher:active { transform: scale(.97); }
.hr-launcher svg { width: 27px; height: 27px; }
.hr-launcher { color: var(--ink); }

/* ── room tray — rooms + add inside one floating pill ── */
.hr-tray {
  position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%);
  z-index: 2147483641; display: flex; align-items: center; gap: 6px;
  padding: 6px; pointer-events: auto;
  background: var(--glass); border: 1px solid var(--hairline);
  border-radius: 999px; backdrop-filter: blur(16px);
  box-shadow: var(--shadow-lg);
  animation: hr-tray-in .3s var(--spring);
}
@keyframes hr-tray-in { from { transform: translateX(-50%) translateY(14px); opacity: 0; } }
.hr-roombar { display: flex; gap: 6px; }
.hr-room {
  display: flex; align-items: center; gap: 7px; padding: 6px 13px 6px 7px;
  background: rgba(255,255,255,.055); border: 1px solid var(--hairline-soft);
  border-radius: 999px; color: var(--ink); font-size: 12px; font-weight: 600; cursor: pointer;
  transition: all .16s;
}
.hr-room:hover { background: rgba(124,92,255,.16); border-color: rgba(124,92,255,.45); transform: translateY(-1px); }
.hr-room .hr-faces { display: flex; }
.hr-room .hr-face {
  width: 22px; height: 22px; border-radius: 50%; margin-left: -7px;
  border: 2px solid #191c28; display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; color: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.4);
}
.hr-room .hr-face:first-child { margin-left: 0; }
.hr-room .hr-unread {
  min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px;
  background: var(--accent); color: #fff; font-size: 9.5px; font-weight: 700;
  display: none; align-items: center; justify-content: center;
}
.hr-room .hr-unread.on { display: flex; }

.hr-addroom {
  width: 34px; height: 34px; border-radius: 50%; border: 1.5px dashed rgba(255,255,255,.28);
  background: none; color: var(--ink-dim); font-size: 17px; line-height: 1;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all .16s;
}
.hr-addroom:hover { border-color: var(--accent); color: #fff; background: var(--accent-soft); }

/* ── drag targeting ── */
.hr-dropzone {
  position: fixed; inset: 0; z-index: 2147483639; pointer-events: none;
  background: radial-gradient(ellipse at center, rgba(124,92,255,.05) 0%, rgba(10,12,20,.28) 100%);
  opacity: 0; transition: opacity .18s;
}
.hr-dropzone.on { opacity: 1; }
.hr-dropzone .hr-dz-label {
  position: absolute; left: 50%; top: 20px; transform: translateX(-50%);
  background: var(--glass-solid); color: var(--ink); padding: 9px 18px;
  border-radius: 999px; font-size: 12px; font-weight: 650; letter-spacing: .01em;
  border: 1px solid var(--hairline); box-shadow: var(--shadow-lg);
}
.hr-dropzone .hr-dz-label b { color: var(--mint); }

.hr-eloutline {
  position: fixed; z-index: 2147483643; pointer-events: none;
  border: 2px solid var(--mint); border-radius: 8px;
  background: rgba(78,240,192,.1); transition: all .1s;
  box-shadow: 0 0 0 4px rgba(78,240,192,.12), 0 0 24px rgba(78,240,192,.25);
}
.hr-ghost {
  position: fixed; z-index: 2147483645; pointer-events: none;
  font-size: 11px; font-weight: 600; color: var(--ink); background: var(--glass-solid);
  padding: 5px 11px; border-radius: 999px; transform: translate(-50%, -130%);
  border: 1px solid var(--hairline); box-shadow: 0 6px 20px rgba(0,0,0,.45);
  white-space: nowrap;
}

/* ── overlay windows ── */
.hr-window {
  position: fixed; z-index: 2147483643; pointer-events: auto; display: flex;
  flex-direction: column; overflow: hidden; border-radius: 20px;
  background: var(--glass); border: 1px solid var(--hairline);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(24px) saturate(1.4); -webkit-backdrop-filter: blur(24px) saturate(1.4);
  color: var(--ink);
  animation: hr-win-in .3s var(--spring);
  transform-origin: center 40%;
}
@keyframes hr-win-in { from { transform: scale(.82) translateY(24px); opacity: 0; } }
.hr-window.hr-win-sm { border-radius: 16px; }
.hr-window.hr-win-full { border-radius: 16px; }
.hr-window.hr-win-full .hr-win-head { cursor: default; }

.hr-win-head {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px; cursor: grab;
  border-bottom: 1px solid var(--hairline-soft); user-select: none; flex-shrink: 0;
}
.hr-win-head:active { cursor: grabbing; }
.hr-win-dots { display: flex; gap: 7px; align-items: center; }
.hr-win-btn {
  width: 13px; height: 13px; border-radius: 50%; border: 0; cursor: pointer;
  padding: 0; font-size: 0; position: relative; transition: transform .12s;
}
.hr-win-btn:hover { transform: scale(1.15); }
.hr-win-btn[data-a="close"] { background: #ff5f57; box-shadow: inset 0 0 0 .5px rgba(0,0,0,.2); }
.hr-win-btn[data-a="shrink"] { background: #febc2e; box-shadow: inset 0 0 0 .5px rgba(0,0,0,.2); }
.hr-win-btn[data-a="grow"] { background: #28c840; box-shadow: inset 0 0 0 .5px rgba(0,0,0,.2); }
.hr-win-btn[data-a="full"] { background: #7c5cff; box-shadow: inset 0 0 0 .5px rgba(0,0,0,.2); }
.hr-win-dots:hover .hr-win-btn::after {
  content: attr(data-g); position: absolute; inset: 0;
  font-size: 9px; font-weight: 700; color: rgba(0,0,0,.6);
  display: flex; align-items: center; justify-content: center; line-height: 1;
}
.hr-win-title {
  flex: 1; font-size: 12px; font-weight: 650; letter-spacing: -.01em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-dim);
}
.hr-win-body { flex: 1; overflow: auto; position: relative; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.16) transparent; }
.hr-win-body::-webkit-scrollbar { width: 5px; }
.hr-win-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,.16); border-radius: 3px; }
.hr-win-body iframe { width: 100%; height: 100%; border: 0; display: block; }
.hr-resize {
  position: absolute; right: 3px; bottom: 3px; width: 18px; height: 18px;
  cursor: nwse-resize; opacity: .4; border-radius: 4px;
  background:
    linear-gradient(135deg, transparent 50%, rgba(255,255,255,.35) 50%, rgba(255,255,255,.35) 55%, transparent 55%, transparent 65%, rgba(255,255,255,.35) 65%, rgba(255,255,255,.35) 70%, transparent 70%);
}
.hr-resize:hover { opacity: .9; }

.hr-thought { padding: 16px 18px; font-size: 14px; line-height: 1.55; }
.hr-html { padding: 14px 16px; font-size: 13px; line-height: 1.55; }

/* feed widget — vertical card scroller */
.hr-feed { padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.hr-card {
  display: flex; gap: 11px; padding: 9px; border-radius: 14px;
  background: rgba(255,255,255,.045); border: 1px solid var(--hairline-soft);
  align-items: center; transition: all .16s;
}
.hr-card:hover { background: rgba(255,255,255,.09); transform: translateX(3px); border-color: var(--hairline); }
.hr-card img { width: 72px; height: 48px; object-fit: cover; border-radius: 9px; flex-shrink: 0; }
.hr-thumb {
  width: 72px; height: 48px; border-radius: 9px; flex-shrink: 0; position: relative;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, rgba(124,92,255,.4), rgba(78,240,192,.22));
  color: rgba(255,255,255,.85); font-size: 15px; overflow: hidden;
}
.hr-thumb img { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 0; }
.hr-card-txt { flex: 1; min-width: 0; }
.hr-card-title { font-size: 12.5px; font-weight: 620; letter-spacing: -.01em; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.hr-card-sub { font-size: 11px; color: var(--ink-dim); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hr-card-badge {
  font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 999px;
  background: var(--accent-soft); color: #cabdff; flex-shrink: 0; letter-spacing: .02em;
}

/* search widget */
.hr-search { padding: 10px; display: flex; flex-direction: column; gap: 8px; height: 100%; }
.hr-search input {
  background: rgba(0,0,0,.28); border: 1px solid var(--hairline);
  border-radius: 12px; padding: 10px 13px; color: var(--ink); font-size: 13px;
  font-family: inherit; outline: none; transition: border-color .15s, box-shadow .15s;
}
.hr-search input:focus { border-color: rgba(124,92,255,.6); box-shadow: 0 0 0 3px rgba(124,92,255,.16); }
.hr-search input::placeholder { color: var(--ink-faint); }
.hr-search-results { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.hr-search-results .hr-card { cursor: default; }

/* ── context menu — right-click a mascot ── */
.hr-menu {
  position: fixed; z-index: 2147483646; min-width: 188px; padding: 6px;
  background: var(--glass-solid); border: 1px solid var(--hairline);
  border-radius: 14px; box-shadow: var(--shadow-lg);
  backdrop-filter: blur(24px) saturate(1.5);
  animation: hr-pop .18s var(--spring); transform-origin: top left;
  font-family: inherit;
}
.hr-menu-item {
  all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 7px 10px; border-radius: 9px; cursor: pointer;
  color: var(--ink); font-size: 12.5px; font-weight: 540;
  transition: background .1s;
}
.hr-menu-item:hover, .hr-menu-item.sel { background: rgba(255,255,255,.09); }
.hr-menu-item.danger { color: #ff8ba0; }
.hr-menu-item.danger:hover, .hr-menu-item.danger.sel { background: rgba(255,93,122,.14); }
.hr-menu-ic { width: 16px; text-align: center; font-size: 13px; opacity: .85; flex-shrink: 0; }
.hr-menu-txt { flex: 1; }
.hr-menu-hint { font-size: 10.5px; color: var(--ink-faint); flex-shrink: 0; }
.hr-menu-sep { height: 1px; background: var(--hairline-soft); margin: 5px 8px; }

/* ── command palette — launcher click, Raycast-style ── */
.hr-palette {
  position: fixed; right: 18px; bottom: 76px; z-index: 2147483646;
  width: 330px; max-height: min(480px, calc(100vh - 120px));
  background: var(--glass-solid); border: 1px solid var(--hairline);
  border-radius: 18px; box-shadow: var(--shadow-lg);
  backdrop-filter: blur(28px) saturate(1.6);
  animation: hr-pal-in .22s var(--spring); transform-origin: bottom right;
  display: flex; flex-direction: column; overflow: hidden;
  font-family: inherit;
}
@keyframes hr-pal-in { from { opacity: 0; transform: translateY(12px) scale(.96); } }
.hr-pal-box { display: flex; flex-direction: column; min-height: 0; }
.hr-pal-search {
  display: flex; align-items: center; gap: 9px; padding: 12px 14px;
  border-bottom: 1px solid var(--hairline-soft);
}
.hr-pal-mag { font-size: 16px; color: var(--accent); font-weight: 700; }
.hr-pal-search input {
  all: unset; flex: 1; color: var(--ink); font-size: 14px; font-family: inherit;
}
.hr-pal-search input::placeholder { color: var(--ink-faint); }
.hr-pal-list { overflow-y: auto; padding: 7px; min-height: 60px; }
.hr-pal-sec {
  font-size: 10px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase;
  color: var(--ink-faint); padding: 8px 10px 4px;
}
.hr-pal-item {
  all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 8px 10px; border-radius: 10px; cursor: pointer;
  color: var(--ink); font-size: 13px; font-weight: 540;
}
.hr-pal-item:hover, .hr-pal-item.sel { background: var(--accent-soft); }
.hr-pal-item.sel { box-shadow: inset 0 0 0 1px rgba(124,92,255,.35); }
.hr-pal-item.danger { color: #ff8ba0; }
.hr-pal-empty { padding: 18px; text-align: center; color: var(--ink-faint); font-size: 12px; }
.hr-pal-foot {
  display: flex; gap: 14px; padding: 9px 14px; border-top: 1px solid var(--hairline-soft);
  font-size: 10.5px; color: var(--ink-faint);
}
.hr-pal-foot b { color: var(--ink-dim); font-weight: 700; }
`
