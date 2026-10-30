import { host } from '@hermes/plugin-sdk'
/**
 * DEV ONLY — offline Bot Mode screenshot harness.
 *
 * Mounts the REAL Bot Mode surfaces with representative fixture data and no
 * gateway behind them:
 * - left: the real BotRow roster list + a real GroupRow for the active room
 * - center: the real GroupChatWorkspace (legacy transcript path) for one room
 * - right: the real BotContextPanel (tasks / scheduled / history / saved)
 *
 * Offline seams, all set before first paint:
 * - `host.request` / `host.requestProfile` are stubbed at the SDK door:
 *   `groups.capabilities` reports no canonical driver (so the room renders
 *   the legacy transcript), `cron.manage` returns the fixture routine runs.
 *   Anything else throws, so a missing seam fails loudly in the console.
 * - nanostores are seeded directly ($lastRoster, $selectedBot, $groupChats,
 *   $groupNeedsYou) and the gateway/connection stores report a live local
 *   socket, exactly what the components read through `host.state`.
 * - the bot-mode i18n bundle is registered for real (the same call the
 *   plugin loader makes), and the app's own ThemeProvider paints the
 *   warm-paper skin, so strings and CSS variables are the app's own.
 *
 *   http://127.0.0.1:5177/preview/botmode/botmode.html
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'

import { registerPluginLocales } from '@/i18n/plugin-i18n'
import { BotContextPanel } from '@/plugins/hermes-bots/bot-context-panel'
import { BotRow, GroupRow } from '@/plugins/hermes-bots/bot-row'
import { $selectedBot } from '@/plugins/hermes-bots/bot-state'
import { $lastRoster } from '@/plugins/hermes-bots/data'
import { $groupChats, $groupNeedsYou } from '@/plugins/hermes-bots/group-chat'
import { GroupChatWorkspace } from '@/plugins/hermes-bots/group-chat-view'
import { BOTS_LOCALES } from '@/plugins/hermes-bots/i18n'
import { $activeGatewayProfile } from '@/store/profile'
import { $connection, $gatewayState } from '@/store/session'
import { skinPref, ThemeProvider } from '@/themes/context'

import { FIXTURE_LOG, FIXTURE_MEMBERS, FIXTURE_ROOM, FIXTURE_ROSTER, ROUTINE_JOBS } from './fixtures'

// --- offline seams -----------------------------------------------------------

registerPluginLocales('hermes-bots', BOTS_LOCALES)

// Warm paper, committed through the app's own skin preference API so the
// ThemeProvider below paints the exact same variables the live app paints.
try {
  skinPref.assign('default', 'warm-paper')
} catch {
  // A fresh profile without storage still paints the default skin.
}

 
const warnUnknownRpc = (method: string) => console.warn(`[botmode harness] no fixture for RPC: ${method}`)

async function fixtureRequest(method: string): Promise<unknown> {
  if (method === 'groups.capabilities') {
    // No canonical driver: the room renders the legacy transcript path.
    return { driver: false, persistent_process: false }
  }

  if (method === 'cron.manage') {
    return { jobs: ROUTINE_JOBS, scoped: 'research' }
  }

  warnUnknownRpc(method)
  throw new Error(`[botmode harness] no fixture for RPC: ${method}`)
}

const sdkHost = host as unknown as Record<string, unknown>
sdkHost.request = async (method: string) => fixtureRequest(method)
sdkHost.requestProfile = async (_route: unknown, method: string) => fixtureRequest(method)

// A live local socket, as the components read it through `host.state`.
$gatewayState.set('open' as never)
$activeGatewayProfile.set('research')
$connection.set({ connectionId: 'local', mode: 'local', profile: 'research' } as never)

// Fixture evidence.
$lastRoster.set(FIXTURE_ROSTER)
$selectedBot.set('research')
$groupChats.set({
  [FIXTURE_ROOM]: { log: FIXTURE_LOG, sessions: {}, watermarks: {} } as never
})
$groupNeedsYou.set({ [FIXTURE_ROOM]: true })

// --- layout ------------------------------------------------------------------

const noop = () => {}

function Harness() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-(--ui-sidebar-surface-background) text-(--ui-text-primary)">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-(--ui-stroke-quaternary)">
        <div className="shrink-0 px-3 pt-3 pb-1 text-[11px] font-semibold tracking-[0.08em] text-(--ui-text-tertiary) uppercase">
          Bots
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2">
          {FIXTURE_ROSTER.map(bot => (
            <BotRow
              bot={bot}
              key={bot.name}
              onDelete={noop}
              onEdit={noop}
              onGroup={noop}
              onNewSection={noop}
            />
          ))}
        </div>
        <div className="shrink-0 border-t border-(--ui-stroke-quaternary) px-3 pt-2 pb-1 text-[11px] font-semibold tracking-[0.08em] text-(--ui-text-tertiary) uppercase">
          Groups
        </div>
        <div className="shrink-0 px-2 pb-3">
          <GroupRow
            active
            group={FIXTURE_ROOM}
            members={FIXTURE_MEMBERS}
            needsYou
            onDisband={noop}
            onNewSection={noop}
            onOpen={noop}
          />
        </div>
      </aside>
      <main className="min-w-0 flex-1 bg-(--ui-chat-surface-background)">
        <GroupChatWorkspace group={FIXTURE_ROOM} members={FIXTURE_MEMBERS} />
      </main>
      <aside className="w-[340px] shrink-0 border-l border-(--ui-stroke-quaternary) bg-(--ui-raised-background)">
        <BotContextPanel />
      </aside>
    </div>
  )
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

document.title = 'Bot Mode (offline harness)'
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <Harness />
    </ThemeProvider>
  </QueryClientProvider>
)
