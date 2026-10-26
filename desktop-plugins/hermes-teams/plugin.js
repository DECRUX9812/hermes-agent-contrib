/**
 * Hermes Teams (Bot Mode v3) — Roles, Team Templates, and Kanban DAG Lanes.
 *
 * Speaks to the `hermes-teams` gateway plugin RPCs:
 *   teams.roles.list      {} -> { roles: [{ id, name, profile, avatar, model, bot_exists, summary }] }
 *   teams.roles.ensure    { role } -> { profile, created }
 *   teams.templates.list  {} -> { templates: [{ id, name, description, builtin, steps }] }
 *   teams.run.start       { template, goal, create_missing } -> { run }
 *   teams.run.list        { limit } -> { runs: [run] }
 *   teams.run.get         { run_id } -> { run }
 *   teams.run.message     { run_id, step, body } -> { comment_id }
 */

import {
  Button,
  Input,
  PALETTE_AREA,
  PANES_AREA,
  STATUSBAR_AREAS,
  haptic,
  host,
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useState } from 'react'

const ID = 'hermes-teams'
const PANE_ID = `${ID}:pane`
const POLL_MS = 3500

const LANE_TONE = {
  done: { label: 'done', dot: 'var(--ui-green)', bg: 'rgba(61, 220, 151, 0.14)' },
  in_progress: { label: 'running', dot: 'var(--ui-purple)', bg: 'rgba(180, 140, 255, 0.16)' },
  ready: { label: 'ready', dot: 'var(--ui-accent)', bg: 'rgba(90, 167, 255, 0.14)' },
  todo: { label: 'gated', dot: 'var(--ui-text-quaternary)', bg: 'rgba(127, 127, 127, 0.1)' },
  blocked: { label: 'blocked', dot: 'var(--ui-red)', bg: 'rgba(255, 92, 108, 0.15)' },
}

function laneStyle(status) {
  return LANE_TONE[status] || LANE_TONE.todo
}

function TeamsPane() {
  const [roles, setRoles] = useState([])
  const [templates, setTemplates] = useState([])
  const [runs, setRuns] = useState([])
  const [selectedTemplate, setSelectedTemplate] = useState('feature')
  const [goal, setGoal] = useState('')
  const [selectedRunId, setSelectedRunId] = useState(null)
  const [selectedRun, setSelectedRun] = useState(null)
  const [noteStep, setNoteStep] = useState('')
  const [noteBody, setNoteBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const refreshAll = useCallback(async () => {
    try {
      const [rRes, tRes, lRes] = await Promise.all([
        host.request('teams.roles.list', {}),
        host.request('teams.templates.list', {}),
        host.request('teams.run.list', { limit: 15 }),
      ])
      if (rRes && Array.isArray(rRes.roles)) setRoles(rRes.roles)
      if (tRes && Array.isArray(tRes.templates)) setTemplates(tRes.templates)
      if (lRes && Array.isArray(lRes.runs)) {
        setRuns(lRes.runs)
        if (!selectedRunId && lRes.runs.length > 0) {
          setSelectedRunId(lRes.runs[0].id)
        }
      }
      setError(null)
    } catch (err) {
      setError(err && err.message ? err.message : String(err))
    }
  }, [selectedRunId])

  useEffect(() => {
    refreshAll()
    const timer = setInterval(refreshAll, POLL_MS)
    return () => clearInterval(timer)
  }, [refreshAll])

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedRun(null)
      return
    }
    let cancelled = false
    host
      .request('teams.run.get', { run_id: selectedRunId })
      .then((res) => {
        if (!cancelled && res && res.run) {
          setSelectedRun(res.run)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [selectedRunId, runs])

  const handleEnsureRole = async (roleId) => {
    setBusy(true)
    try {
      haptic('tap')
      await host.request('teams.roles.ensure', { role: roleId })
      await refreshAll()
    } catch (err) {
      setError(err && err.message ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleStartRun = async () => {
    const trimmed = goal.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      haptic('tap')
      const res = await host.request('teams.run.start', {
        template: selectedTemplate,
        goal: trimmed,
        create_missing: true,
      })
      setGoal('')
      if (res && res.run) {
        setSelectedRunId(res.run.id)
        setSelectedRun(res.run)
      }
      await refreshAll()
    } catch (err) {
      setError(err && err.message ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleSendNote = async () => {
    if (!selectedRunId || !noteBody.trim()) return
    setBusy(true)
    try {
      haptic('tap')
      await host.request('teams.run.message', {
        run_id: selectedRunId,
        step: noteStep || undefined,
        body: noteBody.trim(),
      })
      setNoteBody('')
      await refreshAll()
    } catch (err) {
      setError(err && err.message ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const activeRun = selectedRun || runs.find((r) => r.id === selectedRunId) || null

  return jsxs('div', {
    className: 'flex h-full flex-col gap-3 overflow-y-auto p-3 text-xs text-(--ui-text-primary)',
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between',
        children: [
          jsxs('div', {
            children: [
              jsx('div', {
                className: 'text-[0.6875rem] font-semibold uppercase tracking-wider text-(--ui-text-tertiary)',
                children: 'Bot Mode v3 · Team OS',
              }),
              jsx('div', {
                className: 'text-sm font-semibold',
                children: 'Roles & Kanban DAG Lanes',
              }),
            ],
          }),
          jsx(Button, {
            size: 'sm',
            variant: 'ghost',
            onClick: refreshAll,
            children: '↻',
          }),
        ],
      }),

      error
        ? jsx('div', {
            className: 'rounded-md border border-(--ui-red)/40 bg-(--ui-red)/10 p-2 text-[0.6875rem] text-(--ui-red)',
            children: error,
          })
        : null,

      /* Dispatch New Team Run */
      jsxs('div', {
        className: 'flex flex-col gap-2 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-2.5',
        children: [
          jsx('div', {
            className: 'text-[0.6875rem] font-semibold uppercase tracking-wider text-(--ui-text-tertiary)',
            children: 'Dispatch Team Run',
          }),
          jsxs('div', {
            className: 'flex flex-wrap gap-1.5',
            children: templates.map((tpl) =>
              jsx('button', {
                key: tpl.id,
                type: 'button',
                onClick: () => setSelectedTemplate(tpl.id),
                className: `rounded-md px-2 py-1 text-[0.6875rem] font-medium transition ${
                  selectedTemplate === tpl.id
                    ? 'bg-(--ui-accent) text-white'
                    : 'bg-(--ui-bg-primary) text-(--ui-text-secondary) hover:text-(--ui-text-primary)'
                }`,
                children: `${tpl.name} (${(tpl.steps || []).length} steps)`,
              })
            ),
          }),
          jsxs('div', {
            className: 'flex gap-1.5',
            children: [
              jsx(Input, {
                value: goal,
                placeholder: 'Team mission / goal…',
                onChange: (e) => setGoal(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === 'Enter') handleStartRun()
                },
              }),
              jsx(Button, {
                size: 'sm',
                disabled: busy || !goal.trim(),
                onClick: handleStartRun,
                children: 'Run',
              }),
            ],
          }),
        ],
      }),

      /* Active Team Runs & DAG Lanes */
      jsxs('div', {
        className: 'flex flex-col gap-2 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-2.5',
        children: [
          jsxs('div', {
            className: 'flex items-center justify-between',
            children: [
              jsx('span', {
                className: 'text-[0.6875rem] font-semibold uppercase tracking-wider text-(--ui-text-tertiary)',
                children: `Team Runs (${runs.length})`,
              }),
              activeRun
                ? jsx('span', {
                    className: 'font-mono text-[0.6875rem] text-(--ui-text-secondary)',
                    children: `${activeRun.done}/${activeRun.total} done · ${activeRun.state}`,
                  })
                : null,
            ],
          }),

          runs.length === 0
            ? jsx('div', {
                className: 'py-2 text-[0.6875rem] text-(--ui-text-tertiary)',
                children: 'No team runs yet. Pick a template above and dispatch a goal.',
              })
            : jsxs('div', {
                className: 'flex flex-col gap-1.5',
                children: [
                  jsxs('div', {
                    className: 'flex flex-wrap gap-1',
                    children: runs.slice(0, 8).map((r) =>
                      jsx('button', {
                        key: r.id,
                        type: 'button',
                        onClick: () => setSelectedRunId(r.id),
                        className: `rounded px-2 py-0.5 text-left text-[0.6875rem] ${
                          selectedRunId === r.id
                            ? 'bg-(--ui-accent)/20 font-semibold text-(--ui-text-primary)'
                            : 'bg-(--ui-bg-primary) text-(--ui-text-secondary)'
                        }`,
                        children: `${r.goal.slice(0, 28)}${r.goal.length > 28 ? '…' : ''} (${r.done}/${r.total})`,
                      })
                    ),
                  }),

                  activeRun
                    ? jsxs('div', {
                        className: 'mt-1 flex flex-col gap-1.5',
                        children: [
                          jsx('div', {
                            className: 'font-medium text-(--ui-text-primary)',
                            children: activeRun.goal,
                          }),
                          ...(activeRun.lanes || []).map((lane) => {
                            const st = laneStyle(lane.status)
                            return jsxs('div', {
                              key: lane.key,
                              className: 'flex flex-col gap-0.5 rounded border border-(--ui-stroke-secondary) p-2',
                              style: { background: st.bg },
                              children: [
                                jsxs('div', {
                                  className: 'flex items-center justify-between gap-2',
                                  children: [
                                    jsxs('span', {
                                      className: 'flex items-center gap-1.5 font-semibold',
                                      children: [
                                        jsx('span', {
                                          className: 'h-2 w-2 rounded-full',
                                          style: { background: st.dot },
                                        }),
                                        jsx('span', { children: lane.title || lane.key }),
                                        lane.final
                                          ? jsx('span', {
                                              className: 'rounded bg-(--ui-bg-primary) px-1 text-[0.625rem] text-(--ui-text-tertiary)',
                                              children: 'final',
                                            })
                                          : null,
                                      ],
                                    }),
                                    jsx('span', {
                                      className: 'font-mono text-[0.6875rem] text-(--ui-text-secondary)',
                                      children: `${lane.profile} · ${st.label}`,
                                    }),
                                  ],
                                }),
                                (lane.needs || []).length > 0
                                  ? jsx('div', {
                                      className: 'text-[0.625rem] text-(--ui-text-tertiary)',
                                      children: `depends on: ${lane.needs.join(', ')}`,
                                    })
                                  : null,
                                lane.summary
                                  ? jsx('div', {
                                      className: 'mt-0.5 text-[0.6875rem] text-(--ui-text-secondary)',
                                      children: lane.summary,
                                    })
                                  : null,
                              ],
                            })
                          }),

                          jsxs('div', {
                            className: 'mt-1 flex gap-1.5',
                            children: [
                              jsx('select', {
                                value: noteStep,
                                onChange: (e) => setNoteStep(e.target.value),
                                className: 'rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) px-1.5 py-1 text-[0.6875rem]',
                                children: [
                                  jsx('option', { key: '', value: '', children: 'All steps' }),
                                  ...(activeRun.lanes || []).map((lane) =>
                                    jsx('option', { key: lane.key, value: lane.key, children: lane.key })
                                  ),
                                ],
                              }),
                              jsx(Input, {
                                value: noteBody,
                                placeholder: 'Post guidance to lane…',
                                onChange: (e) => setNoteBody(e.target.value),
                                onKeyDown: (e) => {
                                  if (e.key === 'Enter') handleSendNote()
                                },
                              }),
                              jsx(Button, {
                                size: 'sm',
                                disabled: busy || !noteBody.trim(),
                                onClick: handleSendNote,
                                children: 'Send',
                              }),
                            ],
                          }),
                        ],
                      })
                    : null,
                ],
              }),
        ],
      }),

      /* Role Roster */
      jsxs('div', {
        className: 'flex flex-col gap-1.5 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-2.5',
        children: [
          jsx('div', {
            className: 'text-[0.6875rem] font-semibold uppercase tracking-wider text-(--ui-text-tertiary)',
            children: `Role Roster (${roles.length})`,
          }),
          ...roles.map((r) =>
            jsxs('div', {
              key: r.id,
              className: 'flex items-center justify-between gap-2 rounded bg-(--ui-bg-primary) px-2 py-1.5',
              children: [
                jsxs('div', {
                  className: 'flex flex-col',
                  children: [
                    jsxs('span', {
                      className: 'font-medium',
                      children: [`${r.avatar || '🤖'} ${r.name}`, ' · ', jsx('span', { className: 'font-mono text-[0.6875rem] text-(--ui-text-tertiary)', children: r.profile })],
                    }),
                    r.summary
                      ? jsx('span', {
                          className: 'text-[0.6875rem] text-(--ui-text-tertiary)',
                          children: r.summary,
                        })
                      : null,
                  ],
                }),
                r.bot_exists
                  ? jsx('span', {
                      className: 'rounded bg-(--ui-green)/15 px-1.5 py-0.5 font-mono text-[0.625rem] text-(--ui-green)',
                      children: 'ready',
                    })
                  : jsx(Button, {
                      size: 'sm',
                      variant: 'ghost',
                      disabled: busy,
                      onClick: () => handleEnsureRole(r.id),
                      children: 'Create bot',
                    }),
              ],
            })
          ),
        ],
      }),
    ],
  })
}

function TeamsChip() {
  return jsx('button', {
    type: 'button',
    title: 'Hermes Teams (Bot Mode v3) — click to reveal roles & Kanban lanes',
    className: 'flex items-center gap-1 px-1.5 text-[0.6875rem] text-(--ui-text-tertiary) hover:text-(--ui-text-secondary)',
    onClick: () => {
      haptic('tap')
      if (typeof host.revealPane === 'function') {
        host.revealPane(PANE_ID)
      }
    },
    children: jsxs('span', {
      className: 'flex items-center gap-1',
      children: [
        jsx('span', {
          className: 'h-1.5 w-1.5 rounded-full',
          style: { background: 'var(--ui-accent)' },
        }),
        jsx('span', { children: 'teams' }),
      ],
    }),
  })
}

export default {
  id: ID,
  name: 'Hermes Teams',
  description: 'Bot Mode v3: role roster, DAG team templates, and Kanban lane runs.',
  register(ctx) {
    ctx.register({
      id: 'pane',
      area: PANES_AREA,
      title: 'teams',
      data: { placement: 'right', width: '380px' },
      render: () => jsx(TeamsPane, {}),
    })

    ctx.register({
      id: 'chip',
      area: STATUSBAR_AREAS.right,
      order: 119,
      render: () => jsx(TeamsChip, {}),
    })

    ctx.register({
      id: 'reveal',
      area: PALETTE_AREA,
      data: {
        id: 'hermes-teams.reveal',
        label: 'Hermes Teams: Open Roles & Lanes',
        keywords: ['team', 'roles', 'lanes', 'kanban', 'bot mode', 'dag'],
        run: () => {
          if (typeof host.revealPane === 'function') {
            host.revealPane(PANE_ID)
          }
        },
      },
    })
  },
}
