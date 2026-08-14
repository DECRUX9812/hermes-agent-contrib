import './fleet.css'

import { host } from '@hermes/plugin-sdk'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_HERMES_SQUAD,
  ensureAgentSession,
  fetchHermesAgents,
  fetchLiveHistory,
  spawnRakazoBot,
  submitLivePrompt,
  updateAgentSettings,
} from './api'
import { HermesAvatar } from './avatar'
import type { HermesAgent, LiveToolCall, LiveTurnMessage, Routine } from './types'

type Tab = 'chat' | 'matrix' | 'routines' | 'audit' | 'config'

export function HermesFleetShell() {
  const [agents, setAgents] = useState<HermesAgent[]>(DEFAULT_HERMES_SQUAD)
  const [activeId, setActiveId] = useState<string>('agent_prime')
  const [currentTab, setCurrentTab] = useState<Tab>('chat')
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [liveTools, setLiveTools] = useState<LiveToolCall[]>([])
  const [expandedTools, setExpandedTools] = useState<Record<number, boolean>>({})

  // Modal / Drawer
  const [showNewAgentModal, setShowNewAgentModal] = useState(false)
  const [spawnName, setSpawnName] = useState('')
  const [spawnRole, setSpawnRole] = useState('')
  const [spawnInst, setSpawnInst] = useState('')
  const [spawnModel, setSpawnModel] = useState('deepseek-v4-flash')
  const [spawnApproval, setSpawnApproval] = useState<'auto' | 'strict'>('auto')

  // Edit config
  const [editModel, setEditModel] = useState('deepseek-v4-flash')
  const [editApproval, setEditApproval] = useState<'auto' | 'strict'>('auto')
  const [editInst, setEditInst] = useState('')

  // Conversation history per agent
  const [conversation, setConversation] = useState<Record<string, LiveTurnMessage[]>>({
    agent_prime: [
      {
        id: 'init_1',
        role: 'assistant',
        text: "Hey Ritesh! I'm Hermes Prime. I coordinate the fleet, synthesize findings across Scout, Architect, and Guardian, and keep your tasks moving forward with high precision. What are we building today?",
        createdAt: Date.now() - 60000,
      },
    ],
    agent_scout: [
      {
        id: 'init_2',
        role: 'assistant',
        text: "Scout 01 online. Ready to scour arXiv preprints, SEC filings, GitHub codebases, and live market intelligence. Give me a target or query to research.",
        createdAt: Date.now() - 45000,
      },
    ],
    agent_architect: [
      {
        id: 'init_3',
        role: 'assistant',
        text: "Architect ready. Worktrees and test environments are clean. Drop the spec or feature requirements and I'll build and verify them with zero regressions.",
        createdAt: Date.now() - 30000,
      },
    ],
    agent_guardian: [
      {
        id: 'init_4',
        role: 'assistant',
        text: "Guardian sentry monitoring host health, ZFS snapshots, and storage pools. Strict approval gate is active — I'll safeguard your environment before any destructive actions.",
        createdAt: Date.now() - 15000,
      },
    ],
  })

  const runtimeSessionIdRef = useRef<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation, activeId, isStreaming])

  // Poll real bots from SQLite backend
  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      const { agents: fresh, live } = await fetchHermesAgents()
      if (cancelled || !live) return
      setAgents((prev) => {
        const prevById = new Map(prev.map((a) => [a.id, a]))
        return fresh.map((f) => {
          const p = prevById.get(f.id)
          return p && !f.session_id ? { ...f, session_id: p.session_id, routines: p.routines || f.routines } : f
        })
      })
    }
    poll()
    const timer = setInterval(poll, 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const activeAgent = useMemo(() => agents.find((a) => a.id === activeId) || agents[0], [agents, activeId])

  useEffect(() => {
    if (!activeAgent) return
    setEditModel(activeAgent.model)
    setEditApproval(activeAgent.approval_mode)
    setEditInst(activeAgent.instructions)
  }, [activeAgent?.id])

  // Session attach and history fetch
  useEffect(() => {
    if (!activeAgent) return
    let cancelled = false
    runtimeSessionIdRef.current = null
    ensureAgentSession(activeAgent).then((sid) => {
      if (cancelled) return
      runtimeSessionIdRef.current = sid
      if (sid) {
        fetchLiveHistory(sid).then((history) => {
          if (!cancelled && history.length > 0) {
            setConversation((prev) => ({ ...prev, [activeAgent.id]: history }))
          }
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [activeAgent?.id])

  // Live Gateway event subscriptions
  useEffect(() => {
    const unsubs: Array<() => void> = []

    try {
      const unsubDelta = host.onEvent('message.delta', (event: any) => {
        if (!activeAgent) return
        const sid = event?.session_id
        if (!sid || sid !== runtimeSessionIdRef.current) return
        const text = event?.payload?.text
        if (!text) return
        setConversation((prev) => {
          const current = prev[activeAgent.id] || []
          const last = current[current.length - 1]
          if (last && last.role === 'assistant') {
            return {
              ...prev,
              [activeAgent.id]: [
                ...current.slice(0, -1),
                { ...last, text: last.text + text },
              ],
            }
          } else {
            return {
              ...prev,
              [activeAgent.id]: [
                ...current,
                { id: `stream_${Date.now()}`, role: 'assistant', text, createdAt: Date.now() },
              ],
            }
          }
        })
      })
      if (typeof unsubDelta === 'function') unsubs.push(unsubDelta)
    } catch (e) {}

    try {
      const unsubTool = host.onEvent('tool.start', (event: any) => {
        const sid = event?.session_id
        if (!sid || sid !== runtimeSessionIdRef.current) return
        const payload = event?.payload
        if (!payload?.tool) return
        setLiveTools((prev) => [
          {
            tool: payload.tool,
            args: payload.args || {},
            status: 'running',
            timestamp: Date.now(),
          },
          ...prev.slice(0, 19),
        ])
      })
      if (typeof unsubTool === 'function') unsubs.push(unsubTool)
    } catch (e) {}

    try {
      const unsubComplete = host.onEvent('message.complete', (event: any) => {
        const sid = event?.session_id
        if (!sid || sid !== runtimeSessionIdRef.current) return
        setIsStreaming(false)
      })
      if (typeof unsubComplete === 'function') unsubs.push(unsubComplete)
    } catch (e) {}

    return () => {
      unsubs.forEach((fn) => {
        try {
          fn()
        } catch (e) {}
      })
    }
  }, [activeAgent?.id])

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText || draft).trim()
    if (!text || !activeAgent) return
    if (!overrideText) setDraft('')
    setIsStreaming(true)

    const userMsg: LiveTurnMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      text,
      createdAt: Date.now(),
    }

    setConversation((prev) => ({
      ...prev,
      [activeAgent.id]: [...(prev[activeAgent.id] || []), userMsg],
    }))

    const sid = await ensureAgentSession(activeAgent)
    if (sid) {
      setAgents((prev) => prev.map((a) => (a.id === activeAgent.id ? { ...a, session_id: sid } : a)))
      runtimeSessionIdRef.current = sid
    }
    await submitLivePrompt(sid, text, activeAgent.id)

    setTimeout(() => {
      setIsStreaming(false)
    }, 3000)
  }

  const handleSpawn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!spawnName.trim()) return

    try {
      const created = await spawnRakazoBot({
        name: spawnName,
        description: spawnRole,
        instructions: spawnInst,
        color: '#FFFFFF',
        approval_mode: spawnApproval,
        model: spawnModel,
      })
      setActiveId(created.id)
      setShowNewAgentModal(false)
      setSpawnName('')
      setSpawnRole('')
      setSpawnInst('')
      host.notify({ kind: 'info', message: `Spawned ${spawnName}` })
      return
    } catch (err) {}

    const newAgent: HermesAgent = {
      id: `agent_${Date.now().toString(36)}`,
      name: spawnName,
      role: spawnRole || 'Autonomous Operator',
      description: spawnRole,
      instructions: spawnInst || 'Decisive and helpful execution.',
      color: '#FFFFFF',
      badge: spawnApproval === 'strict' ? 'STRICT SENTRY' : 'AUTONOMOUS',
      model: spawnModel || 'deepseek-v4-flash',
      status: 'active',
      approval_mode: spawnApproval,
      workspace_path: `~/.hermes/fleet/${spawnName.toLowerCase().replace(/\s+/g, '_')}/workspace`,
      run_count: 0,
    }
    setAgents([newAgent, ...agents])
    setActiveId(newAgent.id)
    setShowNewAgentModal(false)
    setSpawnName('')
    setSpawnRole('')
    setSpawnInst('')
    host.notify({ kind: 'info', message: `Spawned ${spawnName}` })
  }

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeAgent) return
    await updateAgentSettings(activeAgent.id, {
      model: editModel,
      approval_mode: editApproval,
      instructions: editInst,
    })
    setAgents((prev) =>
      prev.map((a) =>
        a.id === activeAgent.id
          ? { ...a, model: editModel, approval_mode: editApproval, instructions: editInst }
          : a
      )
    )
    host.notify({ kind: 'info', message: `Saved settings for ${activeAgent.name}` })
    setCurrentTab('chat')
  }

  const handleOpenInMainChat = () => {
    if (!activeAgent?.session_id) return
    host.openSession(activeAgent.session_id)
    host.notify({ kind: 'info', message: `Opened ${activeAgent.name} in Desktop Chat` })
  }

  const activeMessages = useMemo(
    () => (activeAgent ? conversation[activeAgent.id] || [] : []),
    [conversation, activeAgent?.id]
  )

  const filteredAgents = useMemo(() => {
    return agents.filter((a) => (a.name + ' ' + a.role).toLowerCase().includes(search.toLowerCase()))
  }, [agents, search])

  const allRoutines: Routine[] = useMemo(() => {
    return agents.flatMap((a) => a.routines || [])
  }, [agents])

  const suggestedPrompts = [
    'Synthesize current project state and highlight key priorities',
    'Run research scan on latest high-NA EUV developments',
    'Execute comprehensive codebase defect audit',
    'Verify host backup status and storage health',
  ]

  const toggleToolExpand = (idx: number) => {
    setExpandedTools((prev) => ({ ...prev, [idx]: !prev[idx] }))
  }

  return (
    <div className="hermes-gpt-root flex h-full w-full select-none overflow-hidden text-[#FFFFFF] bg-[#0d0e12]">
      {/* 1. SIDEBAR (Minimalist ChatGPT/Grok Style) */}
      <aside className="flex w-[290px] shrink-0 flex-col border-r border-[rgba(255,255,255,0.08)] bg-[#13151b]">
        {/* Brand & New Agent Trigger */}
        <div className="p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <HermesAvatar name="Hermes" size={28} />
              <div className="flex items-center gap-1.5 font-bold text-sm tracking-tight text-white">
                <span>Hermes Fleet</span>
              </div>
            </div>
            <button
              onClick={() => setShowNewAgentModal(true)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[rgba(255,255,255,0.12)] text-xs text-[#9496a1] hover:text-white hover:bg-[rgba(255,255,255,0.06)] transition"
              title="Spawn Operator"
            >
              +
            </button>
          </div>

          {/* Quick Search Field */}
          <div className="flex items-center gap-2 rounded-xl bg-[#1c1e27] px-3 py-1.5 text-xs text-[#9496a1] border border-[rgba(255,255,255,0.06)] focus-within:border-[rgba(255,255,255,0.2)]">
            <span>⌕</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search squad..."
              className="w-full bg-transparent text-white outline-none placeholder-[#5e606e]"
            />
          </div>
        </div>

        {/* Squad Agent Selector */}
        <div className="clean-scroll flex flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2">
          <div className="px-2 py-1 text-[11px] font-medium text-[#5e606e] tracking-wider uppercase">
            Squad Operators
          </div>

          {filteredAgents.map((agent) => {
            const isSelected = activeAgent && activeAgent.id === agent.id
            const isLive = agent.status === 'running' || agent.status === 'working' || agent.status === 'active'
            return (
              <button
                key={agent.id}
                onClick={() => {
                  setActiveId(agent.id)
                  setCurrentTab('chat')
                }}
                className={`group flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all ${
                  isSelected
                    ? 'bg-[#21232d] text-white shadow-sm'
                    : 'text-[#9496a1] hover:bg-[#181a22] hover:text-white'
                }`}
              >
                <HermesAvatar name={agent.name} color={agent.color} size={26} isLive={isLive} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="truncate text-xs font-medium">{agent.name}</span>
                    {agent.approval_mode === 'strict' && (
                      <span className="text-[9px] font-mono rounded bg-red-950/80 px-1 text-red-400 border border-red-800/40">
                        LOCK
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-[#5e606e]">{agent.role}</div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Gateway & Profile Footer */}
        <div className="border-t border-[rgba(255,255,255,0.08)] p-3 space-y-2">
          <div className="flex items-center justify-between text-xs text-[#9496a1]">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-white font-medium text-xs">Gateway 100.84.81.81</span>
            </div>
            <span className="text-[10px] font-mono text-[#5e606e]">ACTIVE</span>
          </div>
        </div>
      </aside>

      {/* 2. MAIN CONVERSATIONAL CANVAS */}
      <main className="flex min-w-0 flex-1 flex-col bg-[#0d0e12]">
        {/* Header with Agent Meta & Tabs */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[rgba(255,255,255,0.08)] bg-[#0d0e12] px-6">
          <div className="flex items-center gap-3">
            <HermesAvatar name={activeAgent.name} color={activeAgent.color} size={28} />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-white">{activeAgent.name}</span>
                <span className="text-xs font-mono text-[#5e606e]">·</span>
                <span className="text-xs font-mono text-[#9496a1]">{activeAgent.model}</span>
                {activeAgent.session_id && (
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-1.5 py-0.2 rounded border border-emerald-800/30">
                    WIRED
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Clean Segmented Navigation */}
          <div className="flex items-center gap-1 rounded-full bg-[#181a22] p-1 border border-[rgba(255,255,255,0.08)] text-xs font-medium">
            <button
              onClick={() => setCurrentTab('chat')}
              className={`rounded-full px-3.5 py-1 transition ${
                currentTab === 'chat' ? 'bg-white text-black font-semibold' : 'text-[#9496a1] hover:text-white'
              }`}
            >
              Chat
            </button>
            <button
              onClick={() => setCurrentTab('matrix')}
              className={`rounded-full px-3.5 py-1 transition ${
                currentTab === 'matrix' ? 'bg-white text-black font-semibold' : 'text-[#9496a1] hover:text-white'
              }`}
            >
              Squad Matrix
            </button>
            <button
              onClick={() => setCurrentTab('routines')}
              className={`rounded-full px-3.5 py-1 transition ${
                currentTab === 'routines' ? 'bg-white text-black font-semibold' : 'text-[#9496a1] hover:text-white'
              }`}
            >
              Routines
            </button>
            <button
              onClick={() => setCurrentTab('audit')}
              className={`rounded-full px-3.5 py-1 transition ${
                currentTab === 'audit' ? 'bg-white text-black font-semibold' : 'text-[#9496a1] hover:text-white'
              }`}
            >
              Audit
            </button>
            <button
              onClick={() => setCurrentTab('config')}
              className={`rounded-full px-3.5 py-1 transition ${
                currentTab === 'config' ? 'bg-white text-black font-semibold' : 'text-[#9496a1] hover:text-white'
              }`}
            >
              Config
            </button>
          </div>
        </header>

        {/* TAB 1: CONVERSATIONAL STREAM */}
        {currentTab === 'chat' && (
          <div className="flex flex-1 flex-col justify-between overflow-hidden">
            <div className="clean-scroll flex-1 overflow-y-auto px-6 py-8 md:px-24 lg:px-44 space-y-6">
              {activeMessages.map((msg, idx) => (
                <div key={idx} className="flex flex-col gap-2">
                  {msg.role === 'user' ? (
                    <div className="flex justify-end">
                      <div className="user-msg-bubble max-w-[80%] px-5 py-3 text-[14.5px] leading-relaxed">
                        {msg.text}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-4">
                      <HermesAvatar name={activeAgent.name} color={activeAgent.color} size={28} />
                      <div className="max-w-[90%] text-[15px] leading-relaxed text-[#ECECED] space-y-2 whitespace-pre-wrap">
                        {msg.text}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {isStreaming && (
                <div className="flex items-center gap-3 text-xs text-[#9496a1] font-mono py-2">
                  <span className="h-2 w-2 rounded-full bg-white animate-ping" />
                  <span>{activeAgent.name} is streaming response via Hermes Gateway…</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Floating Hairline Composer */}
            <div className="px-6 pb-6 md:px-24 lg:px-44">
              {activeMessages.length <= 2 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {suggestedPrompts.map((prompt, i) => (
                    <button
                      key={i}
                      onClick={() => handleSend(prompt)}
                      className="prompt-pill px-3.5 py-1.5 text-xs text-[#9496a1] hover:text-white"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}

              <div className="floating-composer flex items-center gap-3 px-4 py-3">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSend()
                  }}
                  placeholder={`Message ${activeAgent.name}...`}
                  className="flex-1 bg-transparent text-[15px] text-white outline-none placeholder-[#5e606e]"
                />
                <button
                  onClick={() => handleSend()}
                  disabled={!draft.trim() || isStreaming}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black font-bold text-sm transition hover:opacity-90 disabled:opacity-30"
                >
                  ↑
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: SQUAD MATRIX */}
        {currentTab === 'matrix' && (
          <div className="clean-scroll flex-1 overflow-y-auto p-8 md:px-20 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">Squad Command Matrix</h2>
                <p className="text-xs text-[#9496a1] mt-1">Autonomous specialist fleet running across isolated sandboxes.</p>
              </div>
              <button
                onClick={handleOpenInMainChat}
                className="rounded-full border border-[rgba(255,255,255,0.15)] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[rgba(255,255,255,0.08)] transition"
              >
                Open Main Chat ↗
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#13151b] p-5 space-y-4"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <HermesAvatar name={agent.name} color={agent.color} size={36} />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white text-sm">{agent.name}</span>
                          <span className="text-[10px] font-mono rounded-full bg-[rgba(255,255,255,0.08)] px-2 py-0.5 text-[#9496a1]">
                            {agent.badge}
                          </span>
                        </div>
                        <div className="text-xs text-[#5e606e]">{agent.role}</div>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        setActiveId(agent.id)
                        setCurrentTab('chat')
                      }}
                      className="rounded-full border border-[rgba(255,255,255,0.12)] px-3 py-1 text-xs text-white hover:bg-[rgba(255,255,255,0.08)] transition"
                    >
                      Chat →
                    </button>
                  </div>

                  <p className="text-xs text-[#9496a1] leading-relaxed">{agent.description}</p>

                  <div className="grid grid-cols-3 gap-2 border-t border-[rgba(255,255,255,0.06)] pt-3 text-[11px] font-mono">
                    <div>
                      <div className="text-[#5e606e]">TURNS</div>
                      <div className="text-white font-bold">{agent.run_count || 0}</div>
                    </div>
                    <div>
                      <div className="text-[#5e606e]">MODEL</div>
                      <div className="text-white truncate">{agent.model.split('/')[0]}</div>
                    </div>
                    <div>
                      <div className="text-[#5e606e]">APPROVAL</div>
                      <div className={agent.approval_mode === 'strict' ? 'text-red-400' : 'text-emerald-400'}>
                        {agent.approval_mode.toUpperCase()}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: ROUTINES */}
        {currentTab === 'routines' && (
          <div className="clean-scroll flex-1 overflow-y-auto p-8 md:px-20 space-y-6">
            <div>
              <h2 className="text-xl font-bold text-white">Cron Routines</h2>
              <p className="text-xs text-[#9496a1] mt-1">Autonomous recurring pipelines scheduled across operators.</p>
            </div>

            <div className="space-y-3">
              {allRoutines.map((routine) => {
                const owner = agents.find((a) => a.id === routine.botId) || agents[0]
                return (
                  <div
                    key={routine.id}
                    className="flex items-center justify-between rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#13151b] p-4"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-white">{routine.name}</span>
                        <span className="text-[10px] font-mono rounded-full bg-[rgba(255,255,255,0.08)] px-2 py-0.5 text-[#9496a1]">
                          {owner.name}
                        </span>
                      </div>
                      <div className="text-xs text-[#9496a1] mt-1">{routine.prompt}</div>
                      <div className="text-[11px] font-mono text-[#5e606e] mt-1.5">
                        {routine.schedule_label} · {routine.cron} · Last: {routine.lastRunAt || 'Scheduled'}
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        setActiveId(owner.id)
                        setCurrentTab('chat')
                        handleSend(routine.prompt)
                      }}
                      className="rounded-full bg-white text-black px-4 py-1.5 text-xs font-semibold hover:opacity-90 transition"
                    >
                      Run Now
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* TAB 4: AUDIT LOG */}
        {currentTab === 'audit' && (
          <div className="clean-scroll flex-1 overflow-y-auto p-8 md:px-20 space-y-6">
            <div>
              <h2 className="text-xl font-bold text-white">Security & Audit Log</h2>
              <p className="text-xs text-[#9496a1] mt-1">Immutable tool execution traces and human consent checkpoints.</p>
            </div>

            <div className="space-y-2 font-mono text-xs">
              {liveTools.length === 0 ? (
                <div className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#13151b] p-6 text-center text-[#5e606e]">
                  No active tool calls logged in the current session.
                </div>
              ) : (
                liveTools.map((t, i) => (
                  <div key={i} className="tool-call-card p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-bold">$ {t.tool}</span>
                        <span className="text-emerald-400 text-[10px] uppercase font-mono">{t.status}</span>
                      </div>
                      <button
                        onClick={() => toggleToolExpand(i)}
                        className="text-[#9496a1] hover:text-white text-[11px]"
                      >
                        {expandedTools[i] ? 'Hide Args ▲' : 'View Args ▼'}
                      </button>
                    </div>
                    {expandedTools[i] && (
                      <div className="bg-[#0d0e12] p-3 rounded-lg text-[#9496a1] text-[11px] whitespace-pre-wrap border border-[rgba(255,255,255,0.06)]">
                        {typeof t.args === 'string' ? t.args : JSON.stringify(t.args, null, 2)}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 5: CONFIG */}
        {currentTab === 'config' && (
          <div className="clean-scroll flex-1 overflow-y-auto p-8 md:px-20 max-w-2xl space-y-6">
            <div>
              <h2 className="text-xl font-bold text-white">Agent Configuration</h2>
              <p className="text-xs text-[#9496a1] mt-1">Fine-tune system instructions, model routing, and approval gates for {activeAgent.name}.</p>
            </div>

            <form onSubmit={handleSaveSettings} className="space-y-4 text-xs">
              <div>
                <label className="block mb-1.5 font-medium text-[#9496a1]">Inference Model</label>
                <select
                  value={editModel}
                  onChange={(e) => setEditModel(e.target.value)}
                  className="w-full rounded-xl border border-[rgba(255,255,255,0.12)] bg-[#181a22] p-3 text-white outline-none"
                >
                  <option value="deepseek-v4-flash">DeepSeek-V4-Flash (High Speed)</option>
                  <option value="gemini-3.7-flash">Gemini 3.7 Flash</option>
                  <option value="claude-sonnet-4.6">Claude Sonnet 4.6 (1M Context)</option>
                  <option value="opencode-go/deepseek-v4-flash">OpenCode Go (Builder)</option>
                </select>
              </div>

              <div>
                <label className="block mb-1.5 font-medium text-[#9496a1]">Approval Posture</label>
                <select
                  value={editApproval}
                  onChange={(e) => setEditApproval(e.target.value as any)}
                  className="w-full rounded-xl border border-[rgba(255,255,255,0.12)] bg-[#181a22] p-3 text-white outline-none"
                >
                  <option value="auto">Auto (Full Autonomous Execution)</option>
                  <option value="strict">Strict (Require Human Approval for Privileged Writes)</option>
                </select>
              </div>

              <div>
                <label className="block mb-1.5 font-medium text-[#9496a1]">System Directives</label>
                <textarea
                  rows={6}
                  value={editInst}
                  onChange={(e) => setEditInst(e.target.value)}
                  className="w-full rounded-xl border border-[rgba(255,255,255,0.12)] bg-[#181a22] p-3 text-white outline-none leading-relaxed"
                />
              </div>

              <button
                type="submit"
                className="w-full rounded-xl bg-white text-black py-3 font-semibold text-xs transition hover:opacity-90"
              >
                Save Configuration
              </button>
            </form>
          </div>
        )}
      </main>

      {/* SPAWN NEW AGENT MODAL */}
      {showNewAgentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-[rgba(255,255,255,0.12)] bg-[#13151b] p-6 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-base font-bold text-white">Spawn Operator</span>
              <button onClick={() => setShowNewAgentModal(false)} className="text-[#5e606e] hover:text-white font-bold text-sm">
                ✕
              </button>
            </div>

            <form onSubmit={handleSpawn} className="space-y-3">
              <div>
                <label className="block mb-1 text-[#9496a1]">Agent Name</label>
                <input
                  required
                  value={spawnName}
                  onChange={(e) => setSpawnName(e.target.value)}
                  placeholder="e.g. Sentinel 01"
                  className="w-full rounded-xl border border-[rgba(255,255,255,0.12)] bg-[#181a22] p-2.5 text-white outline-none"
                />
              </div>
              <div>
                <label className="block mb-1 text-[#9496a1]">Role & Domain</label>
                <input
                  value={spawnRole}
                  onChange={(e) => setSpawnRole(e.target.value)}
                  placeholder="e.g. Code Review & QA"
                  className="w-full rounded-xl border border-[rgba(255,255,255,0.12)] bg-[#181a22] p-2.5 text-white outline-none"
                />
              </div>
              <div>
                <label className="block mb-1 text-[#9496a1]">Inference Model</label>
                <select
                  value={spawnModel}
                  onChange={(e) => setSpawnModel(e.target.value)}
                  className="w-full rounded-xl border border-[rgba(255,255,255,0.12)] bg-[#181a22] p-2.5 text-white outline-none"
                >
                  <option value="deepseek-v4-flash">DeepSeek-V4-Flash</option>
                  <option value="gemini-3.7-flash">Gemini 3.7 Flash</option>
                  <option value="claude-sonnet-4.6">Claude Sonnet 4.6</option>
                  <option value="opencode-go/deepseek-v4-flash">OpenCode Go</option>
                </select>
              </div>
              <div>
                <label className="block mb-1 text-[#9496a1]">System Directives</label>
                <textarea
                  rows={3}
                  value={spawnInst}
                  onChange={(e) => setSpawnInst(e.target.value)}
                  placeholder="Instructions and operational style..."
                  className="w-full rounded-xl border border-[rgba(255,255,255,0.12)] bg-[#181a22] p-2.5 text-white outline-none"
                />
              </div>
              <button
                type="submit"
                className="w-full rounded-xl bg-white text-black py-2.5 font-semibold text-xs mt-2 transition hover:opacity-90"
              >
                Spawn Operator
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
