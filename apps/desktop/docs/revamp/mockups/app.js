/* Mockup runtime: skin/mode application (mirrors src/themes/context.tsx applyTheme), icons, teammate faces,
 * and shell pieces. Reference only — NOT app code. Real components are specified in docs/revamp-visual-plan.md. */
(() => {
  const q = new URLSearchParams(location.search)

  // Seeds copied from apps/shared/src/theme-presets.ts (nous light+dark, plus two dark skins to prove skin-safety).
  const PALETTES = {
    nous: {
      light: { background: '#ffffff', foreground: '#1f2328', card: '#f6f8fa', primary: '#0053fd', primaryForeground: '#ffffff', secondary: '#deeaff', secondaryForeground: '#1f2328', accent: '#e3edff', accentForeground: '#1f2328', border: '#d0d7de', input: '#ffffff', muted: '#f6f6f6', popover: '#ffffff', midground: '#0053fd', sidebarBackground: '#f6f8fa', userBubble: '#dae7fd' },
      dark: { background: '#0d1117', foreground: '#e6edf3', card: '#010409', primary: '#4a84fe', primaryForeground: '#161616', secondary: '#1d2e4f', secondaryForeground: '#e6edf3', accent: '#17243a', accentForeground: '#e6edf3', border: '#30363d', input: '#0d1117', muted: '#1a1e24', popover: '#161b22', midground: '#4a84fe', sidebarBackground: '#010409', userBubble: '#07162c' }
    },
    ember: { dark: { background: '#160800', foreground: '#ffd8b0', card: '#1e0e04', primary: '#ffd8b0', primaryForeground: '#160800', secondary: '#341800', secondaryForeground: '#f0c090', accent: '#301600', accentForeground: '#e8c080', border: '#3a1c08', input: '#3a1c08', muted: '#2a1408', popover: '#221008', midground: '#d97316', sidebarBackground: '#100600', userBubble: '#2a1000' } },
    midnight: { dark: { background: '#08081c', foreground: '#ddd6ff', card: '#0d0d28', primary: '#ddd6ff', primaryForeground: '#08081c', secondary: '#1a1a4a', secondaryForeground: '#c4bff0', accent: '#1a1a44', accentForeground: '#d0c8ff', border: '#1e1e52', input: '#1e1e52', muted: '#13133a', popover: '#0f0f2e', midground: '#8b80e8', sidebarBackground: '#06061a', userBubble: '#14143a' } }
  }

  const skin = q.get('skin') || 'nous'
  const scheme = q.get('scheme') === 'dark' || (skin !== 'nous') ? 'dark' : 'light'
  const c = (PALETTES[skin] || PALETTES.nous)[scheme]
  const root = document.documentElement
  root.classList.toggle('dark', scheme === 'dark')
  root.style.colorScheme = scheme
  const seeds = {
    '--theme-foreground': c.foreground, '--theme-primary': c.primary, '--theme-secondary': c.secondary,
    '--theme-accent-soft': c.accent, '--theme-midground': c.midground, '--theme-warm': c.primary,
    '--theme-background-seed': c.background, '--theme-sidebar-seed': c.sidebarBackground ?? c.background,
    '--theme-card-seed': c.card, '--theme-elevated-seed': c.popover, '--theme-bubble-seed': c.userBubble ?? c.popover,
    '--dt-primary-foreground': c.primaryForeground, '--dt-secondary-foreground': c.secondaryForeground,
    '--dt-accent-foreground': c.accentForeground, '--dt-border': c.border, '--dt-input': c.input, '--dt-muted': c.muted
  }
  for (const [k, v] of Object.entries(seeds)) root.style.setProperty(k, v)
  window.MODE = q.get('ui') === 'simple' ? 'simple' : 'advanced'

  const PATH = {
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-3.6-3.6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    branch: '<circle cx="6.5" cy="5.5" r="2"/><circle cx="6.5" cy="18.5" r="2"/><circle cx="17.5" cy="8.5" r="2"/><path d="M6.5 7.5v9M17.5 10.5c0 4-6 3-11 6.5"/>',
    pr: '<circle cx="6" cy="5.5" r="2"/><circle cx="6" cy="18.5" r="2"/><circle cx="18" cy="18.5" r="2"/><path d="M6 7.5v9M18 16.5V9.5a3 3 0 0 0-3-3h-3"/><path d="m14.5 3.5-2.8 3 2.8 3"/>',
    sparkle: '<path d="M11 3.5l1.7 4.8 4.8 1.7-4.8 1.7L11 16.5l-1.7-4.8L4.5 10l4.8-1.7z"/><path d="M18.5 15.5v4.5M16.25 17.75h4.5"/>',
    mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
    arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>', chevronR: '<path d="m9 6 6 6-6 6"/>',
    more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    terminal: '<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="m7.5 10 3 2.5-3 2.5M13 15h4"/>',
    file: '<path d="M7 3.5h6.5L18.5 8v11.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path d="M13.5 3.5V8h5"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.4 3.6 8.5S14.4 18.1 12 20.5C9.6 18.1 8.4 15.1 8.4 12S9.6 5.9 12 3.5z"/>',
    cursor: '<path d="M6.5 4.5l11 6.2-4.9 1.6L10.8 17.5z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.5 1.5M16.5 16.5 18 18M6 18l1.5-1.5M16.5 7.5 18 6"/>',
    key: '<circle cx="8" cy="15" r="3.5"/><path d="m10.5 12.5 8-8M15.5 7.5l2.5 2.5"/>',
    cpu: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3"/>',
    bolt: '<path d="M13 3.5 5.5 13.5H11l-1 7 7.5-10H12z"/>',
    undo: '<path d="M9 8 4.5 12.5 9 17"/><path d="M5 12.5h9a5 5 0 0 1 0 10"/>',
    play: '<path d="m8 5.5 10 6.5-10 6.5z"/>',
    lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    layout: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15M9.5 12h11"/>',
    sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/>',
    rsidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M14.5 4.5v15"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    activity: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>',
    telegram: '<path d="M20.5 4 3.5 10.8l5.2 1.9 2 6.3 3-3.7 4.6 3.4z"/><path d="m8.7 12.7 8-5.4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    users: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.8a3 3 0 0 1 0 5.4M17.5 14a5 5 0 0 1 3 4.6"/>',
    folder: '<path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z"/>',
    shield: '<path d="M12 3.5 5 6v5.5c0 4 3 7 7 9 4-2 7-5 7-9V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
    monitor: '<rect x="3.5" y="4.5" width="17" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/>',
    home: '<path d="m3.5 11.5 8.5-7 8.5 7"/><path d="M6 10v9h12v-9"/>',
    cloud: '<path d="M7 18.5a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 9.5a4.5 4.5 0 0 1 .5 9z"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    box: '<path d="m12 3.5 8 4.5v8.5l-8 4.5-8-4.5V8z"/><path d="m4 8 8 4.5L20 8M12 12.5V21"/>',
    download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'
  }
  window.ic = (n, s = 14, x = '') => `<svg class="ic ${x}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATH[n] || ''}</svg>`

  // Teammate hues come from the SEMANTIC palette so every skin recolours them (real BotFace uses avatarColor()).
  const HUE = { atlas: 'blue', scout: 'cyan', sage: 'yellow', juno: 'purple', nova: 'red', hermes: 'purple' }
  window.face = (k, s = 32, state = '', cls = '') => {
    const h = HUE[k] || 'purple'
    return `<span class="face ${cls}" ${state ? `data-state="${state}"` : ''} style="--s:${s}px;--a:color-mix(in srgb,var(--ui-${h}) 62%,#fff);--b:var(--ui-${h})"><i></i><i></i></span>`
  }

  window.TEAM = [
    { k: 'atlas', name: 'Atlas', role: 'Engineer', line: 'Fixing CI · step 3 of 5', state: 'working', t: '4m' },
    { k: 'scout', name: 'Scout', role: 'Researcher', line: 'Comparing 6 venues · 12 sources', state: 'working', t: '9m' },
    { k: 'sage', name: 'Sage', role: 'Writer', line: 'Waiting for you', state: 'needs', t: '2m' },
    { k: 'juno', name: 'Juno', role: 'Planner', line: 'Idle · next: Monday brief, 8:00', state: '', t: '' },
    { k: 'nova', name: 'Nova', role: 'Ops', line: 'Replied on Telegram', state: '', t: '1h', tg: 1 }
  ]

  window.chromeRow = (mode) => `
    <div class="chrome-row"><span class="lights"><i></i><i></i><i></i></span>
      <button class="icon-btn" aria-label="Sidebar">${ic('sidebar', 14)}</button>
      <button class="icon-btn" aria-label="Settings">${ic('gear', 14)}</button>
      <button class="icon-btn" aria-label="Layouts">${ic('layout', 14)}</button>
      ${mode === 'advanced' ? `<button class="icon-btn" aria-label="HUD">${ic('monitor', 14)}</button>` : ''}
    </div>`

  window.sidebar = ({ mode = MODE, active = 'Atlas', needs = true, tab = 'team' } = {}) => {
    const row = t => `
      <div class="row ${t.name === active ? 'active' : ''}">${face(t.k, 32, t.state)}
        <div style="min-width:0"><div class="t1"><b>${t.name}</b><span class="role">${t.role}</span>${t.tg ? `<span class="tg">${ic('telegram', 11)}</span>` : ''}<span class="tm">${t.t}</span></div>
        <div class="t2 ${t.state === 'needs' ? 'warn' : t.state ? '' : 'dim'}">${t.state === 'working' ? '<span class="pulse"></span>' : t.state === 'needs' ? '<span class="dotn"></span>' : ''}${t.line}</div></div>
      </div>`
    const need = (k, title, sub, cta) => `<div class="need">${face(k, 32, 'needs')}<div style="min-width:0"><b>${title}</b><span class="s">${sub}</span></div><button class="btn btn-secondary xs">${cta}</button></div>`
    return `<aside class="sidebar">
      ${chromeRow(mode)}
      <div class="side-tabs"><span class="tab ${tab === 'sessions' ? 'active' : ''}">Sessions</span><span class="tab ${tab === 'team' ? 'active' : ''}">Team</span></div>
      <div class="side-body">
        <div class="searchrow">${ic('search', 13)}<span class="grow">Search or ask</span><kbd>⌘K</kbd></div>
        <button class="btn btn-default wide newtask">${ic('plus', 13)}New task</button>
        ${needs ? `<div class="sec"><span>Needs you</span><span class="badge solid">3</span></div>
          <div class="needs-band">${need('atlas', 'Approve push?', 'Atlas · 1m', 'Allow')}${need('sage', 'Publish newsletter?', 'Sage · 2m', 'Review')}${need('scout', 'Venue for Friday?', 'Scout · 9m', 'Answer')}</div>` : ''}
        <div class="sec"><span>Teammates</span><button class="icon-btn" style="width:1.25rem;height:1.25rem" aria-label="Hire">${ic('plus', 12)}</button></div>
        <div class="rows">${TEAM.map(row).join('')}</div>
        <div class="sec"><span>Recent</span></div>
        <div class="plain-rows"><div class="prow">Refactor the sidebar split<span>Atlas</span></div><div class="prow">Lisbon trip — plan<span>Scout</span></div><div class="prow">Weekly review<span>Juno</span></div></div>
      </div></aside>`
  }

  window.tabstrip = (tabs, trail = '') => `<div class="tabstrip">${tabs.map(t => `<span class="tab ${t.on ? 'active' : ''}">${t.face || ''}${t.t}<span class="x">${ic('x', 11)}</span></span>`).join('')}<span class="tab" style="padding:0 0.625rem">${ic('plus', 12)}</span><div class="tab-trail">${trail}</div></div>`

  window.story = () => `
    <div class="usr">Morning. What's the state of the digest PR?</div>
    <div class="turn"><div style="padding-top:2px">${face('atlas', 22)}</div><div class="body">
      <div class="who"><b>Atlas</b>2:09 PM</div>
      <p class="prose">CI is red on <span class="code">#482</span>: one failing test in <span class="code">peek-card.test.tsx</span>, and there's no changelog entry yet. Want me to take it?</p>
    </div></div>
    <div class="usr">Get the digest PR green and write the changelog. Ping me when it's ready to merge.</div>
    <div class="turn"><div style="padding-top:2px">${face('atlas', 22)}</div><div class="body">
      <div class="who"><b>Atlas</b>2:14 PM</div>
      <p class="prose">On it. I'll fix the failing test first, then draft the changelog and open the PR. I'll ask before I push anything.</p>
      <div class="scaffold">${ic('terminal', 12)}Ran 6 commands · edited 2 files · read 9 files<span class="m">▸</span></div>
      <div class="legend">${ic('sparkle', 13)}<span>Remembered <b>you use pnpm, not npm</b></span><button>Undo</button></div>
      <div class="stackwrap"><div class="ask">
        <div class="top">${ic('lock', 13)}Needs your OK · waiting 1m</div>
        <h4>Push 2 commits to <span class="code">origin/feat/digest</span>?</h4>
        <p>This publishes my fix so CI can run. It won't touch <span class="code">main</span>.</p>
        <div class="acts"><button class="btn btn-default">Allow once</button><button class="btn btn-secondary">This session</button><button class="btn btn-outline">Always for this repo</button><button class="btn btn-ghost">Not now</button></div>
        <div class="fine">Atlas keeps working on other steps while this waits.</div>
      </div></div>
    </div></div>`

  window.dock = ({ mode = MODE } = {}) => `
    <div class="dock"><div class="dock-in">
      <div class="stack"><span class="ridge"></span>
        <div class="srow head">${ic('check', 13)}Plan · 2 of 5<span class="r">about 6 min left</span></div>
        <div class="srow"><span class="chk done">${ic('check', 9)}</span>Reproduce the failing test<span class="r">12s</span></div>
        <div class="srow"><span class="chk done">${ic('check', 9)}</span>Find the cause — stale fixture in <span class="code">digest.test.ts</span><span class="r">41s</span></div>
        <div class="srow"><span class="chk run"></span><b style="color:var(--ui-text-primary)">Fix it and re-run CI</b><span class="r">running…</span></div>
        <div class="srow todo"><span class="chk todo"></span>Write the changelog entry</div>
        <div class="srow todo"><span class="chk todo"></span>Ask you to merge</div>
        <div class="srow git">${ic('branch', 12)}feat/digest<span>·</span>4 changed<span>·</span>${ic('pr', 12)}#482<span style="color:var(--state-done);display:inline-flex">${ic('check', 12)}</span><span class="r">CI 8 passed · 1 running</span></div>
      </div>
      <div class="composer"><div class="ph">Reply to Atlas, or hand off something new…</div>
        <div class="crow"><button class="icon-btn" aria-label="Attach">${ic('plus', 15)}</button>
          ${mode === 'advanced' ? `<span class="pillbtn soft">${ic('bolt', 12)}Smart${ic('chevron', 11)}</span>` : ''}
          <span class="grow"></span>
          <span class="pillbtn">${ic('cpu', 12)}GLM 5.2 · Nous free${ic('chevron', 11)}</span>
          ${mode === 'advanced' ? `<span class="pillbtn">Medium reasoning${ic('chevron', 11)}</span><span class="ctxring" title="Context 38%"></span>` : ''}
          <button class="icon-btn" aria-label="Voice">${ic('mic', 15)}</button><button class="send" aria-label="Send">${ic('arrowUp', 14)}</button></div></div>
      <div class="hint">Atlas will come back when it's done — or when it needs you.</div>
    </div></div>`

  window.statusbar = () => `<footer class="statusbar"><span>${ic('branch', 11)}feat/digest</span><span>${ic('folder', 11)}~/code/hermes</span><span class="grow"></span><span><i class="gdot"></i>Hermes running · Nous free</span><span>${ic('bolt', 11)}Smart</span><span>v0.21.5</span></footer>`

  window.nowPane = () => `
    <div class="pane-body">
      <div class="card"><div class="ov work"><span class="pulse"></span>Right now</div><h5>Re-running the digest tests</h5>
        <div class="term"><div><span class="p">$</span> pnpm vitest run digest</div><div><span class="g">✓</span> session-digest.test.ts <span class="p">(14)</span></div><div><span class="g">✓</span> rail-row.test.tsx <span class="p">(9)</span></div><div><span class="y">●</span> peek-card.test.tsx …</div></div></div>
      <div class="card"><div class="kv"><b>Changes</b><span class="v">4 files <span class="add">+142</span> <span class="del">−37</span></span></div>
        <div class="kv"><span class="k mono">session-digest.ts</span><span class="v"><span class="add">+88</span><span class="del">−12</span></span></div>
        <div class="kv"><span class="k mono">digest.test.ts</span><span class="v"><span class="add">+31</span><span class="del">−19</span></span></div>
        <div style="display:flex;gap:6px;margin-top:8px"><button class="btn btn-secondary xs">Review diff</button><button class="btn btn-outline xs">Open in editor</button></div></div>
      <div class="card"><div class="kv"><b>Pull request #482</b><span class="badge success">${ic('check', 10)}CI 8 passed · 1 running</span></div><div style="color:var(--ui-text-secondary);font-size:var(--type-meta)">feat: live session digest on rail rows</div></div>
      <div class="card"><div class="kv"><b>${ic('sparkle', 13)} Learned this run</b><span class="v" style="color:var(--ui-text-tertiary);font-weight:400">2 items</span></div>
        <div class="kv"><span class="k"><b style="color:var(--ui-text-primary)">Remembered</b> pnpm, not npm</span><button class="btn btn-text xs">Undo</button></div>
        <div class="kv"><span class="k"><b style="color:var(--ui-text-primary)">Patched skill</b> <span class="code">release-check</span></span><button class="btn btn-text xs">View</button></div></div>
    </div>
    <div class="scrubwrap"><div class="scrub"><i></i><s style="left:18%"></s><s style="left:41%"></s><s style="left:63%"></s><em></em></div>
      <div style="display:flex;align-items:center;gap:6px"><button class="icon-btn" aria-label="Replay">${ic('play', 13)}</button><span style="font-size:var(--type-meta);color:var(--ui-text-tertiary)">Replay this run</span><span class="grow"></span><span class="live">Live</span><button class="btn btn-outline xs">${ic('cursor', 11)}Take over</button></div></div>`

  window.rightStrip = (active = 'Now', extra = ['Files', 'Review', 'Terminal'], first = ['Now']) => `
    <div class="tabstrip">${[...first, ...extra].map(t => `<span class="tab ${t === active ? 'active' : ''}">${t}</span>`).join('')}<div class="tab-trail"><button class="icon-btn" aria-label="Flip">${ic('rsidebar', 14)}</button></div></div>`

  window.simpleApp = () => `<div class="app" data-ui="simple">
    ${sidebar({ mode: 'simple' })}
    <main class="center">
      ${tabstrip([{ t: 'Atlas', on: true, face: face('atlas', 14, 'working', 'on-chrome') + '&nbsp;' }, { t: 'Lisbon trip — plan' }],
        `<span class="badge default"><span class="pulse" style="width:5px;height:5px;box-shadow:none"></span>Working · step 3 of 5</span><button class="btn btn-outline xs">${ic('eye', 12)}Watch</button>`)}
      <div class="thread"><div class="thread-in">${story()}</div></div>
      ${dock({ mode: 'simple' })}
    </main></div>`

  window.mount = (html) => { document.body.innerHTML = html }
})()
