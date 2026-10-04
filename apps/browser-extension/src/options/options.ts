import type { GenericHarnessConfig, Settings } from '../shared/types'

const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  hermes: { url: '', token: '' },
  harnesses: [],
  disabledHosts: [],
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!

async function load(): Promise<Settings> {
  const s = await chrome.storage.local.get('bot-room.settings')

  return { ...DEFAULT_SETTINGS, ...(s['bot-room.settings'] as Partial<Settings> | undefined) }
}

async function save(s: Settings) {
  await chrome.storage.local.set({ 'bot-room.settings': s })
  // push to SW so it reconnects live
  chrome.runtime.sendMessage({ type: 'settings.apply', settings: s })
  const el = $('#saved')
  el.classList.add('on')
  setTimeout(() => el.classList.remove('on'), 1500)
}

let harnesses: GenericHarnessConfig[] = []

function renderHarnesses() {
  const list = $('#harnessList')
  list.innerHTML = ''
  harnesses.forEach((h, i) => {
    const div = document.createElement('div')
    div.className = 'harness'
    div.innerHTML = `<div class="harness-head"><b></b><button class="danger">Remove</button></div>
      <div style="font-size:12px;opacity:.6;margin-top:4px">${h.baseUrl} · ${h.model} · ${h.bots.length} bot(s): ${h.bots.map((b) => b.name).join(', ')}</div>`
    div.querySelector('b')!.textContent = h.name
    div.querySelector('button')!.addEventListener('click', () => {
      harnesses.splice(i, 1)
      renderHarnesses()
    })
    list.appendChild(div)
  })
}

async function main() {
  const s = await load()
  $<HTMLInputElement>('#enabled').checked = s.enabled
  $<HTMLInputElement>('#hermesUrl').value = s.hermes?.url ?? ''
  $<HTMLInputElement>('#hermesToken').value = s.hermes?.token ?? ''
  $<HTMLTextAreaElement>('#disabledHosts').value = s.disabledHosts.join('\n')
  harnesses = s.harnesses
  renderHarnesses()

  $('#addHarness').addEventListener('click', () => {
    const name = $<HTMLInputElement>('#hName').value.trim()
    const baseUrl = $<HTMLInputElement>('#hUrl').value.trim()
    const model = $<HTMLInputElement>('#hModel').value.trim()
    const apiKey = $<HTMLInputElement>('#hKey').value.trim()

    const bots = $<HTMLTextAreaElement>('#hBots').value
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [n, ...rest] = l.split(':')

        return { name: (n ?? 'Bot').trim(), systemPrompt: rest.join(':').trim() || `You are ${n?.trim()}, a helpful browser agent.` }
      })

    if (!name || !baseUrl || !model || bots.length === 0) {
      alert('Need name, base URL, model, and at least one bot line.')

      return
    }

    harnesses.push({ id: `gx${Date.now().toString(36)}`, name, baseUrl, apiKey, model, bots })

    for (const id of ['#hName', '#hUrl', '#hKey', '#hModel', '#hBots']) {$<HTMLInputElement>(id).value = ''}
    renderHarnesses()
  })

  $('#testConn').addEventListener('click', async () => {
    const el = $('#connStatus')
    el.style.display = 'block'
    el.className = 'conn'
    el.textContent = 'Connecting…'
    const url = $<HTMLInputElement>('#hermesUrl').value.trim().replace(/\/$/, '')
    const token = $<HTMLInputElement>('#hermesToken').value.trim()

    try {
      const headers: Record<string, string> = {}

      if (token) {
        headers['Authorization'] = `Bearer ${token}`
        headers['X-Hermes-Session'] = token
      }

      const r = await fetch(url + '/api/health', { headers })

      if (r.ok) {
        el.classList.add('ok')
        el.textContent = 'Connected ✓ backend reachable'
      } else {
        el.classList.add('err')
        el.textContent = `Backend replied ${r.status}`
      }
    } catch (e) {
      el.classList.add('err')
      el.textContent = `Unreachable: ${String(e)}`
    }
  })

  $('#save').addEventListener('click', () => {
    void save({
      enabled: $<HTMLInputElement>('#enabled').checked,
      hermes: {
        url: $<HTMLInputElement>('#hermesUrl').value.trim().replace(/\/$/, ''),
        token: $<HTMLInputElement>('#hermesToken').value.trim(),
      },
      harnesses,
      disabledHosts: $<HTMLTextAreaElement>('#disabledHosts')
        .value.split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    })
  })
}

void main()
