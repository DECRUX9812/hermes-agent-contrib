import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')

// The activeBots helper must stay a self-contained slice between the
// liveness-window constant and the BotRow section so tests can extract it.
function loadActiveBotsSlice() {
  const start = source.indexOf('const ACTIVE_WINDOW_S')
  const end = source.indexOf('// ── bot row ─')

  assert.ok(start >= 0 && end > start, 'activeBots block must remain extractable')

  const context = {}
  vm.runInNewContext(
    `${source.slice(start, end)}\nglobalThis.__activeBots = activeBots;\nglobalThis.__botActivitySession = botActivitySession;\nglobalThis.__botSessionBusy = botSessionBusy;`,
    context
  )

  return context
}

function loadActiveBots() {
  return loadActiveBotsSlice().__activeBots
}

function loadBotActivitySession() {
  return loadActiveBotsSlice().__botActivitySession
}

function loadBotSessionBusy() {
  return loadActiveBotsSlice().__botSessionBusy
}

// Fixed clock so "inside the window" vs "stale" is deterministic.
const NOW = 1_000_000_000_000

const roster = [
  {
    name: 'researcher',
    canonical_session: { id: 'research-chat', resolved_id: 'research-runtime' },
    last_session: { last_active: (NOW / 1000) - 10 }
  },
  {
    name: 'scribe',
    canonical_session: { id: 'scribe-chat', resolved_id: 'scribe-runtime' },
    last_session: { last_active: (NOW / 1000) - 400 }
  },
  { name: 'analyst', canonical_session: { id: 'analyst-chat', resolved_id: 'analyst-runtime' }, last_session: null }
]

test('activeBots includes a canonical Bot Chat whose runtime session is busy', () => {
  const activeBots = loadActiveBots()
  const names = activeBots(roster, { 'analyst-runtime': true }, NOW).map(bot => bot.name)
  assert.ok(names.includes('analyst'))
})

test('activeBots does not mislabel a recently completed chat as working', () => {
  const activeBots = loadActiveBots()
  const names = activeBots(roster, {}, NOW).map(bot => bot.name)
  assert.ok(!names.includes('researcher'))
})

test('activeBots excludes stale activity outside the window', () => {
  const activeBots = loadActiveBots()
  const names = activeBots(roster, {}, NOW).map(bot => bot.name)
  assert.ok(!names.includes('scribe'))
})

test('activeBots preserves roster order for real working signals', () => {
  const activeBots = loadActiveBots()
  const busyRoster = roster.map(bot =>
    bot.name === 'scribe'
      ? { ...bot, worker_session: { id: 'worker', last_active: NOW / 1000 - 10 } }
      : bot
  )
  const active = activeBots(busyRoster, { 'analyst-runtime': true }, NOW)
  assert.deepEqual(active.map(bot => bot.name), ['scribe', 'analyst'])
  assert.equal(roster.length, 3)
})

test('activeBots returns an empty list when nothing is active', () => {
  const activeBots = loadActiveBots()
  const quiet = [
    { name: 'scribe', last_session: { last_active: (NOW / 1000) - 400 } },
    { name: 'analyst', last_session: null }
  ]
  assert.deepEqual(activeBots(quiet, {}, NOW), [])
})

test('roster without profiles never throws', () => {
  const activeBots = loadActiveBots()
  assert.equal(activeBots(null, {}, NOW).length, 0)
  assert.equal(activeBots([], {}, NOW).length, 0)
})

// ── botActivitySession: canonical Bot Chat activity counts (hermes-agent "6d ago" bug) ──

test('botActivitySession picks the fresher canonical_session over a stale last_session', () => {
  const botActivitySession = loadBotActivitySession()
  const bot = {
    // Canonical Bot Chat (hidden from session lists): messaged seconds ago.
    canonical_session: { id: 'bot-chat', last_active: NOW / 1000 - 5, preview: 'fresh DM' },
    // Newest VISIBLE session: 6 days old — what last_session alone reports.
    last_session: { id: 'old-scratch', last_active: NOW / 1000 - 6 * 86400, preview: 'ancient' }
  }
  assert.equal(botActivitySession(bot).id, 'bot-chat')
})

test('botActivitySession keeps last_session when it is the fresher one', () => {
  const botActivitySession = loadBotActivitySession()
  const bot = {
    canonical_session: { id: 'bot-chat', last_active: NOW / 1000 - 3600 },
    last_session: { id: 'scratch', last_active: NOW / 1000 - 10 }
  }
  assert.equal(botActivitySession(bot).id, 'scratch')
})

test('botActivitySession degrades to whichever side exists (older gateways / no pin)', () => {
  const botActivitySession = loadBotActivitySession()
  assert.equal(botActivitySession({ last_session: { id: 'only', last_active: 1 } }).id, 'only')
  assert.equal(botActivitySession({ canonical_session: { id: 'pin', last_active: 1 } }).id, 'pin')
  assert.equal(botActivitySession({}), null)
  assert.equal(botActivitySession(null), null)
})

test('activeBots keeps recent canonical Bot Chat activity out of Working now', () => {
  const activeBots = loadActiveBots()
  const bots = [
    {
      name: 'default',
      canonical_session: { last_active: NOW / 1000 - 5 },
      last_session: { last_active: NOW / 1000 - 6 * 86400 }
    }
  ]
  const names = activeBots(bots, {}, NOW).map(bot => bot.name)
  assert.ok(!names.includes('default'), 'a completed canonical-chat reply is recent, not proof of work')
})

test('row age label and recency sort key off botActivitySession, not last_session', () => {
  // The "6d ago" regression: the timestamp/sort sites must not read
  // bot.last_session directly anymore.
  assert.match(source, /relativeTime\(rowAgeTs \* 1000\)/)
  assert.match(source, /const lastMsg = \(botActivitySession\(bot\)\?\.last_active \|\| 0\) \* 1000/)
  assert.doesNotMatch(source, /relativeTime\(last\.last_active \* 1000\)/)
})

// ── worker liveness: kanban/tool workers count as activity (#90268) ─────────

test('activeBots includes a bot whose kanban worker heartbeat is fresh', () => {
  const activeBots = loadActiveBots()
  const bots = [
    {
      name: 'coding',
      // Last chat hours ago — the reported "3 hr ago while working" shape.
      last_session: { last_active: NOW / 1000 - 3 * 3600 },
      worker_session: { id: 'w1', source: 'kanban', last_active: NOW / 1000 - 30 }
    }
  ]
  const names = activeBots(bots, {}, NOW).map(bot => bot.name)
  assert.ok(names.includes('coding'), 'live worker heartbeat must light ACTIVE NOW')
})

test('activeBots ignores a finished worker outside the liveness window', () => {
  const activeBots = loadActiveBots()
  const bots = [
    {
      name: 'coding',
      last_session: { last_active: NOW / 1000 - 3 * 3600 },
      worker_session: { id: 'w1', source: 'kanban', last_active: NOW / 1000 - 3600 }
    }
  ]
  assert.deepEqual(activeBots(bots, {}, NOW), [])
})

test('botSessionBusy matches the canonical durable id or live lineage tip', () => {
  const botSessionBusy = loadBotSessionBusy()
  const bot = { canonical_session: { id: 'chat', resolved_id: 'tip' } }

  assert.equal(botSessionBusy(bot, { chat: true }), true)
  assert.equal(botSessionBusy(bot, { tip: true }), true)
  assert.equal(botSessionBusy(bot, { side: true }), false)
})

test('Working-now strip renders above the roster, is live, and is click-accessible', () => {
  // Strip is placed between the pane header and the search field.
  const headerEnd = source.indexOf("children: 'Bots'")
  const searchField = source.indexOf("placeholder: 'Search bots…'")
  assert.ok(headerEnd >= 0 && searchField > headerEnd)

  const stripStart = source.indexOf('jsx(ActiveNowStrip')
  assert.ok(stripStart > headerEnd && stripStart < searchField, 'strip sits between header and search')

  // Live region announces membership changes politely.
  assert.match(source, /'aria-live': 'polite'/)
  // Chips are real buttons (keyboard/click accessible), reuse BotFace, and
  // open the canonical chat via the same path as roster rows.
  assert.match(source, /jsx\('button', \{\s*type: 'button',\s*'aria-label': `Open \$\{label\}'s chat — working now`/)
  // The key rides as jsx()'s third argument — the ONLY form React treats as
  // a list key; a `key:` prop leaves chips unkeyed (index identity).
  assert.match(source, /\}, botRosterKey\(bot\)\)\s*\}\)\s*\]\s*\}\)\s*\}\s*\/\*\* Assign a bot to a group/s)
  assert.match(source, /jsx\(BotFace,\s*\{[\s\S]*?mood: 'work'/)
  assert.match(source, /children: 'Working now'/)
  assert.match(source, /const \$busyBySession = host\?\.state\?\.busyBySession \|\| atom\(\{\}\)/)
  assert.match(source, /const busyBySession = useValue\(\$busyBySession\)/)
  assert.match(source, /await prepareBotSource\(bot\)/)
  assert.match(source, /bot\.canonical_session \|\| last/)
  assert.match(source, /const botMood = turnBusy \|\| workerActive \? 'work' : 'idle'/)
})
