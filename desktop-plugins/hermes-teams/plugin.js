/**
 * Hermes Teams: roles, team templates, and the lanes of each team run.
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
  PanelEmpty,
  Skeleton,
  STATUSBAR_AREAS,
  Tip,
  haptic,
  host,
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useState } from 'react'

const ID = 'hermes-teams'
const PANE_ID = `${ID}:pane`
const POLL_MS = 3500

// Theme vars only (audit M3/M11): the tint is the dot colour mixed into the surface.
const tone = (label, dot) => ({ label, dot, bg: `color-mix(in srgb, ${dot} 14%, transparent)` })
const LANE_TONE = {
  done: tone('done', 'var(--ui-green)'),
  in_progress: tone('running', 'var(--ui-purple)'),
  ready: tone('ready', 'var(--ui-accent)'),
  todo: tone('waiting', 'var(--ui-text-quaternary)'),
  blocked: tone('blocked', 'var(--ui-red)'),
}

// A backend without the hermes-teams gateway plugin answers "unknown method".
// That is a version gap, not an error, so the pane says so once and stops polling (audit M11).
const isMissingMethod = (err) => (err && err.code === -32601) || /unknown method/i.test(String(err && err.message))
const errText = (err) => (err && err.message ? err.message : String(err))
const SECTION = 'text-xs font-medium text-(--ui-text-secondary)'
const CARD = 'flex flex-col gap-2 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-2.5'

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
  const [phase, setPhase] = useState('loading') // loading | ready | missing

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
      setPhase('ready')
    } catch (err) {
      if (isMissingMethod(err)) setPhase('missing')
      else setError(errText(err))
    }
  }, [selectedRunId])

  useEffect(() => {
    if (phase === 'missing') return undefined
    refreshAll()
    const timer = setInterval(refreshAll, POLL_MS)
    return () => clearInterval(timer)
  }, [refreshAll, phase])

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
      setError(errText(err))
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
      setError(errText(err))
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
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  const activeRun = selectedRun || runs.find((r) => r.id === selectedRunId) || null

  if (phase === 'missing') {
    return jsx(PanelEmpty, {
      icon: 'organization',
      title: 'Teams needs a newer Hermes',
      description: "This Hermes backend doesn't have the Teams service yet. Update Hermes, then check again.",
      action: jsx(Button, { size: 'sm', variant: 'outline', onClick: () => setPhase('loading'), children: 'Check again' }),
    })
  }
  if (phase === 'loading' && !error) {
    return jsxs('div', {
      'aria-busy': true,
      className: 'flex flex-col gap-3 p-3',
      children: [jsx(Skeleton, { className: 'h-4 w-1/3' }), jsx(Skeleton, { className: 'h-20 w-full' }), jsx(Skeleton, { className: 'h-32 w-full' })],
    })
  }

  return jsxs('div', {
    className: 'flex h-full flex-col gap-3 overflow-y-auto p-3 text-xs text-(--ui-text-primary)',
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between',
        children: [
          jsxs('div', {
            children: [
              jsx('div', { className: 'text-sm font-semibold', children: 'Teams' }),
              jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: 'Roles, team templates and their runs' }),
            ],
          }),
          jsx(Button, { size: 'sm', variant: 'ghost', onClick: refreshAll, children: 'Refresh' }),
        ],
      }),

      error
        ? jsx('div', {
            className: 'rounded-md border border-(--ui-red)/40 bg-(--ui-red)/10 p-2 text-xs text-(--ui-red)',
            children: `Couldn't reach Teams: ${error}`,
          })
        : null,

      /* Start a team run */
      jsxs('div', {
        className: CARD,
        children: [
          jsx('div', { className: SECTION, children: 'Start a team run' }),
          jsxs('div', {
            className: 'flex flex-wrap gap-1.5',
            children: templates.map((tpl) =>
              jsx(Button, {
                key: tpl.id,
                size: 'xs',
                variant: selectedTemplate === tpl.id ? 'default' : 'chip',
                'aria-pressed': selectedTemplate === tpl.id,
                onClick: () => setSelectedTemplate(tpl.id),
                children: `${tpl.name} · ${(tpl.steps || []).length} steps`,
              })
            ),
          }),
          jsxs('div', {
            className: 'flex gap-1.5',
            children: [
              jsx(Input, {
                value: goal,
                placeholder: 'What should the team do?',
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

      /* Team runs and their lanes */
      jsxs('div', {
        className: CARD,
        children: [
          jsxs('div', {
            className: 'flex items-center justify-between',
            children: [
              jsx('span', { className: SECTION, children: `Team runs (${runs.length})` }),
              activeRun
                ? jsx('span', {
                    className: 'text-xs text-(--ui-text-secondary)',
                    children: `${activeRun.done}/${activeRun.total} done · ${activeRun.state}`,
                  })
                : null,
            ],
          }),

          runs.length === 0
            ? jsx('div', {
                className: 'py-2 text-xs text-(--ui-text-tertiary)',
                children: 'No team runs yet. Pick a template above and give it a goal.',
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
                        className: `rounded-md px-2 py-0.5 text-left text-xs ${
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
                              className: 'flex flex-col gap-0.5 rounded-md border border-(--ui-stroke-secondary) p-2',
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
                                              className: 'rounded-md bg-(--ui-bg-primary) px-1 text-xs text-(--ui-text-tertiary)',
                                              children: 'final',
                                            })
                                          : null,
                                      ],
                                    }),
                                    jsx('span', {
                                      className: 'text-xs text-(--ui-text-secondary)',
                                      children: `${lane.profile} · ${st.label}`,
                                    }),
                                  ],
                                }),
                                (lane.needs || []).length > 0
                                  ? jsx('div', {
                                      className: 'text-xs text-(--ui-text-tertiary)',
                                      children: `Waits for ${lane.needs.join(', ')}`,
                                    })
                                  : null,
                                lane.summary
                                  ? jsx('div', {
                                      className: 'mt-0.5 text-xs text-(--ui-text-secondary)',
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
                                'aria-label': 'Step',
                                className: 'rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) px-1.5 py-1 text-xs',
                                children: [
                                  jsx('option', { key: '', value: '', children: 'All steps' }),
                                  ...(activeRun.lanes || []).map((lane) =>
                                    jsx('option', { key: lane.key, value: lane.key, children: lane.key })
                                  ),
                                ],
                              }),
                              jsx(Input, {
                                value: noteBody,
                                placeholder: 'Add a note for this step…',
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

      /* Roles */
      jsxs('div', {
        className: CARD,
        children: [
          jsx('div', { className: SECTION, children: `Roles (${roles.length})` }),
          ...roles.map((r) =>
            jsxs('div', {
              key: r.id,
              className: 'flex items-center justify-between gap-2 rounded-md bg-(--ui-bg-primary) px-2 py-1.5',
              children: [
                jsxs('div', {
                  className: 'flex flex-col',
                  children: [
                    jsxs('span', {
                      className: 'font-medium',
                      children: [`${r.avatar || '🤖'} ${r.name}`, ' · ', jsx('span', { className: 'text-xs text-(--ui-text-tertiary)', children: r.profile })],
                    }),
                    r.summary
                      ? jsx('span', {
                          className: 'text-xs text-(--ui-text-tertiary)',
                          children: r.summary,
                        })
                      : null,
                  ],
                }),
                r.bot_exists
                  ? jsx('span', {
                      className: 'rounded-md bg-(--ui-green)/15 px-1.5 py-0.5 text-xs text-(--ui-green)',
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
  return jsx(Tip, { label: 'Open Teams: roles and team runs', children: jsx('button', {
    type: 'button',
    'aria-label': 'Open Teams',
    className: 'flex items-center gap-1 px-1.5 text-xs text-(--ui-text-tertiary) hover:text-(--ui-text-secondary)',
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
        jsx('span', { children: 'Teams' }),
      ],
    }),
  }) })
}

export default {
  id: ID,
  name: 'Hermes Teams',
  description: 'Bot Mode v3: role roster, DAG team templates, and Kanban lane runs.',
  register(ctx) {
    ctx.register({
      id: 'pane',
      area: PANES_AREA,
      title: 'Teams',
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
        label: 'Teams: open roles and runs',
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
