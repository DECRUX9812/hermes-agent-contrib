/**
 * SimDirector: the API the scenario beats call — a TS port of the Foreman's
 * SimDirector surface (act/log/say/think/read/glob/grep/patch/runTests/commit/
 * cli/memory/startTask/finishTask/ensureTask/setTask/task/wt/openDecision/
 * awaitDecision/requestMerge/settleMerge/sleep/vars) over the SimStore.
 * Timings are scaled by the driver's speed; real FS/worktrees become canned
 * in-memory file contents so `miniDiff` still produces genuine diffs.
 */

import { Lamp } from './blocks'
import * as E from './edits'
import { applyPatch, miniDiff, type Patch } from './edits'
import type { SimStore} from './model';
import { type AgentActivity, type DecisionStatus, type Station } from './model'

export const DEFAULT_SIM_GOAL = 'Add #tags to pocket-notes: parse them, filter with `notes list --tag`, and show a `notes tags` summary'

export const PERMISSION_OPTIONS = ['Allow once', 'Allow this session', 'Deny']
export const Q1_OPTIONS = ['Only open notes (recommended)', 'Include completed notes']
export const q2Options = (id: string) => [`Close ${id} - I'll publish 0.3.0 myself (recommended)`, `Keep ${id} on the wall for later`]

const USER = 'you'

/** In-memory pocket-notes repo the sim "edits" — enough content for real diffs. */
const REPO_FILES: Record<string, string> = {
  'README.md': `# pocket-notes

A tiny notes CLI. Node >= 22.18 runs the TypeScript sources directly.

| Command | What it does |
| --- | --- |
| \`notes add <text>\` | add a note |
| \`notes list [--all]\` | list open notes (\`--all\` includes done ones) |
| \`notes done <id>\` | mark a note done |
| \`notes rm <id>\` | delete a note |

## Development

\`\`\`sh
npm test
\`\`\`
`,
  'src/cli.ts': `import { addNote, completeNote, listNotes, removeNote } from './notes.ts';
import { formatList, formatNote } from './format.ts';
import { loadNotes, saveNotes } from './store.ts';

interface Io {
  out: (line: string) => void;
  env: NodeJS.ProcessEnv;
  now?: () => number;
}

const HELP = \`notes - a tiny notes CLI
  notes add <text...>     add a note
  notes list [--all]      list open notes (--all includes done)
  notes done <id>         mark a note done
  notes rm <id>           delete a note
\`;

function parseId(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(\`bad id: \${raw}\`);
  return n;
}

function loadPath(env: NodeJS.ProcessEnv): string {
  return env.NOTES_FILE ?? 'notes.json';
}

const now = () => Date.now();

export function run(args: string[], io: Io): number {
  const file = loadPath(io.env);
  const [cmd, ...rest] = args;
  switch (cmd) {
    case 'add': {
      const note = addNote(loadNotes(file), rest.join(' '));
      saveNotes(file, note.notes);
      io.out(\`added #\${note.id}\`);
      return 0;
    }
    case 'list': {
        const all = rest.includes('--all');
        io.out(formatList(listNotes(loadNotes(file), { all }), now()));
        return 0;
    }
      case 'done': {
        const notes = completeNote(loadNotes(file), parseId(rest[0]));
        saveNotes(file, notes);
        return 0;
      }
    default:
      io.out(HELP);
      return 2;
  }
}

if (import.meta.url === \`file://\${process.argv[1]}\`) {
  const code = run(process.argv.slice(2), {
    env: process.env,
    out: (l) => console.log(l),
  });
  process.exit(code);
}
`,
  'src/notes.ts': `// Core note operations. Pure functions: callers own persistence.
export interface Note {
  id: number;
  text: string;
  done: boolean;
  createdAt: number;
}

export interface ListOptions {
  all?: boolean;
}

export function listNotes(notes: readonly Note[], opts: ListOptions): Note[] {
  const visible = opts.all ? notes : notes.filter((n) => !n.done);
  return [...visible].sort((a, b) => a.createdAt - b.createdAt);
}
`,
  'src/format.ts': `import type { Note } from './notes.ts';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export function formatNote(note: Note, now = Date.now()): string {
  const box = note.done ? '[x]' : '[ ]';
  const id = \`#\${note.id}\`.padEnd(4);
  return \`\${box} \${id} \${note.text}  (\${relativeTime(note.createdAt, now)})\`;
}

export function formatList(notes: readonly Note[], now = Date.now()): string {
  if (notes.length === 0) return 'No notes yet. Add one with: notes add "buy oat milk"';
  return notes.map((n) => formatNote(n, now)).join('\\n');
}
`,
  'test/format.test.ts': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatList, formatNote, relativeTime } from './format.ts';

test('formatList has a friendly empty state', () => {
  assert.match(formatList([], now), /No notes yet/);
});
`,
  'test/cli.test.ts': `import { test } from 'node:test';
import assert from 'node:assert/strict';

test('unknown commands exit 2 with help', () => {
  const h = harness();
  assert.equal(run(['bogus'], h.io), 2);
});
`,
  'test/notes.test.ts': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listNotes } from './notes.ts';
`,
}

interface Waiter {
  key: string
  resolve: () => void
}

export class SimDirector {
  vars: Record<string, string | number | boolean> = {}
  /** task key → display id */
  private taskIds = new Map<string, string>()
  private nextTaskId = 0
  /** task key → fake worktree file map (starts as a copy of the repo) */
  private worktrees = new Map<string, Record<string, string>>()
  private waiters: Waiter[] = []
  /** speed divisor: sleep(ms / speed) */
  speed = 1
  /** auto-answer decisions (first option) after this delay, 0 = wait for user */
  autoAnswer = 0
  readonly repoPath = '/repo/pocket-notes'
  readonly repoId = 'pocket-notes'
  goalText = DEFAULT_SIM_GOAL
  private running = true
  private pendingSleep: (() => void) | null = null

  constructor(readonly st: SimStore) {
    st.on(ev => {
      if (ev.type === 'decision' && ev.status === 'answered') {this.wake(ev.key)}
    })
  }

  userName(): string {
    return USER
  }

  task(key: string) {
    const t = this.st.tasks.get(key)

    if (!t) {throw new Error(`sim: unknown task ${key}`)}

    return t
  }

  wt(taskKey: string): { path: string; files: Record<string, string> } {
    const files = this.worktrees.get(taskKey) ?? { ...REPO_FILES }

    return { path: `${this.repoPath}-wt-${taskKey}`, files }
  }

  goal() {
    return this.st.goal
  }

  // ------------------------------------------------------------ timing

  sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
      const t = setTimeout(
        () => {
          this.pendingSleep = null
          resolve()
        },
        Math.max(60, ms / this.speed),
      )

      this.pendingSleep = () => {
        clearTimeout(t)
        resolve()
      }
    })
  }

  /** Abort the current sleep early (used by speed changes / stop). */
  wakeSleep(): void {
    this.pendingSleep?.()
  }

  stop(): void {
    this.running = false
    this.wakeSleep()
  }

  private wake(key: string) {
    const i = this.waiters.findIndex(w => w.key === key)

    if (i >= 0) {
      const w = this.waiters[i]
      this.waiters.splice(i, 1)
      w.resolve()
    }
  }

  // ------------------------------------------------------------ actions

  act(agentId: string, activity: AgentActivity, station: Station, detail = ''): void {
    this.st.setAgent(agentId, { activity, station, detail })
    this.st.setLamp(`agent:${agentId}`, this.st.agentStatus(this.st.agents.get(agentId)!))
  }

  log(agentId: string, kind: 'text' | 'tool' | 'result' | 'error' | 'diff' | 'memory', text: string): void {
    this.st.log(agentId, kind, text)
  }

  say(from: string, to: string, text: string): void {
    this.st.setAgent(from, { speech: { to, text, until: Date.now() + 6000 / this.speed + 2500 } })
    this.st.pushFeed('say', `${from} → ${to}: ${text.slice(0, 72)}${text.length > 72 ? '…' : ''}`, from)
  }

  private async tool(agentId: string, name: string, args: string, ms: number, station: Station = 'desk'): Promise<void> {
    this.act(agentId, 'reading', station, `$ ${name} ${args}`)
    this.log(agentId, 'tool', `$ ${name} ${args}`)
    await this.sleep(ms)
  }

  async read(agentId: string, _wtPath: string, path: string, ms = 900): Promise<void> {
    await this.tool(agentId, 'Read', path, ms)
    this.log(agentId, 'result', `(ok) ${path}`)
  }

  async glob(agentId: string, _root: string, pattern: string): Promise<void> {
    await this.tool(agentId, 'Glob', pattern, 700)
    this.log(agentId, 'result', 'src/cli.ts\nsrc/notes.ts\nsrc/format.ts\nsrc/store.ts\nsrc/tags.ts?')
  }

  async grep(agentId: string, _root: string, pattern: string): Promise<void> {
    await this.tool(agentId, 'Grep', pattern, 800)
    this.log(agentId, 'result', 'src/notes.ts:3 export interface Note\nsrc/notes.ts:10 export function listNotes\nsrc/cli.ts:11 export function run\n...')
  }

  async patch(agentId: string, wtPath: string, patches: Patch | Patch[], ms = 1200): Promise<void> {
    const list = Array.isArray(patches) ? patches : [patches]
    const taskKey = wtPath.split('-wt-')[1]
    const files = this.worktrees.get(taskKey ?? '')

    if (!files) {throw new Error(`sim: patch on unknown worktree ${wtPath}`)}
    this.act(agentId, 'editing', 'desk', `editing ${list.map(p => p.file).join(', ')}`)

    for (const p of list) {
      const r = applyPatch(files, p)

      if (r.changed) {
        this.log(agentId, 'diff', miniDiff(r.before, r.after))
      } else {
        this.log(agentId, 'text', `(no change) ${p.file}`)
      }

      await this.sleep(ms / list.length)
    }
  }

  /** runTests returns scripted pass/fail: t2 fails once, everything else passes after its fix. */
  private testPlan: Record<string, { pass: boolean; lines: string[] }> = {}
  private testRuns = new Map<string, number>()

  async runTests(agentId: string, opts: { taskKey?: string } = {}): Promise<boolean> {
    const key = opts.taskKey ?? 'baseline'
    const n = (this.testRuns.get(key) ?? 0) + 1
    this.testRuns.set(key, n)
    this.act(agentId, 'testing', 'testbench', 'running tests')
    this.st.setLamp('ci:1', Lamp.WORKING)
    this.st.setLamp('ci:2', Lamp.THINKING)
    this.st.setLamp('ci:3', Lamp.IDLE)
    this.log(agentId, 'tool', '$ npm test')
    await this.sleep(1400)
    // scripted outcome: t2 fails on first run (regex too loose), everything else passes
    const pass = !(key === 't2' && n === 1)
    const summary = pass ? `ok - ${18 + n * 2} tests pass` : `FAIL - 3 tests red (parseTags anchors)`
    this.log(agentId, pass ? 'result' : 'error', summary)
    this.st.setLamp('ci:1', pass ? Lamp.DONE : Lamp.ERROR)
    this.st.setLamp('ci:2', pass ? Lamp.DONE : Lamp.ERROR)
    this.st.setLamp('ci:3', pass ? Lamp.DONE : Lamp.OFF)
    this.st.pushFeed('ci', `CI ${pass ? 'green' : 'red'} for ${key === 'baseline' ? 'baseline' : this.task(key).id}`, agentId)
    this.act(agentId, 'thinking', 'desk', pass ? 'tests green' : 'tests red - fixing')

    return pass
  }

  async commit(agentId: string, taskKey: string, message: string): Promise<void> {
    this.log(agentId, 'tool', `$ git commit -m "${message}"`)
    await this.sleep(500)
    this.log(agentId, 'result', `[${taskKey}] ${message}`)
    this.st.pushFeed('task', `${agentId} committed on ${this.task(taskKey).id}`, agentId)
  }

  async cli(agentId: string, argv: string[][], finalLines?: string[]): Promise<void> {
    for (const args of argv) {
      this.act(agentId, 'running', 'terminal', `$ notes ${args.join(' ')}`)
      this.log(agentId, 'tool', `$ notes ${args.join(' ')}`)
      await this.sleep(650)

      const out =
        args[0] === 'add'
          ? `added #${Math.floor(Math.random() * 8 + 3)}`
          : args[0] === 'tags'
            ? '#work  3\n#today  1\n#family  1'
            : args[0] === 'list'
              ? '[ ] #3  ship v0.3 #work  (2h ago)\n[ ] #4  call mum #family  (1h ago)'
              : 'ok'

      this.log(agentId, 'result', out)
    }

    if (finalLines) {for (const l of finalLines) {this.log(agentId, 'result', l)}}
  }

  memory(agentId: string, scope: 'shared' | string, title: string, body: string, mode: 'replace' | 'append', tag?: string): void {
    this.st.pushFeed('memory', `${agentId} wrote "${title}" to ${scope} memory`, agentId)
    this.log(agentId, 'memory', `memory.${scope === 'shared' ? 'shared' : 'private'} ← "${title}"${tag ? ` [${tag}]` : ''}`)
  }

  think(agentId: string, text: string, station: Station, ms = 900): Promise<void> {
    this.act(agentId, 'thinking', station, text)
    this.log(agentId, 'text', `thinking: ${text}`)

    return this.sleep(ms)
  }

  // ------------------------------------------------------------ tasks

  ensureTask(key: string, input: { title: string; description?: string; deps?: string[]; assignee?: string; createdBy?: string; priority?: number }) {
    let t = this.st.tasks.get(key)

    if (t) {return t}
    this.nextTaskId++
    const id = `T-${this.nextTaskId}`
    this.taskIds.set(key, id)
    t = {
      key,
      id,
      title: input.title,
      description: input.description,
      state: 'todo',
      assignee: input.assignee ?? null,
      deps: input.deps ?? [],
      priority: input.priority ?? 0,
    }
    this.st.addTask(t)

    return t
  }

  setTask(key: string, state: 'todo' | 'doing' | 'review' | 'done' | 'blocked' | 'cancelled', opts: { summary?: string; reason?: string } = {}): void {
    this.st.setTask(key, { state, summary: opts.summary, blockedReason: opts.reason })

    if (state === 'blocked') {
      this.st.pushFeed('task', `${this.task(key).id} blocked: ${opts.reason ?? ''}`)
    }
  }

  async startTask(agentId: string, taskKey: string) {
    this.setTask(taskKey, 'doing')
    this.st.setAgent(agentId, { taskKey })
    const wt = this.wt(taskKey)
    this.worktrees.set(taskKey, wt.files)
    this.act(agentId, 'thinking', 'desk', `starting ${this.task(taskKey).id}: ${this.task(taskKey).title}`)
    this.st.pushFeed('task', `${agentId} picked up ${this.task(taskKey).id}`, agentId)
    await this.sleep(600)

    return wt
  }

  finishTask(agentId: string, taskKey: string, summary: string): void {
    this.setTask(taskKey, 'review', { summary })
    this.log(agentId, 'result', `${this.task(taskKey).id} → review: ${summary}`)
    this.st.pushFeed('task', `${this.task(taskKey).id} ready for review`, agentId)
  }

  doneNoCode(taskKey: string, summary: string): void {
    this.setTask(taskKey, 'done', { summary })
    this.st.pushFeed('task', `${this.task(taskKey).id} done: ${summary.slice(0, 60)}`)
  }

  // ------------------------------------------------------------ decisions

  openDecision(key: string, build: () => { agentId: string; kind: 'permission' | 'question' | 'merge'; question: string; options: string[]; context?: string; tool?: string; taskId?: string }): void {
    const d = build()
    const taskKey = d.taskId ? this.taskKeyFor(d.taskId) : undefined
    this.st.openDecision({
      key,
      agentId: d.agentId,
      kind: d.kind,
      question: d.question,
      options: d.options,
      context: d.context,
      tool: d.tool,
      taskKey,
      status: 'open',
      openedAt: Date.now(),
    })
    this.st.pushFeed('decision', `${d.agentId} asks: ${d.question.slice(0, 64)}…`, d.agentId)
  }

  private taskKeyFor(id: string): string | undefined {
    for (const t of this.st.tasks.values()) {if (t.id === id) {return t.key}}

    return undefined
  }

  awaitDecision(key: string): Promise<{ status: DecisionStatus; answer?: { option?: string; text?: string } }> {
    const d = this.st.decisions.get(key)!

    return new Promise(resolve => {
      const done = () => resolve({ status: d.status, answer: d.answer })

      if (d.status !== 'open') {return done()}

      if (this.autoAnswer > 0) {
        // auto mode picks the recommended (first) option after a beat
        setTimeout(() => {
          if (d.status === 'open') {this.st.answerDecision(key, { option: d.options[0] })}
        }, this.autoAnswer / this.speed)
      }

      this.waiters.push({ key, resolve: done })
    })
  }

  async requestMerge(taskKey: string, round: number, note: string): Promise<void> {
    const t = this.task(taskKey)
    const agentId = t.assignee ?? 'marlow'
    const files = this.worktrees.get(taskKey) ?? {}
    const diff = miniDiff(REPO_FILES['src/cli.ts'] ?? '', files['src/cli.ts'] ?? REPO_FILES['src/cli.ts'] ?? '', 22)
    this.st.openDecision({
      key: `merge:${taskKey}:${round}`,
      agentId,
      kind: 'merge',
      question: `Merge ${t.id} "${t.title}"?`,
      options: ['Merge', 'Request changes', 'Reject'],
      context: note,
      taskKey,
      status: 'open',
      openedAt: Date.now(),
      diff: diff.trim() ? diff : `(no diff for src/cli.ts — ${t.id} changes live elsewhere)`,
      files: [t.title.toLowerCase().includes('readme') ? 'README.md' : 'src/cli.ts'],
    })
    this.st.pushFeed('decision', `${agentId} wants to merge ${t.id}`, agentId)
    this.act(agentId, 'waiting_user', 'mergestation', `merge review for ${t.id}`)
    this.st.setLamp('merge', Lamp.WAITING)
    this.st.setBulbs('merge', true)
  }

  /** Waits on the merge decision; on approval marks task done and celebrates. */
  async settleMerge(taskKey: string, agentId: string, _path: string): Promise<'merged' | 'rejected' | 'changes'> {
    const t = this.task(taskKey)
    const key = [...this.st.decisions.values()].find(d => d.kind === 'merge' && d.taskKey === taskKey && d.status === 'open')?.key
    const d = key ? await this.awaitDecision(key) : { status: 'answered' as const, answer: { option: 'Merge' } }
    const opt = d.answer?.option ?? 'Merge'
    this.st.setBulbs('merge', false)
    this.st.setLamp('merge', Lamp.OFF)

    if (opt === 'Merge') {
      this.setTask(taskKey, 'done', { summary: `merged by ${USER}` })
      this.log(agentId, 'result', `${t.id} merged into main`)
      this.st.pushFeed('merge', `${t.id} merged`, agentId)
      this.act(agentId, 'done', 'mergestation', `${t.id} merged`)

      return 'merged'
    }

    if (opt === 'Reject') {
      this.vars.rejected = true
      this.setTask(taskKey, 'cancelled', { summary: `rejected by ${USER}` })
      this.log(agentId, 'error', `${t.id} rejected - winding down`)
      this.st.pushFeed('decision', `${t.id} rejected`, agentId)
      this.act(agentId, 'blocked', 'desk', `${t.id} rejected`)

      return 'rejected'
    }

    // Request changes: one scripted round — the worker applies a note and re-requests.
    this.log(agentId, 'text', `${t.id}: changes requested — fixing and re-submitting`)
    this.st.pushFeed('decision', `${t.id}: changes requested`)
    this.act(agentId, 'editing', 'desk', `addressing review on ${t.id}`)
    await this.patch(agentId, this.wt(taskKey).path, { file: 'src/cli.ts', find: 'export function run(', replace: '// review note addressed\nexport function run(' }, 800)
    await this.requestMerge(taskKey, 2, `${agentId}-${taskKey}: review note addressed.`)

    return this.settleMerge(taskKey, agentId, _path)
  }
}

export { E }
