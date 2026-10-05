/**
 * Selector surfaces — the "easy for people to use" layer.
 *
 *  - `showContextMenu`: right-click quick actions for a mascot.
 *  - `showPalette`: Raycast-style command palette — type to filter,
 *    arrows + Enter to run, Esc / click-outside to dismiss.
 *
 * Both render inside the overlay shadow root and share the .hr-menu styles.
 */

export interface MenuItem {
  icon?: string
  label: string
  hint?: string
  danger?: boolean
  separator?: boolean
  run?: () => void
}

export interface PaletteSection {
  title: string
  items: MenuItem[]
}

export function showContextMenu(root: ShadowRoot, x: number, y: number, items: MenuItem[]) {
  const menu = document.createElement('div')
  menu.className = 'hr-menu'
  let sel = -1
  const els: HTMLElement[] = []

  for (const it of items) {
    if (it.separator) {
      const s = document.createElement('div')
      s.className = 'hr-menu-sep'
      menu.appendChild(s)

      continue
    }

    const el = document.createElement('button')
    el.className = 'hr-menu-item' + (it.danger ? ' danger' : '')
    el.innerHTML = `<span class="hr-menu-ic">${it.icon ?? ''}</span><span class="hr-menu-txt"></span>`
    el.querySelector('.hr-menu-txt')!.textContent = it.label

    if (it.hint) {
      const h = document.createElement('span')
      h.className = 'hr-menu-hint'
      h.textContent = it.hint
      el.appendChild(h)
    }

    el.addEventListener('click', () => {
      dismiss()
      it.run?.()
    })
    menu.appendChild(el)
    els.push(el)
  }

  menu.style.left = `${Math.min(x, innerWidth - 196)}px`
  menu.style.top = `${Math.min(y, innerHeight - menu.offsetHeight - 12)}px`
  root.appendChild(menu)

  function dismiss() {
    menu.remove()
    document.removeEventListener('pointerdown', outside, true)
    document.removeEventListener('keydown', onKey, true)
  }

  function move(d: 1 | -1) {
    sel = (sel + d + els.length) % els.length
    els.forEach((el, i) => el.classList.toggle('sel', i === sel))
  }

  function outside(e: Event) {
    if (!menu.contains(e.target as Node)) {dismiss()}
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {dismiss()}
    else if (e.key === 'ArrowDown') {e.preventDefault(); move(1)}
    else if (e.key === 'ArrowUp') {e.preventDefault(); move(-1)}
    else if (e.key === 'Enter' && sel >= 0) {e.preventDefault(); dismiss(); items.filter((i) => !i.separator)[sel]?.run?.()}
  }

  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0)
  document.addEventListener('keydown', onKey, true)
}

export function showPalette(root: ShadowRoot, sections: PaletteSection[]) {
  const wrap = document.createElement('div')
  wrap.className = 'hr-palette'
  wrap.innerHTML = `
    <div class="hr-pal-box">
      <div class="hr-pal-search"><span class="hr-pal-mag">⌕</span><input placeholder="Bots, actions, rooms…" spellcheck="false"/></div>
      <div class="hr-pal-list"></div>
      <div class="hr-pal-foot"><span><b>↑↓</b> navigate</span><span><b>↵</b> run</span><span><b>esc</b> close</span></div>
    </div>`

  const input = wrap.querySelector('input')!
  const list = wrap.querySelector('.hr-pal-list')!
  let flat: { it: MenuItem; el: HTMLElement }[] = []
  let sel = 0

  function render(q: string) {
    const ql = q.trim().toLowerCase()
    list.innerHTML = ''
    flat = []

    for (const s of sections) {
      const hits = s.items.filter((it) => !ql || it.label.toLowerCase().includes(ql) || (it.hint ?? '').toLowerCase().includes(ql))

      if (!hits.length) {continue}
      const h = document.createElement('div')
      h.className = 'hr-pal-sec'
      h.textContent = s.title
      list.appendChild(h)

      for (const it of hits) {
        const el = document.createElement('button')
        el.className = 'hr-pal-item' + (it.danger ? ' danger' : '')
        el.innerHTML = `<span class="hr-menu-ic">${it.icon ?? ''}</span><span class="hr-menu-txt"></span>`
        el.querySelector('.hr-menu-txt')!.textContent = it.label

        if (it.hint) {
          const hh = document.createElement('span')
          hh.className = 'hr-menu-hint'
          hh.textContent = it.hint
          el.appendChild(hh)
        }

        el.addEventListener('click', () => {
          dismiss()
          it.run?.()
        })
        list.appendChild(el)
        flat.push({ it, el })
      }
    }

    if (!flat.length) {
      const empty = document.createElement('div')
      empty.className = 'hr-pal-empty'
      empty.textContent = `Nothing matches "${q}"`
      list.appendChild(empty)
    }

    sel = 0
    paint()
  }

  function paint() {
    flat.forEach((f, i) => f.el.classList.toggle('sel', i === sel))
    flat[sel]?.el.scrollIntoView({ block: 'nearest' })
  }

  function dismiss() {
    wrap.remove()
    document.removeEventListener('pointerdown', outside, true)
  }

  function outside(e: Event) {
    if (!wrap.contains(e.target as Node)) {dismiss()}
  }

  input.addEventListener('input', () => render(input.value))
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {dismiss()}
    else if (e.key === 'ArrowDown') {e.preventDefault(); sel = Math.min(flat.length - 1, sel + 1); paint()}
    else if (e.key === 'ArrowUp') {e.preventDefault(); sel = Math.max(0, sel - 1); paint()}
    else if (e.key === 'Enter' && flat[sel]) {e.preventDefault(); dismiss(); flat[sel]!.it.run?.()}
  })

  root.appendChild(wrap)
  render('')
  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true)
    input.focus()
  }, 0)
}
