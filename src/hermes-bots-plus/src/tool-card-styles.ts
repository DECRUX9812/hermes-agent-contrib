/** The Bot Chat tool cards' own stylesheet: the motion loops that used to sit
 *  in the host's motion.css, plus the few surface utilities only the cards
 *  used. Everything is painted from host theme tokens (`--ui-*`, `--radius-*`)
 *  so a theme switch repaints it; timings are literals because the host's
 *  motion tokens left with the cards. Reduced motion and the renderer's
 *  animation pause still stop every loop. */

const SPRING = 'cubic-bezier(0.34, 1.36, 0.64, 1)'
const STANDARD = 'cubic-bezier(0.2, 0, 0, 1)'
const OUT_QUINT = 'cubic-bezier(0.22, 1, 0.36, 1)'

const UTILITIES = [
  '.hbp-tc-muted{color:var(--ui-text-tertiary)}',
  '.hbp-tc-subtle{color:var(--ui-text-quaternary)}',
  '.hbp-tc-hover-fg:hover{color:var(--ui-text-primary)}',
  '.hbp-tc-info{color:var(--ui-blue)}',
  '.hbp-tc-sunken{background-color:var(--ui-bg-quaternary)}',
  '.hbp-tc-hover:hover{background-color:var(--ui-row-hover-background)}',
  '.hbp-tc-selected{background-color:var(--ui-row-active-background);color:var(--ui-text-primary)}',
  '.hbp-tc-rc{border-radius:var(--radius-control,0.375rem)}',
  '.hbp-tc-rr{border-radius:var(--radius-row,0.4375rem)}',
  '.hbp-tc-pl12{padding-left:3rem}',
  '.hbp-tc-top{object-position:top}',
  '.hbp-tc-face{box-shadow:0 0 0 2px var(--ui-bg-elevated)}',
  `.hbp-tc-surface{transition-property:background-color,border-color,box-shadow,padding,min-height;transition-duration:180ms;transition-timing-function:${SPRING}}`,
  '.hbp-tc-reveal{opacity:0;transition:opacity 120ms ease-out}',
  '.hbp-tc-row:hover .hbp-tc-reveal,.hbp-tc-reveal:focus-visible{opacity:1}',
  '.hbp-lv-badge{background-color:var(--ui-bg-elevated);color:var(--ui-text-primary);box-shadow:0 0 0 1px var(--ui-bg-quaternary)}',
  '.hbp-lv-dot{background-color:var(--ui-red)}',
  '.hbp-lv-zoom{opacity:0;transition:opacity 120ms ease-out}',
  '.hbp-lv-frame:hover .hbp-lv-zoom,.hbp-lv-frame:focus-visible .hbp-lv-zoom{opacity:1}'
]

const MOTION = [
  `.hbp-tc-arrive{animation:hbp-tc-arrive 200ms ${OUT_QUINT} both}`,
  '.hbp-tc-ring{position:relative;isolation:isolate}',
  '.hbp-tc-ring::after{content:"";position:absolute;inset:-2px;border-radius:inherit;border:2px solid currentColor;opacity:0;pointer-events:none;animation:hbp-tc-ring 1.6s cubic-bezier(0.25,0.6,0.3,1) infinite;will-change:transform,opacity}',
  '.hbp-tc-shimmer{position:relative;overflow:hidden}',
  '.hbp-tc-shimmer::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,transparent 0%,color-mix(in oklab,var(--ui-chat-surface-background) 70%,transparent) 50%,transparent 100%);transform:translateX(-100%);animation:hbp-tc-shimmer 1.8s linear infinite;will-change:transform}',
  '.hbp-tc-typing>span{animation:hbp-tc-typing 1.2s ease-in-out infinite;will-change:transform,opacity}',
  '.hbp-tc-typing>span:nth-child(2){animation-delay:0.15s}',
  '.hbp-tc-typing>span:nth-child(3){animation-delay:0.3s}',
  `.hbp-tc-collapse{display:grid;grid-template-rows:0fr;opacity:0;transition:grid-template-rows 180ms ${STANDARD},opacity 180ms ${STANDARD}}`,
  ".hbp-tc-collapse[data-open='true']{grid-template-rows:1fr;opacity:1}",
  '.hbp-tc-collapse>*{min-height:0;overflow:hidden}',
  `.hbp-lv-layer{opacity:0;transition:opacity 180ms ${STANDARD}}`,
  ".hbp-lv-layer[data-ready='true']{opacity:1}",
  '.hbp-lv-dot{animation:hbp-lv-pulse 1.6s ease-in-out infinite}',
  `::view-transition-group(hbp-shot-morph){animation-duration:260ms;animation-timing-function:${OUT_QUINT}}`,
  '::view-transition-old(hbp-shot-morph),::view-transition-new(hbp-shot-morph){height:100%;object-fit:contain}'
]

const KEYFRAMES = [
  '@keyframes hbp-tc-arrive{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
  '@keyframes hbp-tc-ring{0%{opacity:0.55;transform:scale(1)}100%{opacity:0;transform:scale(1.18)}}',
  '@keyframes hbp-tc-shimmer{from{transform:translateX(-100%)}to{transform:translateX(100%)}}',
  '@keyframes hbp-lv-pulse{0%,100%{opacity:1}50%{opacity:0.35}}',
  '@keyframes hbp-tc-typing{0%,60%,100%{opacity:0.35;transform:translateY(0)}30%{opacity:1;transform:translateY(-2px)}}'
]

const QUIET = [
  '@media (prefers-reduced-motion: reduce){.hbp-tc-ring::after,.hbp-tc-shimmer::after,.hbp-tc-typing>span,.hbp-tc-arrive{animation:none!important}.hbp-tc-ring::after{opacity:0.55}.hbp-tc-shimmer::after{display:none}.hbp-tc-collapse,.hbp-tc-surface,.hbp-lv-layer{transition:none}.hbp-lv-dot{animation:none}}',
  ':root[data-renderer-animations-paused] :is(.hbp-tc-ring,.hbp-tc-shimmer)::after,:root[data-renderer-animations-paused] :is(.hbp-tc-typing>span,.hbp-lv-dot){animation-play-state:paused}'
]

export function toolCardStyleSheet(): string {
  return `@layer utilities{${[...UTILITIES, ...MOTION].join('')}}${KEYFRAMES.join('')}${QUIET.join('')}`
}
