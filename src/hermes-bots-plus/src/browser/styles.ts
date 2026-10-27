/** The Hermes Browser's stylesheet. Painted only from host theme tokens
 *  (`--ui-*`, `--radius-*`) so a theme switch repaints it; motion uses the
 *  same curves as the tool cards, and reduced motion / paused animations stop
 *  every transition and loop. */

const OUT_QUINT = 'cubic-bezier(0.22, 1, 0.36, 1)'
const STANDARD = 'cubic-bezier(0.2, 0, 0, 1)'
const SPRING = 'cubic-bezier(0.34, 1.36, 0.64, 1)'

const SURFACE = [
  '.hbb-shell{display:flex;flex-direction:column;height:100%;min-height:0;background-color:var(--ui-surface-background);color:var(--ui-text-primary)}',
  // Tab strip
  '.hbb-tabs{display:flex;align-items:flex-end;gap:2px;padding:6px 6px 0;background-color:var(--ui-bg-chrome);box-shadow:inset 0 -1px 0 var(--ui-stroke-tertiary);overflow-x:auto;scrollbar-width:none;flex:none}',
  '.hbb-tabs::-webkit-scrollbar{display:none}',
  `.hbb-tab{position:relative;display:flex;align-items:center;gap:6px;height:30px;min-width:3.5rem;max-width:14rem;flex:0 1 12rem;padding:0 4px 0 10px;border-radius:var(--radius-control,0.375rem) var(--radius-control,0.375rem) 0 0;color:var(--ui-text-tertiary);font-size:12px;line-height:16px;cursor:pointer;user-select:none;transition:background-color 140ms ${STANDARD},color 140ms ${STANDARD}}`,
  '.hbb-tab:hover{background-color:var(--ui-row-hover-background);color:var(--ui-text-secondary)}',
  ".hbb-tab[data-active='true']{background-color:var(--ui-surface-background);color:var(--ui-text-primary);box-shadow:inset 1px 0 0 var(--ui-stroke-tertiary),inset -1px 0 0 var(--ui-stroke-tertiary),inset 0 1px 0 var(--ui-stroke-tertiary)}",
  '.hbb-tab:focus-visible{outline:2px solid var(--ui-blue);outline-offset:-2px}',
  '.hbb-tab-label{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
  '.hbb-tab-icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none}',
  '.hbb-tab-x{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;flex:none;border-radius:var(--radius-control,0.375rem);color:var(--ui-text-tertiary);opacity:0;transition:opacity 120ms ease-out,background-color 120ms ease-out}',
  ".hbb-tab:hover .hbb-tab-x,.hbb-tab[data-active='true'] .hbb-tab-x,.hbb-tab-x:focus-visible{opacity:1}",
  '.hbb-tab-x:hover{background-color:var(--ui-control-hover-background);color:var(--ui-text-primary)}',
  '.hbb-tab-new{display:inline-flex;align-items:center;justify-content:center;width:28px;height:26px;margin:0 2px 2px;flex:none;border-radius:var(--radius-control,0.375rem);color:var(--ui-text-tertiary)}',
  '.hbb-tab-new:hover{background-color:var(--ui-row-hover-background);color:var(--ui-text-primary)}',
  // Toolbar
  '.hbb-bar{position:relative;display:flex;align-items:center;gap:2px;padding:6px 8px;flex:none;box-shadow:inset 0 -1px 0 var(--ui-stroke-tertiary)}',
  '.hbb-nav{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;border-radius:var(--radius-control,0.375rem);color:var(--ui-text-secondary);transition:background-color 120ms ease-out,color 120ms ease-out}',
  '.hbb-nav:hover:not(:disabled){background-color:var(--ui-control-hover-background);color:var(--ui-text-primary)}',
  '.hbb-nav:disabled{color:var(--ui-text-quaternary);cursor:default}',
  '.hbb-nav:focus-visible{outline:2px solid var(--ui-blue);outline-offset:-2px}',
  `.hbb-addr{display:flex;align-items:center;gap:6px;flex:1;min-width:0;height:30px;margin:0 4px;padding:0 6px 0 10px;border-radius:var(--radius-pill,999px);background-color:var(--ui-bg-input);box-shadow:inset 0 0 0 1px var(--ui-stroke-tertiary);transition:box-shadow 140ms ${STANDARD}}`,
  '.hbb-addr:focus-within{box-shadow:inset 0 0 0 1.5px var(--ui-blue)}',
  '.hbb-addr input{flex:1;min-width:0;height:100%;border:0;outline:0;background:transparent;color:var(--ui-text-primary);font-size:12.5px}',
  '.hbb-addr input::placeholder{color:var(--ui-text-quaternary)}',
  '.hbb-addr-icon{display:inline-flex;flex:none;color:var(--ui-text-tertiary)}',
  ".hbb-addr-icon[data-tone='secure']{color:var(--ui-green)}",
  ".hbb-addr-icon[data-tone='local']{color:var(--ui-blue)}",
  '.hbb-chip{display:inline-flex;align-items:center;gap:4px;flex:none;height:20px;padding:0 8px;border-radius:var(--radius-pill,999px);font-size:11px;white-space:nowrap;background-color:color-mix(in srgb,var(--ui-blue) 14%,transparent);color:var(--ui-blue);cursor:default}',
  '.hbb-chip-live{background-color:color-mix(in srgb,var(--ui-red) 12%,transparent);color:var(--ui-red)}',
  '.hbb-progress{position:absolute;left:0;bottom:0;height:2px;width:0;background-color:var(--ui-blue);opacity:0;pointer-events:none}',
  // Views
  '.hbb-body{position:relative;flex:1;min-height:0;overflow:hidden}',
  '.hbb-pane{position:absolute;inset:0}',
  ".hbb-pane[data-hidden='true']{visibility:hidden;pointer-events:none}",
  `.hbb-frame{position:absolute;inset:0;width:100%;height:100%;border:0;color-scheme:light;background-color:Canvas;opacity:0;transition:opacity 200ms ${STANDARD}}`,
  ".hbb-frame[data-ready='true']{opacity:1}",
  '.hbb-remote{position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:center;outline:0;background-color:var(--ui-bg-tertiary);overflow:hidden}',
  '.hbb-remote:focus-visible{box-shadow:inset 0 0 0 2px var(--ui-blue)}',
  '.hbb-remote img{display:block;max-width:100%;max-height:100%;object-fit:contain;object-position:top;user-select:none;-webkit-user-drag:none}',
  '.hbb-remote-hint{position:absolute;right:10px;bottom:10px}',
  // Center cards
  '.hbb-center{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;overflow:auto}',
  '.hbb-card{display:flex;flex-direction:column;align-items:center;gap:10px;max-width:27rem;text-align:center}',
  '.hbb-card h3{margin:0;font-size:14px;line-height:20px;font-weight:600;color:var(--ui-text-primary)}',
  '.hbb-card p{margin:0;font-size:12.5px;line-height:18px;color:var(--ui-text-tertiary)}',
  '.hbb-card-icon{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:999px;background-color:var(--ui-bg-quaternary);color:var(--ui-text-secondary);margin-bottom:2px}',
  ".hbb-card-icon[data-tone='warn']{background-color:color-mix(in srgb,var(--ui-orange) 14%,transparent);color:var(--ui-orange)}",
  ".hbb-card-icon[data-tone='info']{background-color:color-mix(in srgb,var(--ui-blue) 14%,transparent);color:var(--ui-blue)}",
  '.hbb-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin-top:6px}',
  '.hbb-suggest{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin-top:4px}',
  '.hbb-suggest button{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:var(--radius-pill,999px);font-size:12px;background-color:var(--ui-bg-quaternary);color:var(--ui-text-secondary);transition:background-color 120ms ease-out,color 120ms ease-out}',
  '.hbb-suggest button:hover{background-color:var(--ui-control-hover-background);color:var(--ui-text-primary)}',
  '.hbb-toggle{display:inline-flex;align-items:center;gap:8px;margin-top:10px;font-size:12px;color:var(--ui-text-tertiary);cursor:pointer}',
  '.hbb-toggle input{accent-color:var(--ui-blue)}',
  // Bot activity
  '.hbb-act{position:absolute;inset:0;display:flex;flex-direction:column;min-height:0}',
  '.hbb-act-status{display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:12.5px;line-height:18px;color:var(--ui-text-secondary);box-shadow:inset 0 -1px 0 var(--ui-stroke-tertiary);flex:none}',
  '.hbb-act-status strong{color:var(--ui-text-primary);font-weight:600}',
  '.hbb-act-status-text{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;border-radius:var(--radius-control,0.375rem)}',
  '.hbb-act-shot{position:relative;flex:1;min-height:8rem;background-color:var(--ui-bg-tertiary);overflow:hidden}',
  '.hbb-act-shot img{object-fit:contain!important}',
  '.hbb-act-foot{display:flex;align-items:center;gap:6px;padding:6px 10px;flex:none;box-shadow:inset 0 1px 0 var(--ui-stroke-tertiary)}',
  '.hbb-steps{display:flex;flex-direction:column;max-height:34%;overflow-y:auto;padding:4px;flex:none;box-shadow:inset 0 1px 0 var(--ui-stroke-tertiary)}',
  `.hbb-step{display:flex;align-items:center;gap:8px;min-height:28px;padding:4px 8px;border-radius:var(--radius-row,0.4375rem);font-size:12px;line-height:16px;color:var(--ui-text-tertiary);text-align:left;transition:background-color 120ms ease-out,color 120ms ease-out}`,
  '.hbb-step:hover{background-color:var(--ui-row-hover-background);color:var(--ui-text-secondary)}',
  ".hbb-step[data-selected='true']{background-color:var(--ui-row-active-background);color:var(--ui-text-primary)}",
  ".hbb-step[data-state='error'] .hbb-step-icon{color:var(--ui-red)}",
  ".hbb-step[data-state='running'] .hbb-step-icon{color:var(--ui-blue)}",
  '.hbb-step-icon{display:inline-flex;width:16px;justify-content:center;flex:none}',
  '.hbb-step-text{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
  '.hbb-step-host{flex:none;max-width:40%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--ui-text-quaternary)}',
  '.hbb-step-no{flex:none;width:18px;text-align:right;color:var(--ui-text-quaternary);font-variant-numeric:tabular-nums}'
]

// Floating window. It sits under the host's dialogs and menus (z 50) but over
// every view, and paints from the same tokens as the tab.
const SHADOW = 'color-mix(in srgb,var(--ui-text-primary) 16%,transparent)'

const FLOAT = [
  '.hbb-tabs-spacer{flex:1}',
  '.hbf-root{position:fixed;inset:0;pointer-events:none;z-index:45}',
  `.hbf-window{position:absolute;left:0;top:0;display:flex;flex-direction:column;pointer-events:auto;overflow:hidden;transform-origin:0 0;will-change:transform;contain:layout paint;border-radius:var(--radius-xl,0.75rem);background-color:var(--ui-surface-background);color:var(--ui-text-primary);box-shadow:0 0 0 1px var(--ui-stroke-secondary),0 18px 48px -12px ${SHADOW},0 6px 16px -8px ${SHADOW};transition:opacity 200ms ${STANDARD},visibility 0s}`,
  ".hbf-window[data-min='true']{pointer-events:none;visibility:hidden;transition:opacity 200ms ease-out,visibility 0s linear 240ms}",
  ".hbf-window[data-mode='left'],.hbf-window[data-mode='right']{border-radius:var(--radius-lg,0.5rem)}",
  '.hbf-title{display:flex;align-items:center;gap:6px;height:34px;flex:none;padding:0 4px 0 10px;background-color:var(--ui-bg-chrome);box-shadow:inset 0 -1px 0 var(--ui-stroke-tertiary);cursor:grab;user-select:none;touch-action:none}',
  ".hbf-root[data-gesture='true'] .hbf-title{cursor:grabbing}",
  '.hbf-title-icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none;color:var(--ui-text-secondary)}',
  '.hbf-title-text{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:12px;font-weight:500;color:var(--ui-text-secondary)}',
  '.hbf-title-spacer{flex:1}',
  '.hbf-live{width:7px;height:7px;flex:none;border-radius:999px;background-color:var(--ui-green);box-shadow:0 0 0 3px color-mix(in srgb,var(--ui-green) 22%,transparent)}',
  `.hbf-tbtn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;flex:none;border-radius:var(--radius-control,0.375rem);color:var(--ui-text-tertiary);transition:background-color 120ms ${STANDARD},color 120ms ${STANDARD}}`,
  '.hbf-tbtn:hover{background-color:var(--ui-control-hover-background);color:var(--ui-text-primary)}',
  ".hbf-tbtn[aria-pressed='true']{color:var(--ui-blue)}",
  '.hbf-tbtn:focus-visible,.hbf-lease:focus-visible,.hbf-pill:focus-visible{outline:2px solid var(--ui-blue);outline-offset:-2px}',
  `.hbf-lease{display:inline-flex;align-items:center;gap:5px;height:24px;flex:none;margin-right:4px;padding:0 9px;border-radius:var(--radius-pill,999px);font-size:11.5px;font-weight:500;background-color:color-mix(in srgb,var(--ui-blue) 14%,transparent);color:var(--ui-blue);transition:background-color 140ms ${STANDARD},color 140ms ${STANDARD}}`,
  '.hbf-lease:hover:not(:disabled){background-color:color-mix(in srgb,var(--ui-blue) 22%,transparent)}',
  ".hbf-lease[data-mine='true']{background-color:color-mix(in srgb,var(--ui-orange) 16%,transparent);color:var(--ui-orange)}",
  '.hbf-lease:disabled{opacity:0.7;cursor:default}',
  // A cloud browser: watch-only, so the take-over slot says so instead.
  ".hbf-lease[data-cloud='true']{background-color:var(--ui-row-hover-background);color:var(--ui-text-tertiary);opacity:1;cursor:help}",
  ".hbf-lease[data-cloud='true'][data-compact='true'] .hbf-lease-long{display:none}",
  ".hbf-lease[data-cloud='true'][data-compact='false'] .hbf-lease-short{display:none}",
  '.hbf-cloud-wrap{display:inline-flex}',
  // Bot browser settings (Settings > Plugins > Browser)
  '.hbs-page{display:flex;flex-direction:column;gap:12px;max-width:44rem}',
  '.hbs-intro{font-size:13px;line-height:20px;color:var(--ui-text-secondary)}',
  '.hbs-list{display:flex;flex-direction:column;border-radius:var(--radius-lg,0.5rem);box-shadow:inset 0 0 0 1px var(--ui-stroke-tertiary);overflow:hidden}',
  '.hbs-row{display:flex;align-items:center;gap:10px;min-height:48px;padding:8px 12px;font-size:13px}',
  '.hbs-row+.hbs-row{box-shadow:inset 0 1px 0 var(--ui-stroke-tertiary)}',
  '.hbs-name{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:500}',
  '.hbs-chip{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border-radius:var(--radius-pill,999px);font-size:11.5px;background-color:var(--ui-row-hover-background);color:var(--ui-text-secondary)}',
  ".hbs-chip[data-mode='local']{background-color:color-mix(in srgb,var(--ui-green) 14%,transparent);color:var(--ui-green)}",
  ".hbs-chip[data-mode='cloud']{background-color:color-mix(in srgb,var(--ui-blue) 12%,transparent);color:var(--ui-blue)}",
  `.hbs-act{height:28px;padding:0 10px;border-radius:var(--radius-control,0.375rem);font-size:12px;box-shadow:inset 0 0 0 1px var(--ui-stroke-secondary);color:var(--ui-text-primary);transition:background-color 140ms ${STANDARD}}`,
  '.hbs-act:hover:not(:disabled){background-color:var(--ui-row-hover-background)}',
  '.hbs-act:disabled{opacity:0.5}',
  '.hbs-act:focus-visible{outline:2px solid var(--ui-blue);outline-offset:1px}',
  '.hbs-note{font-size:12px;color:var(--ui-text-tertiary)}',
  // The remote page's key sink: focusable text field, invisible, never in the way.
  '.hbb-keysink{position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;resize:none;border:0;padding:0;overflow:hidden}',
  '.hbf-content{position:relative;flex:1;min-height:0}',
  ".hbf-root[data-gesture='true'] .hbf-content{pointer-events:none}",
  '.hbf-shield{position:fixed;inset:0;pointer-events:auto;background:transparent}',
  '.hbf-handle{position:absolute;pointer-events:auto;touch-action:none;z-index:2}',
  ".hbf-handle[data-dir='n']{top:-3px;left:10px;right:10px;height:7px;cursor:ns-resize}",
  ".hbf-handle[data-dir='s']{bottom:-3px;left:10px;right:10px;height:7px;cursor:ns-resize}",
  ".hbf-handle[data-dir='e']{right:-3px;top:10px;bottom:10px;width:7px;cursor:ew-resize}",
  ".hbf-handle[data-dir='w']{left:-3px;top:10px;bottom:10px;width:7px;cursor:ew-resize}",
  ".hbf-handle[data-dir='ne']{right:-3px;top:-3px;width:14px;height:14px;cursor:nesw-resize}",
  ".hbf-handle[data-dir='sw']{left:-3px;bottom:-3px;width:14px;height:14px;cursor:nesw-resize}",
  ".hbf-handle[data-dir='nw']{left:-3px;top:-3px;width:14px;height:14px;cursor:nwse-resize}",
  ".hbf-handle[data-dir='se']{right:-3px;bottom:-3px;width:14px;height:14px;cursor:nwse-resize}",
  `.hbf-dock-hint{position:absolute;top:12px;bottom:12px;width:min(460px,40vw);border-radius:var(--radius-lg,0.5rem);background-color:color-mix(in srgb,var(--ui-blue) 10%,transparent);box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--ui-blue) 45%,transparent);animation:hbf-hint 180ms ${OUT_QUINT} both}`,
  ".hbf-dock-hint[data-side='left']{left:12px}",
  ".hbf-dock-hint[data-side='right']{right:12px}",
  `.hbf-pill{position:absolute;display:inline-flex;align-items:center;gap:7px;height:32px;max-width:15rem;padding:0 12px 0 10px;pointer-events:auto;border-radius:var(--radius-pill,999px);background-color:var(--ui-bg-elevated);color:var(--ui-text-primary);font-size:12px;box-shadow:0 0 0 1px var(--ui-stroke-secondary),0 10px 28px -10px ${SHADOW};cursor:pointer;animation:hbf-pill-in 420ms ${SPRING} both;transition:background-color 140ms ${STANDARD}}`,
  '.hbf-pill:hover{background-color:var(--ui-bg-tertiary)}',
  ".hbf-pill[data-right='true']{right:16px}",
  ".hbf-pill[data-right='false']{left:16px}",
  ".hbf-pill[data-bottom='true']{bottom:16px}",
  ".hbf-pill[data-bottom='false']{top:16px}",
  '.hbf-pill-text{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}'
]

const MOTION = [
  `.hbb-tab[data-fresh='true']{animation:hbb-tab-in 220ms ${OUT_QUINT} both}`,
  `.hbb-enter{animation:hbb-enter 220ms ${OUT_QUINT} both}`,
  `.hbb-progress[data-state='loading']{opacity:1;animation:hbb-progress 6s ${OUT_QUINT} forwards}`,
  `.hbb-progress[data-state='done']{width:100%;opacity:0;transition:width 160ms ${STANDARD},opacity 260ms ease-out 140ms}`
]

const KEYFRAMES = [
  '@keyframes hbb-tab-in{from{opacity:0;transform:translateY(4px) scale(0.97)}to{opacity:1;transform:none}}',
  '@keyframes hbb-enter{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
  '@keyframes hbf-pill-in{from{opacity:0;transform:scale(0.6)}to{opacity:1;transform:none}}',
  '@keyframes hbf-hint{from{opacity:0;transform:scaleX(0.92)}to{opacity:1;transform:none}}',
  "@keyframes hbf-live{0%,100%{opacity:1}50%{opacity:0.45}}",
  '@keyframes hbb-progress{0%{width:0}20%{width:35%}60%{width:70%}100%{width:88%}}'
]

const QUIET = [
  '@media (prefers-reduced-motion: reduce){.hbf-pill,.hbf-dock-hint{animation:none}.hbf-window{transition:none}}',
  '@media (prefers-reduced-motion: no-preference){.hbf-live{animation:hbf-live 1.6s ease-in-out infinite}}',
  ':root[data-renderer-animations-paused] :is(.hbf-live,.hbf-pill){animation-play-state:paused}',
  '@media (prefers-reduced-motion: reduce){.hbb-tab,.hbb-frame,.hbb-addr,.hbb-step,.hbb-nav{transition:none}.hbb-tab[data-fresh],.hbb-enter{animation:none}.hbb-progress[data-state=loading]{animation:none;width:60%}}',
  ':root[data-renderer-animations-paused] :is(.hbb-progress,.hbb-enter,.hbb-tab){animation-play-state:paused}'
]

export function browserStyleSheet(): string {
  return `@layer utilities{${[...SURFACE, ...FLOAT, ...MOTION].join('')}}${KEYFRAMES.join('')}${QUIET.join('')}`
}
