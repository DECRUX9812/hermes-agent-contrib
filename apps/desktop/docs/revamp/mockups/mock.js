/* Static-mockup helpers: theme switch, icons, persona avatar, the Team rail.
 * Reference material only — NOT app code. The real components are specified in
 * docs/revamp-visual-plan.md §4–5. */
(() => {
  const q = new URLSearchParams(location.search)
  document.documentElement.dataset.theme = q.get('theme') === 'dark' ? 'dark' : 'light'

  const P = {
    atlas: 'atlas', scout: 'scout', juno: 'juno', sage: 'sage', nova: 'nova', hermes: 'hermes'
  }

  const PATH = {
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-3.6-3.6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    branch:
      '<circle cx="6.5" cy="5.5" r="2"/><circle cx="6.5" cy="18.5" r="2"/><circle cx="17.5" cy="8.5" r="2"/><path d="M6.5 7.5v9M17.5 10.5c0 4-6 3-11 6.5"/>',
    pr: '<circle cx="6" cy="5.5" r="2"/><circle cx="6" cy="18.5" r="2"/><circle cx="18" cy="18.5" r="2"/><path d="M6 7.5v9M18 16.5V9.5a3 3 0 0 0-3-3h-3"/><path d="m14.5 3.5-2.8 3 2.8 3"/>',
    sparkle:
      '<path d="M11 3.5l1.7 4.8 4.8 1.7-4.8 1.7L11 16.5l-1.7-4.8L4.5 10l4.8-1.7z"/><path d="M18.5 15.5v4.5M16.25 17.75h4.5"/>',
    mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
    arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    chevronR: '<path d="m9 6 6 6-6 6"/>',
    more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    terminal: '<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="m7.5 10 3 2.5-3 2.5M13 15h4"/>',
    file: '<path d="M7 3.5h6.5L18.5 8v11.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path d="M13.5 3.5V8h5"/>',
    globe:
      '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.4 3.6 8.5S14.4 18.1 12 20.5C9.6 18.1 8.4 15.1 8.4 12S9.6 5.9 12 3.5z"/>',
    cursor: '<path d="M6.5 4.5l11 6.2-4.9 1.6L10.8 17.5z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.5 1.5M16.5 16.5 18 18M6 18l1.5-1.5M16.5 7.5 18 6"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    key: '<circle cx="8" cy="15" r="3.5"/><path d="m10.5 12.5 8-8M15.5 7.5l2.5 2.5"/>',
    cpu: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3"/>',
    bolt: '<path d="M13 3.5 5.5 13.5H11l-1 7 7.5-10H12z"/>',
    undo: '<path d="M9 8 4.5 12.5 9 17"/><path d="M5 12.5h9a5 5 0 0 1 0 10"/>',
    play: '<path d="m8 5.5 10 6.5-10 6.5z"/>',
    inbox: '<path d="M4 13.5 6.5 5.5h11l2.5 8v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 13.5h4.5a3.5 3.5 0 0 0 7 0H20"/>',
    lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    send: '<path d="M4 12 20 4.5 15 20l-3-6.5z"/>',
    layers: '<path d="m12 4 8.5 4.5L12 13 3.5 8.5z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5"/>',
    sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M9.5 4.5v15"/>',
    activity: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>',
    telegram: '<path d="M20.5 4 3.5 10.8l5.2 1.9 2 6.3 3-3.7 4.6 3.4z"/><path d="m8.7 12.7 8-5.4"/>'
  }

  window.ic = (name, size = 16, extra = '') =>
    `<svg class="ic ${extra}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATH[name] || ''}</svg>`

  /** Persona avatar: soft squircle, two vertical eyes (echoes today's blob bots), optional state ring. */
  window.av = (key, size = 40, state = '') =>
    `<span class="av ${state ? 'ring-' + state : ''}" style="--s:${size}px;--a:var(--p-${P[key] || 'hermes'}-1);--b:var(--p-${P[key] || 'hermes'}-2)"><i></i><i></i></span>`

  const TEAM = [
    { k: 'atlas', name: 'Atlas', role: 'Engineer', line: 'Fixing CI · step 3 of 5', state: 'working', meta: '4m' },
    { k: 'scout', name: 'Scout', role: 'Researcher', line: 'Comparing 6 venues · 12 sources', state: 'working', meta: '9m' },
    { k: 'sage', name: 'Sage', role: 'Writer', line: 'Waiting for you', state: 'needs', meta: '2m' },
    { k: 'juno', name: 'Juno', role: 'Planner', line: 'Idle · next: Monday brief, 8:00', state: 'idle', meta: '' },
    { k: 'nova', name: 'Nova', role: 'Ops', line: 'Replied on Telegram', state: 'idle', meta: '1h', tg: true }
  ]

  window.rail = (active = 'Atlas', opts = {}) => {
    const needs = opts.needs !== false
    const row = t => `
      <div class="row ${t.name === active ? 'active' : ''}">
        ${av(t.k, 40, t.state)}
        <div class="row-main">
          <div class="row-top"><b>${t.name}</b><span class="role">${t.role}</span>${t.tg ? `<span class="tg" title="Telegram">${ic('telegram', 12)}</span>` : ''}<span class="meta">${t.meta}</span></div>
          <div class="row-line ${t.state}">${t.state === 'working' ? '<span class="pulse"></span>' : t.state === 'needs' ? '<span class="dotn"></span>' : ''}${t.line}</div>
        </div>
      </div>`
    return `
    <aside class="rail">
      <div class="titlebar"><span class="lights"><i></i><i></i><i></i></span><span class="spacer"></span><button class="icon-btn" aria-label="Toggle sidebar">${ic('sidebar', 17)}</button></div>
      <div class="rail-top">
        <div class="cmdk">${ic('search', 15)}<span>Search, or ask anything</span><kbd>⌘K</kbd></div>
        <button class="btn btn-primary wide">${ic('plus', 16)}New task<kbd class="on-accent">⌘N</kbd></button>
      </div>
      <div class="rail-scroll">
        ${needs ? `
        <div class="sec"><span>Needs you</span><span class="count needs">3</span></div>
        <div class="needs-list">
          <div class="need">${av('atlas', 30)}<div><b>Push 2 commits?</b><span>Atlas · 1m</span></div><button class="btn btn-soft sm">Allow</button></div>
          <div class="need">${av('sage', 30)}<div><b>Publish newsletter?</b><span>Sage · 2m</span></div><button class="btn btn-soft sm">Review</button></div>
          <div class="need">${av('scout', 30)}<div><b>Venue for Friday?</b><span>Scout · 9m</span></div><button class="btn btn-soft sm">Answer</button></div>
        </div>` : ''}
        <div class="sec"><span>Teammates</span><button class="icon-btn sm" aria-label="Add teammate">${ic('plus', 14)}</button></div>
        <div class="rows">${TEAM.map(row).join('')}</div>
        <div class="sec"><span>Recent</span></div>
        <div class="rows recent">
          <div class="rrow">Refactor the sidebar split<span>Atlas</span></div>
          <div class="rrow">Lisbon trip — plan<span>Scout</span></div>
          <div class="rrow">Weekly review<span>Juno</span></div>
        </div>
      </div>
      <div class="rail-foot">
        <span class="gdot"></span><div><b>Hermes is running</b><span>Nous free · GLM 5.2</span></div>
        <button class="icon-btn" aria-label="Settings">${ic('gear', 17)}</button>
      </div>
    </aside>`
  }
})()
