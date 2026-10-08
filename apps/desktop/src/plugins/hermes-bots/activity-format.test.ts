/**
 * The Activity feed's wording contract:
 *
 *  1. a step label never falls back to a bare verb or a RAW tool id while a
 *     subject source exists (a shell call's input, an unmapped tool's
 *     prettified name);
 *  2. a task's subject walks one chain — the model slot, then the request,
 *     then the work its steps name, then the locale — and stops at the first
 *     thing that can say what the row is.
 *
 * Both are pure: no RPC, no store, no render.
 */

import type { ActivityStep, ActivityTask } from '@hermes/plugin-sdk'
import { describe, expect, it } from 'vitest'

import { clipWords, prettifyTool, stepLabel, stepSubject, subjectStep, taskSubject } from './activity-format'
import { botsText } from './i18n'

// The real English bundle, resolved against `en` with no plugin context —
// the wording under test is the wording that ships.
const a = botsText().activity

function step(
  over: Omit<Partial<ActivityStep>, 'action'> & { action?: Partial<ActivityStep['action']> } = {}
): ActivityStep {
  const { action, ...rest } = over

  return {
    action: {
      completedAt: 10,
      exitCode: null,
      id: 't1',
      input: '',
      output: '',
      startedAt: 9,
      status: 'ok',
      target: '',
      tool: 'terminal',
      ...(action ?? {})
    },
    id: 't1',
    subject: '',
    verb: 'used',
    ...rest
  }
}

function task(over: Partial<ActivityTask> = {}): ActivityTask {
  return {
    completedAt: 10,
    errorCount: 0,
    id: 'u1',
    outcome: '',
    startedAt: 1,
    status: 'done',
    steps: [],
    subject: '',
    subjectSource: 'derived',
    title: '',
    ...over
  }
}

describe('clipWords', () => {
  it('leaves a subject that already fits alone', () => {
    expect(clipWords('  Deploy   the plugin ')).toBe('Deploy the plugin')
  })

  it('cuts on a word boundary and never mid-word', () => {
    const out = clipWords('Get the Backdrops Plugin Live on the Desktop app here at desktop.decruxtech.com')

    expect(out.endsWith('…')).toBe(true)
    expect(out.slice(0, -1).endsWith('the')).toBe(false)
    expect(out.length).toBeLessThanOrEqual(60)
    expect(out.startsWith('Get the Backdrops Plugin Live on')).toBe(true)
  })

  it('respects the cap even with no space to cut on', () => {
    expect(clipWords('x'.repeat(200)).length).toBeLessThanOrEqual(60)
  })
})

describe('stepSubject', () => {
  it('names the target the call carried', () => {
    expect(stepSubject(step({ subject: 'bot-card.tsx', verb: 'read' }))).toBe('bot-card.tsx')
  })

  it('falls back to the first line of a shell call input when it had no target', () => {
    const ran = step({ action: { input: 'npm run build -- --watch\nlong output…', tool: 'execute_code' }, verb: 'ran' })

    expect(stepSubject(ran)).toBe('npm run build -- --watch')
    expect(stepLabel(ran, a)).toBe('Ran npm run build -- --watch')
  })

  it('never reads pretty-printed args as a subject', () => {
    const json = step({ action: { input: '{\n  "query": "gpu"\n}', tool: 'terminal' }, verb: 'ran' })

    // No subject source at all: the bare verb is the LAST resort, not the default.
    expect(stepSubject(json)).toBe('')
    expect(stepLabel(json, a)).toBe('Ran')
  })

  it('prettifies an unmapped tool instead of printing its id', () => {
    const mcp = step({ action: { tool: 'mcp_server__search_issues' }, verb: 'used' })

    expect(stepSubject(mcp)).toBe('search issues')
    expect(stepLabel(mcp, a)).toBe('Used search issues')
    expect(stepLabel(step({ action: { tool: 'some_plugin_tool' }, verb: 'used' }), a)).toBe('Used some plugin tool')
  })

  it('keeps a mapped-but-targetless step on its plain verb', () => {
    const memory = step({ action: { input: '{"action":"add"}', tool: 'memory' }, verb: 'remembered' })

    expect(stepSubject(memory)).toBe('')
    expect(stepLabel(memory, a)).toBe('Saved to memory')
  })

  it('reads present tense for the live line', () => {
    expect(stepLabel(step({ subject: 'routes.ts', verb: 'read' }), a, 'doing')).toBe('Reading routes.ts')
  })
})

describe('prettifyTool', () => {
  it('drops the provider prefix and the snake_case', () => {
    expect(prettifyTool('mcp_server__search_issues')).toBe('search issues')
    expect(prettifyTool('read_file')).toBe('read file')
    expect(prettifyTool('browser_click')).toBe('browser click')
  })
})

describe('subjectStep', () => {
  it('names the work the task did MOST, not its first errand', () => {
    const built = task({
      steps: [
        step({ id: 'a', subject: 'bot-card.tsx', verb: 'read' }),
        step({ id: 'b', subject: 'npm run build', verb: 'ran' }),
        step({ id: 'c', subject: 'npm test', verb: 'ran' })
      ]
    })

    expect(subjectStep(built)?.id).toBe('b')
    expect(taskSubject(built, a)).toBe('Ran npm run build')
  })

  it('is null when there is nothing to name', () => {
    expect(subjectStep(task())).toBeNull()
  })
})

describe('taskSubject', () => {
  it('walks the chain: model slot, request, steps, locale', () => {
    // 1. The model subject the upgrade layer merged into the slot wins.
    expect(taskSubject(task({ subject: 'Skia UI build receipts', title: 'Check the UI build' }), a)).toBe(
      'Skia UI build receipts'
    )

    // 2. The request, already cut short at derivation.
    expect(taskSubject(task({ subject: '', title: 'Deploy the plugin' }), a)).toBe('Deploy the plugin')

    // 3. Self-started work: what its steps did, in this locale's words.
    expect(
      taskSubject(
        task({
          steps: [step({ subject: 'npm run build', verb: 'ran' }), step({ subject: 'bot-card.tsx', verb: 'read' })]
        }),
        a
      )
    ).toBe('Ran npm run build')

    // 4. Nothing to name: the locale's own fallback.
    expect(taskSubject(task(), a)).toBe(a.onItsOwn)
  })

  it('never leaks a raw title that was never cut to a subject', () => {
    const long = 'Check the whole Backdrops Plugin Live on the Desktop app at desktop.decruxtech.com today'
    const subject = taskSubject(task({ title: long }), a)

    expect(subject.length).toBeLessThanOrEqual(60)
    expect(subject.endsWith('…')).toBe(true)
  })
})
