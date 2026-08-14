import { host } from '@hermes/plugin-sdk'
import { useEffect, useMemo, useState } from 'react'
import { createBot, deleteBot, fetchAuditLogs, fetchBots, fetchRoutines, sendTurn } from './api'
import { BotAvatar } from './avatar'
import type { AuditEntry, Bot, Routine, ThreadMessage } from './types'

type Panel = 'computer' | 'settings' | 'routine' | 'create' | 'audit' | null

export function RakazoShell() {
  const [bots, setBots] = useState<Bot[]>([])
  const [activeId, setActiveId] = useState<string>('')
  const [search, setSearch] = useState('')
  const [panel, setPanel] = useState<Panel>(null)
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [routines, setRoutines] = useState<Routine[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([])
  const [computerActive, setComputerActive] = useState(true)
  const [hasControl, setHasControl] = useState(false)

  // Create Bot State
  const [newBotName, setNewBotName] = useState('')
  const [newBotDesc, setNewBotDesc] = useState('')
  const [newBotInst, setNewBotInst] = useState('')
  const [newBotColor, setNewBotColor] = useState('#8B5CF6')
  const [newBotApproval, setNewBotApproval] = useState<'auto' | 'strict'>('auto')

  // Routine Create State
  const [routineName, setRoutineName] = useState('')
  const [routinePrompt, setRoutinePrompt] = useState('')
  const [routineCron, setRoutineCron] = useState('0 8 * * 1-5')

  // Mock conversation history per bot
  const [messages, setMessages] = useState<Record<string, ThreadMessage[]>>({
    bot_cos_981a: [
      {
        id: 'm1',
        role: 'user',
        createdAt: '10:14 AM',
        blocks: [
          {
            kind: 'text',
            text: 'Sweep the inbox and draft replies for anything held. Keep Nora’s contract renewal at top of the queue.',
          },
        ],
      },
      {
        id: 'm2',
        role: 'bot',
        createdAt: '10:15 AM',
        blocks: [
          {
            kind: 'text',
            text: 'On it. 41 unread since Friday. Archiving noise, drafting replies in your voice.',
          },
          {
            kind: 'card',
            lines: [
              { k: 'Archived', v: '26 newsletters + receipts' },
              { k: 'Replied', v: '9 routine scheduling threads' },
              { k: 'Drafted', v: '6 in your voice · held for review' },
              { k: 'Flagged', v: '1 from Nora · renewal quote' },
            ],
          },
          {
            kind: 'ask',
            text: 'Nora’s renewal quote is drafted with the 12% multi-year discount applied. Ready to send?',
            detail: 'To: nora@acme.corp\nSubject: Re: Enterprise Renewal 2026-2027\nAttachment: contract-v2.pdf (signed draft)',
          },
        ],
      },
    ],
    bot_scout_10b9: [
      {
        id: 's1',
        role: 'user',
        createdAt: '3:05 AM',
        blocks: [
          {
            kind: 'text',
            text: 'Run autonomous scan on high-bandwidth optical interconnects & EUV pellicle startups.',
          },
        ],
      },
      {
        id: 's2',
        role: 'bot',
        createdAt: '3:10 AM',
        blocks: [
          {
            kind: 'subagent',
            agentId: 'sub_euv_01',
            name: 'Paper Scanner Subagent',
            task: 'Scanned 14 arXiv submissions and patents',
            status: 'completed',
            result: 'Identified 3 breakthroughs in CNT pellicle thermal dissipation.',
          },
          {
            kind: 'card',
            lines: [
              { k: 'Synthesized', v: '40 accounts & startups analyzed' },
              { k: 'Queued', v: '18 briefing cards stored in memory/' },
            ],
          },
          {
            kind: 'text',
            text: 'Full research dossier written to `workspace/euv_brief_2026.md`.',
          },
        ],
      },
    ],
    bot_mon_7c3a: [
      {
        id: 'mon1',
        role: 'user',
        createdAt: 'Monday',
        blocks: [
          {
            kind: 'text',
            text: 'Verify all 6 homelab host services, ZFS pool, and backup snapshots.',
          },
        ],
      },
      {
        id: 'mon2',
        role: 'bot',
        createdAt: 'Monday',
        blocks: [
          {
            kind: 'card',
            lines: [
              { k: 'NVMe Drive', v: 'Healthy · 24% used · 340GB free' },
              { k: 'ZFS Pool', v: 'ONLINE · 0 errors · scrubbed 2d ago' },
              { k: 'Backups', v: 'Nightly vzdump verified at 02:30 CT' },
              { k: 'Tailscale', v: 'Mesh connected · 100.84.81.81 active' },
            ],
          },
        ],
      },
    ],
  })

  useEffect(() => {
    fetchBots().then((list) => {
      setBots(list)
      if (list.length > 0 && !activeId) {
        setActiveId(list[0].id)
      }
    })
  }, [])

  const activeBot = useMemo(() => bots.find((b) => b.id === activeId) || bots[0], [bots, activeId])

  useEffect(() => {
    if (activeBot) {
      fetchRoutines(activeBot.id).then(setRoutines)
      fetchAuditLogs(activeBot.id).then(setAuditLogs)
    }
  }, [activeBot?.id])

  const filteredBots = useMemo(
    () =>
      bots.filter(
        (b) =>
          b.name.toLowerCase().includes(search.toLowerCase()) ||
          (b.description && b.description.toLowerCase().includes(search.toLowerCase()))
      ),
    [bots, search]
  )

  const activeMessages = useMemo(() => (activeBot ? messages[activeBot.id] || [] : []), [messages, activeBot?.id])

  const handleSend = async () => {
    if (!draft.trim() || !activeBot) return
    const text = draft
    setDraft('')
    setIsSending(true)

    const userMsg: ThreadMessage = {
      id: 'm_' + Date.now(),
      role: 'user',
      createdAt: 'Just now',
      blocks: [{ kind: 'text', text }],
    }

    setMessages((prev) => ({
      ...prev,
      [activeBot.id]: [...(prev[activeBot.id] || []), userMsg],
    }))

    try {
      await sendTurn(activeBot.id, text)
      // Simulate bot streaming turn response
      setTimeout(() => {
        const botReply: ThreadMessage = {
          id: 'reply_' + Date.now(),
          role: 'bot',
          createdAt: 'Just now',
          blocks: [
            {
              kind: 'text',
              text: `Acknowledged. ${activeBot.name} is processing: "${text}"`,
            },
            {
              kind: 'card',
              lines: [
                { k: 'Task', v: 'Dispatched to sandbox workspace' },
                { k: 'Status', v: 'Executing via Hermes agent core' },
              ],
            },
          ],
        }
        setMessages((prev) => ({
          ...prev,
          [activeBot.id]: [...(prev[activeBot.id] || []), botReply],
        }))
        setIsSending(false)
      }, 1200)
    } catch (err) {
      setIsSending(false)
    }
  }

  const handleCreateBot = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newBotName.trim()) return
    try {
      const created = await createBot({
        name: newBotName,
        description: newBotDesc,
        instructions: newBotInst,
        color: newBotColor,
        approval_mode: newBotApproval,
      })
      const updated = await fetchBots()
      setBots(updated)
      setActiveId(created.id)
      setPanel(null)
      setNewBotName('')
      setNewBotDesc('')
      setNewBotInst('')
      host.notify({ kind: 'info', message: `Bot ${created.name} spawned!` })
    } catch (err: any) {
      host.notify({ kind: 'error', message: err.message || 'Creation failed' })
    }
  }

  const handleDeleteActiveBot = async () => {
    if (!activeBot) return
    await deleteBot(activeBot.id)
    const updated = await fetchBots()
    setBots(updated)
    if (updated.length > 0) setActiveId(updated[0].id)
    setPanel(null)
    host.notify({ kind: 'info', message: `Bot deleted.` })
  }

  return (
    <div className="relative flex h-full w-full select-none overflow-hidden bg-[#050506] text-[#DFDFE2]">
      {/* 1. LEFT ROSTER SIDEBAR (Exact Rakazo 316px layout) */}
      <aside className="flex w-[316px] shrink-0 flex-col border-r border-[#171719] bg-[#0B0B0C]">
        {/* Top Header */}
        <div className="flex items-center justify-between px-[18px] pb-3 pt-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1A1A1E]">
              <span className="h-2.5 w-1 rounded-full bg-[#F7F7F4]" />
              <span className="ml-1 h-2.5 w-1 rounded-full bg-[#F7F7F4]" />
            </div>
            <span className="font-semibold text-[17px] tracking-tight text-[#ECECEE]">Rakazo</span>
          </div>
          <button
            type="button"
            onClick={() => setPanel('create')}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#18181B] text-[20px] text-[#A8A8AD] transition hover:bg-[#24242A] hover:text-[#ECECEE]"
            title="Create new bot"
          >
            +
          </button>
        </div>

        {/* Search Bar */}
        <div className="mx-3.5 mb-3 flex items-center gap-2.5 rounded-xl border border-[#202023] bg-[#141416] px-3 py-2 text-[14px] text-[#6C6C70]">
          <span className="text-[15px]">⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search bots..."
            className="w-full bg-transparent text-[13.5px] text-[#ECECEE] outline-none placeholder-[#5A5A60]"
          />
        </div>

        {/* Bot Roster List */}
        <div className="rk-scroll flex flex-1 flex-col gap-1 overflow-y-auto px-2.5 pb-2.5">
          {filteredBots.map((bot) => {
            const isSelected = activeBot && activeBot.id === bot.id
            return (
              <button
                key={bot.id}
                type="button"
                onClick={() => setActiveId(bot.id)}
                className="flex w-full gap-3 rounded-xl px-2.5 py-[11px] text-left transition-colors"
                style={{
                  background: isSelected ? '#161618' : 'transparent',
                }}
              >
                <BotAvatar color={bot.color} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[14.5px] font-medium text-[#ECECEE]">{bot.name}</span>
                    <span className="shrink-0 text-[11.5px] font-medium text-[#6C6C70]">
                      {bot.time_label || (bot.approval_mode === 'strict' ? 'strict' : '')}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-[12.5px] text-[#85858A]">
                    {bot.preview || bot.description || bot.title}
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Bottom Profile Pill */}
        <div className="border-t border-[#171719] p-3">
          <div className="flex items-center gap-2.5 rounded-xl bg-[#141416] p-2">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[#232326] text-[12px] font-bold text-[#A8A8AD]">
              RP
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-semibold text-[#ECECEE]">Ritesh Patel</div>
              <div className="truncate text-[11.5px] text-[#4ECB71]">● Local Homelab Active</div>
            </div>
          </div>
        </div>
      </aside>

      {/* 2. CENTER CHAT & WORKFLOW AREA (bg-[#0D0D0E]) */}
      <main className="flex min-w-0 flex-1 flex-col bg-[#0D0D0E]">
        {/* Topbar */}
        <div className="flex items-center justify-between border-b border-[#141416] px-[22px] py-[15px]">
          <button
            type="button"
            onClick={() => setPanel((p) => (p === 'settings' ? null : 'settings'))}
            className="flex min-w-0 items-center gap-3 text-left transition hover:opacity-90"
          >
            {activeBot ? <BotAvatar color={activeBot.color} size={28} /> : null}
            <div className="min-w-0">
              <span className="block truncate text-[15.5px] font-medium text-[#ECECEE]">
                {activeBot?.name ?? 'Select a bot'}
              </span>
            </div>
          </button>

          {/* Right Icon Actions (Computer & Audit Triggers) */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              title="Audit Log"
              onClick={() => setPanel((p) => (p === 'audit' ? null : 'audit'))}
              className="grid h-[32px] w-[36px] place-items-center rounded-[9px] text-[#85858A] transition hover:bg-[#1B1B1E] hover:text-[#ECECEE]"
              style={{ background: panel === 'audit' ? '#1B1B1E' : 'transparent' }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </button>
            <button
              type="button"
              title="Agent Computer & Routines"
              onClick={() => setPanel((p) => (p === 'computer' ? null : 'computer'))}
              className="grid h-[32px] w-[36px] place-items-center rounded-[9px] text-[#85858A] transition hover:bg-[#1B1B1E] hover:text-[#ECECEE]"
              style={{ background: panel === 'computer' ? '#1B1B1E' : 'transparent' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <rect x="2" y="4" width="20" height="13" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
            </button>
          </div>
        </div>

        {/* Message Stream */}
        <div className="rk-scroll flex flex-1 flex-col gap-[14px] overflow-y-auto px-8 py-6">
          {activeMessages.map((msg) => (
            <div key={msg.id} className="flex flex-col gap-2">
              {msg.blocks.map((block, idx) => {
                if (block.kind === 'text' && msg.role === 'user') {
                  return (
                    <div key={idx} className="flex justify-end">
                      <div className="max-w-[70%] rounded-[20px] bg-[#F1F1EF] px-[18px] py-3 text-[15px] leading-[1.45] text-[#1A1A1A]">
                        {block.text}
                      </div>
                    </div>
                  )
                }
                if (block.kind === 'text') {
                  return (
                    <div key={idx} className="flex justify-start">
                      <div className="max-w-[74%] rounded-[20px] bg-[#1A1A1D] px-[18px] py-3 text-[15px] leading-[1.5] text-[#DFDFE2]">
                        {block.text}
                      </div>
                    </div>
                  )
                }
                if (block.kind === 'card') {
                  return (
                    <div key={idx} className="flex justify-start">
                      <div className="flex flex-col gap-2.5 rounded-[20px] bg-[#1A1A1D] px-5 py-4 shadow-lg border border-[#24242A]">
                        {block.lines.map((line, i) => (
                          <div key={i} className="flex items-baseline gap-2.5 text-[14.5px]">
                            <span className="font-bold text-[#30A24B]">✓</span>
                            <span className="font-semibold text-white">{line.k}</span>
                            <span className="text-[#85858A]">→</span>
                            <span className="text-[#DFDFE2]">{line.v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                }
                if (block.kind === 'ask') {
                  return (
                    <div
                      key={idx}
                      className="max-w-[74%] rounded-[20px] border border-[#2E2E36] bg-[#141417] px-5 py-[17px] shadow-xl"
                    >
                      <div className="text-[15px] leading-[1.5] text-[#ECECEE]">{block.text}</div>
                      {block.detail ? (
                        <pre className="mt-3 rounded-xl bg-[#0E0E10] px-3.5 py-3 font-mono text-[12px] leading-[1.7] text-[#85858A]">
                          {block.detail}
                        </pre>
                      ) : null}
                      <div className="mt-3.5 flex gap-2">
                        <button
                          type="button"
                          onClick={() => host.notify({ kind: 'info', message: 'Action Approved & Sent' })}
                          className="rounded-[11px] bg-[#F1F1EF] px-[17px] py-2 text-[14px] font-semibold text-[#17171A] transition hover:bg-white"
                        >
                          Send it
                        </button>
                        <button
                          type="button"
                          onClick={() => host.notify({ kind: 'info', message: 'Opening in editor...' })}
                          className="rounded-[11px] border border-[#26262A] px-[17px] py-2 text-[14px] text-[#C9C9CE] hover:bg-[#1A1A1D]"
                        >
                          Edit first
                        </button>
                      </div>
                    </div>
                  )
                }
                if (block.kind === 'subagent') {
                  return (
                    <div
                      key={idx}
                      className="w-[min(440px,90%)] rounded-[18px] border border-[#232326] bg-[#17171A] px-[18px] py-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[15px] font-medium text-[#ECECEE]">{block.name}</span>
                        <span className="rounded-full bg-[rgba(48,162,75,.14)] px-[11px] py-1 text-[12px] font-semibold text-[#4ECB71]">
                          {block.status}
                        </span>
                      </div>
                      <div className="mt-1.5 text-[13px] text-[#85858A]">{block.task}</div>
                      {block.result ? (
                        <div className="mt-2.5 text-[14px] leading-[1.5] text-[#A8A8AD]">{block.result}</div>
                      ) : null}
                    </div>
                  )
                }
                return null
              })}
            </div>
          ))}

          {isSending && (
            <div className="flex justify-start">
              <div className="rk-pulse rounded-[20px] bg-[#1A1A1D] px-[18px] py-[12px] text-[14.5px] text-[#85858A]">
                working…
              </div>
            </div>
          )}
        </div>

        {/* Bottom Rounded Pill Composer */}
        <div className="px-6 pb-6 pt-3">
          <div className="flex items-center gap-3.5 rounded-full border border-[#202023] bg-[#131315] py-[9px] pr-2.5 pl-3 shadow-2xl">
            <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full border border-[#26262A] text-[18px] text-[#9A9AA0]">
              +
            </span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder={activeBot ? `Message ${activeBot.name}...` : 'Message...'}
              className="flex-1 bg-transparent text-[15px] text-[#E9E9EA] outline-none placeholder-[#5A5A60]"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!draft.trim() || isSending}
              className="grid h-9 w-9 place-items-center rounded-full bg-[#F1F1EF] text-[16px] font-bold text-[#17171A] transition hover:bg-white disabled:opacity-40"
            >
              ↑
            </button>
          </div>
        </div>
      </main>

      {/* 3. RIGHT SLIDING PANEL (Computer / Routines / Settings / Audit) */}
      <aside
        className={`flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-[#0A0A0B] transition-[width] duration-200 ease-out ${
          panel && activeBot ? 'w-[384px] border-l border-[#141416]' : 'w-0'
        }`}
      >
        {panel && activeBot ? (
          <div className="rk-scroll h-full w-[384px] overflow-y-auto px-5 py-[17px]">
            {/* Header with Close */}
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[13.5px] font-medium text-[#85858A]">
                {panel === 'computer'
                  ? `${activeBot.name}'s sandbox`
                  : panel === 'settings'
                  ? 'Bot Settings'
                  : panel === 'routine'
                  ? 'New Routine'
                  : 'Audit Log'}
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setPanel('settings')}
                  className="text-[#85858A] hover:text-white"
                  title="Settings"
                >
                  ⚙
                </button>
                <button
                  type="button"
                  onClick={() => setPanel(null)}
                  className="text-[#85858A] hover:text-white"
                  title="Close panel"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* COMPUTER / SANDBOX VIEW */}
            {panel === 'computer' && (
              <div>
                {/* Virtual Screen Aspect Box */}
                <div className="relative aspect-[16/10] overflow-hidden rounded-[14px] border border-[#202024] bg-[#0E0E10] p-3 font-mono text-[11px] text-[#A8A8AD]">
                  <div className="flex items-center justify-between border-b border-[#1E1E22] pb-2 text-[#5E5E66]">
                    <span>workspace: {activeBot.workspace_path}</span>
                    <span className="flex h-2 w-2 rounded-full bg-[#4ECB71]" />
                  </div>
                  <div className="mt-3 space-y-1 text-emerald-400">
                    <div>$ hermes kanban list</div>
                    <div className="text-[#85858A]">● [RUNNING] 41 threads processed</div>
                    <div className="text-[#85858A]">● [ROUTINE] 8:15 AM Market Intel Sweep</div>
                    <div className="text-cyan-400">$ hermes memory {activeBot.name} read</div>
                    <div className="text-[#85858A]">Loaded 2 persistent docs</div>
                  </div>
                </div>

                {/* Take Control Bar */}
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[13px] text-[#85858A]">
                    {hasControl ? 'You have control' : `${activeBot.name} is running`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setHasControl(!hasControl)}
                    className="rounded-lg border border-[#2A2A30] bg-[#141417] px-3 py-1.5 text-xs font-semibold text-[#ECECEE] hover:bg-[#1E1E24]"
                  >
                    {hasControl ? 'Release Control' : 'Take Control'}
                  </button>
                </div>

                {/* Routines Section */}
                <div className="mt-6 mb-3 text-[14px] font-semibold text-[#85858A]">Automated Routines</div>
                <div className="space-y-2">
                  {routines.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between rounded-[11px] border border-[#1A1A1E] bg-[#121214] p-3"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-[#E65707]">◷</span>
                        <div>
                          <div className="text-[14px] font-medium text-[#ECECEE]">{r.name}</div>
                          <div className="text-[12px] text-[#6C6C70]">{r.schedule_label}</div>
                        </div>
                      </div>
                      <span className="text-[11px] text-[#4ECB71]">Active</span>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setPanel('routine')}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-[11px] border border-[#222228] bg-[#121215] py-2.5 text-[13.5px] font-medium text-[#A8A8AD] hover:bg-[#18181D] hover:text-white"
                >
                  + Add Scheduled Routine
                </button>
              </div>
            )}

            {/* ROUTINE FORM */}
            {panel === 'routine' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-[#85858A]">Routine Name</label>
                  <input
                    value={routineName}
                    onChange={(e) => setRoutineName(e.target.value)}
                    placeholder="e.g. Daily Standup Draft"
                    className="mt-1.5 w-full rounded-lg border border-[#26262A] bg-[#141416] p-2.5 text-xs text-[#ECECEE] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#85858A]">Instructions Prompt</label>
                  <textarea
                    rows={4}
                    value={routinePrompt}
                    onChange={(e) => setRoutinePrompt(e.target.value)}
                    placeholder="What should the bot do on each tick?"
                    className="mt-1.5 w-full rounded-lg border border-[#26262A] bg-[#141416] p-2.5 text-xs text-[#ECECEE] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#85858A]">Cron Expression</label>
                  <input
                    value={routineCron}
                    onChange={(e) => setRoutineCron(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-[#26262A] bg-[#141416] p-2.5 font-mono text-xs text-[#ECECEE] outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    host.notify({ kind: 'info', message: 'Routine attached to bot!' })
                    setPanel('computer')
                  }}
                  className="w-full rounded-lg bg-[#F1F1EF] py-2.5 text-xs font-bold text-[#17171A] hover:bg-white"
                >
                  Save Routine
                </button>
              </div>
            )}

            {/* SETTINGS VIEW */}
            {panel === 'settings' && (
              <div className="space-y-4 text-xs">
                <div>
                  <span className="text-[#85858A]">Bot Name</span>
                  <div className="mt-1 font-semibold text-sm text-white">{activeBot.name}</div>
                </div>
                <div>
                  <span className="text-[#85858A]">Role Description</span>
                  <div className="mt-1 text-[#C9C9CE]">{activeBot.description}</div>
                </div>
                <div>
                  <span className="text-[#85858A]">Sandbox Workspace</span>
                  <div className="mt-1 rounded bg-[#141416] p-2 font-mono text-[11px] text-cyan-400">
                    {activeBot.workspace_path}
                  </div>
                </div>
                <div>
                  <span className="text-[#85858A]">Approval Mode</span>
                  <div className="mt-1 uppercase font-bold text-amber-400">{activeBot.approval_mode}</div>
                </div>
                <div className="pt-4 border-t border-[#1C1C20]">
                  <button
                    type="button"
                    onClick={handleDeleteActiveBot}
                    className="w-full rounded-lg border border-red-500/30 bg-red-500/10 py-2.5 text-xs font-semibold text-red-400 hover:bg-red-500/20"
                  >
                    Delete Bot
                  </button>
                </div>
              </div>
            )}

            {/* AUDIT LOG VIEW */}
            {panel === 'audit' && (
              <div className="space-y-2">
                <div className="text-[12px] font-mono text-[#6C6C70]">Immutable SQLite Tool Logs:</div>
                {auditLogs.map((log, i) => (
                  <div key={i} className="rounded-lg border border-[#1E1E24] bg-[#121215] p-3 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white font-mono">{log.tool_name}</span>
                      <span className="text-[10px] uppercase font-semibold text-emerald-400">{log.approved_by}</span>
                    </div>
                    <div className="font-mono text-[11px] text-[#85858A] truncate">{log.tool_args}</div>
                    {log.result_summary && (
                      <div className="font-mono text-[10px] text-[#5A5A60] truncate">{log.result_summary}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </aside>

      {/* CREATE BOT MODAL */}
      {panel === 'create' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <form
            onSubmit={handleCreateBot}
            className="w-[420px] rounded-2xl border border-[#26262C] bg-[#121214] p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[16px] font-bold text-white">Create AI Bot</h3>
              <button
                type="button"
                onClick={() => setPanel(null)}
                className="text-[#85858A] hover:text-white"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#85858A]">Bot Name</label>
              <input
                required
                value={newBotName}
                onChange={(e) => setNewBotName(e.target.value)}
                placeholder="e.g. Sales Outbound"
                className="mt-1.5 w-full rounded-xl border border-[#222226] bg-[#18181B] px-3.5 py-2.5 text-xs text-white outline-none focus:border-[#6A6BF5]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#85858A]">Role & Description</label>
              <input
                value={newBotDesc}
                onChange={(e) => setNewBotDesc(e.target.value)}
                placeholder="What does this bot own?"
                className="mt-1.5 w-full rounded-xl border border-[#222226] bg-[#18181B] px-3.5 py-2.5 text-xs text-white outline-none focus:border-[#6A6BF5]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#85858A]">System Instructions</label>
              <textarea
                rows={3}
                value={newBotInst}
                onChange={(e) => setNewBotInst(e.target.value)}
                placeholder="Persona, constraints, and operational guidelines..."
                className="mt-1.5 w-full rounded-xl border border-[#222226] bg-[#18181B] px-3.5 py-2.5 text-xs text-white outline-none focus:border-[#6A6BF5]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#85858A]">Approval Mode</label>
                <select
                  value={newBotApproval}
                  onChange={(e) => setNewBotApproval(e.target.value as any)}
                  className="mt-1.5 w-full rounded-xl border border-[#222226] bg-[#18181B] px-3 py-2 text-xs text-white outline-none"
                >
                  <option value="auto">Auto (Autonomous)</option>
                  <option value="strict">Strict (Ask User)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#85858A]">Avatar Color</label>
                <div className="mt-1.5 flex items-center gap-2">
                  {['#8B5CF6', '#10B981', '#06B6D4', '#F59E0B', '#F43F5E'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewBotColor(c)}
                      className="h-6 w-6 rounded-full transition transform hover:scale-110"
                      style={{
                        backgroundColor: c,
                        boxShadow: newBotColor === c ? '0 0 0 2px #fff' : 'none',
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-[#1C1C22]">
              <button
                type="button"
                onClick={() => setPanel(null)}
                className="rounded-xl px-4 py-2 text-xs font-medium text-[#85858A] hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-[#F1F1EF] px-4 py-2 text-xs font-bold text-[#17171A] hover:bg-white"
              >
                Create Bot
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
