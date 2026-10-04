/**
 * CLI harness adapter — headless agent CLIs as bots.
 *
 * The "tag every CLI builder" lane: Codex CLI, Claude Code, OpenCode, Gemini
 * CLI — anything that can take a prompt and stream an answer can live in the
 * room as a mascot.
 *
 * A browser extension cannot spawn processes, so the adapter talks to a tiny
 * relay the user runs on their own machine (`hermes bot-relay` is the
 * reference implementation; any process that speaks the frames below works).
 * The extension never builds argv — it sends a `spec` the relay executes
 * with array-form spawn (no shell, no quoting bugs).
 *
 * ── Bot Room Relay Protocol (BRRP/1) ──────────────────────────────────────
 * Transport: WebSocket, `ws://127.0.0.1:9933` by default (the harness
 * `baseUrl` carries it — swap the port freely, the adapter only cares about
 * the frame shapes). One text frame = one JSON object. `task_id` correlates
 * everything after `task.start`.
 *
 * Extension → relay:
 *   {type:'init', client:'bot-room', version:1}
 *       First frame on every (re)connect. Informational; the relay may
 *       answer `hello` but the adapter does not block on it.
 *   {type:'ping'}
 *       Keepalive for relays that idle-close; answered by {type:'pong'}.
 *   {type:'task.start', task_id, bot, preset?, spec?, text,
 *     session_id?, timeout_ms}
 *       Run one task. `preset` names a CLI the relay already knows
 *       ('codex'|'claude'|'opencode'|'gemini'); `spec` is the full
 *       {cmd,args,format,session_args?,env?} form for relays that accept
 *       arbitrary commands — send BOTH (preset is the fallback when the
 *       relay refuses raw specs). `text` is the complete prompt. The relay
 *       MUST substitute each `{prompt}` element of args with `text` as ONE
 *       argv element — array-form spawn, never string-split, never a shell.
 *       `session_id` carries the last id the relay reported for this bot so
 *       the CLI can resume its own conversation (see session_args).
 *       `timeout_ms` asks the relay to SIGTERM the child past it.
 *   {type:'task.interrupt', task_id}
 *       Best-effort cancel — SIGINT then SIGTERM is the usual ladder.
 *   {type:'action.result', task_id, action_id?, ok, result?, error?}
 *       Answer to a `page_action` frame. Always sent when the action ran;
 *       relays that can't feed it back into the child may just log it.
 *
 * Relay → extension:
 *   {type:'hello', relay, version, clis?: string[]}
 *       Optional greeting. `clis` lists presets the relay can actually run;
 *       the adapter uses it only for diagnostics (roster stays config-driven
 *       so bots exist even with the relay down).
 *   {type:'accepted', task_id, pid?}
 *       Optional ack that the child spawned.
 *   {type:'delta', task_id, text}
 *       Assistant text as it streams. Already normalized — the relay did
 *       the per-CLI JSON event decoding (see FORMATS below).
 *   {type:'status', task_id, line}
 *       One-line progress ("ran ls", "editing foo.ts"). Maps to the bot's
 *       status line.
 *   {type:'page_action', task_id, action_id?, action, arguments}
 *       Page-action echo. The relay watches stdout for any JSON line of the
 *       form {"bot_room":"page_action","action":...,"arguments":{...},
 *       "id":...} and converts it to this frame (stripping it from deltas).
 *       The adapter injects the convention into the prompt itself (see
 *       PAGE_ACTION_PREAMBLE) so ANY CLI can opt in — including CLIs whose
 *       event format the relay doesn't know. `action_id` present ⇒ the
 *       relay is holding the child open for `action.result`; absent ⇒
 *       fire-and-forget.
 *   {type:'done', task_id, text?, exit_code?, session_id?}
 *       Terminal success. `text` is the complete reply (the room posts it;
 *       deltas were a preview). `session_id` is the CLI's own conversation
 *       id (claude `result.session_id`, codex `thread.started.thread_id`),
 *       echoed back on the next `task.start` so per-bot memory works.
 *   {type:'error', task_id?, message, fatal?}
 *       failure; `fatal:true` (or error on an accepted task) settles the
 *       task as failed. No task_id = relay-level problem.
 *   {type:'pong'}
 *
 * CLI event formats (`spec.format` tells the relay how stdout decodes):
 *   codex-jsonl    `codex exec --json` — JSONL events; text lives on
 *                  item.completed items with type 'agent_message';
 *                  command_execution items → status; thread.started carries
 *                  the resumable thread id.
 *   claude-jsonl   `claude -p --output-format stream-json --verbose` —
 *                  JSONL; `assistant` events carry content[] text deltas,
 *                  terminal `result` event carries text + session_id.
 *   opencode-jsonl `opencode run` with JSON event output — part.type==='text'
 *                  deltas; unknown event types degrade to status lines.
 *   gemini-json    `gemini -o json` — one whole-buffer JSON object at exit
 *                  ({response, stats}); a single delta, no streaming.
 *   text           raw stdout → delta chunks, stderr → status, exit → done.
 *                  The universal fallback — a relay should treat unknown
 *                  formats as `text` rather than fail.
 *
 * argv escaping contract (relay side): spawn(cmd, args, {shell:false});
 * `{prompt}` / `{session}` substitutions happen per-arg, post-tokenize;
 * if an args element contains a placeholder as a substring (e.g.
 * `--resume={session}`) substitute inside the string — still one argv
 * element, never split.
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { Bot, GenericHarnessConfig } from '../../shared/types'
import type { Harness, TaskCallbacks, TaskResult } from '../harness'
import { rid } from '../harness'

import { JsonSocket } from './relay'
import { cfgBots, systemPromptFor } from './util'

/** How the relay decodes the child's stdout into deltas. */
export type CliEventFormat =
  | 'codex-jsonl'
  | 'claude-jsonl'
  | 'gemini-json'
  | 'opencode-jsonl'
  | 'text'

/** Everything a relay needs to spawn one CLI turn. */
export interface CliSpec {
  cmd: string
  /** argv template — '{prompt}' substituted with the task text. */
  args: string[]
  format: CliEventFormat
  /** Extra argv appended ONLY when a session_id is known ('{session}' is
   *  substituted). Lets one template cover fresh + resumed turns. */
  sessionArgs?: string[]
  env?: Record<string, string>
}

/**
 * Concrete presets for the four headless CLIs. Flags drift fast — the RELAY
 * is the place that pins to the installed binary; these are the advertised
 * defaults sent when the relay accepts raw specs.
 */
export const CLI_PRESETS: Record<string, CliSpec> = {
  claude: {
    cmd: 'claude',
    args: ['-p', '--output-format', 'stream-json', '--verbose', '{prompt}'],
    format: 'claude-jsonl',
    sessionArgs: ['--resume', '{session}'],
  },
  codex: {
    cmd: 'codex',
    args: ['exec', '--json', '--skip-git-repo-check', '{prompt}'],
    format: 'codex-jsonl',
    // `codex exec resume` consumes the thread id positionally.
    sessionArgs: ['resume', '{session}'],
  },
  gemini: {
    cmd: 'gemini',
    args: ['-o', 'json', '{prompt}'],
    format: 'gemini-json',
  },
  opencode: {
    cmd: 'opencode',
    args: ['run', '{prompt}'],
    // Older opencode builds stream plain stdout — relays should degrade this
    // to 'text' when the JSON event flag isn't supported by the binary.
    format: 'opencode-jsonl',
  },
}

/**
 * The page-action convention injected ahead of every task: the CLI learns
 * that printing a `{"bot_room":"page_action",...}` JSON line makes the relay
 * route it to the user's tab. stdout-marker (not a tool) because it works on
 * every CLI, including ones with no plugin system.
 */
const PAGE_ACTION_PREAMBLE = [
  '[BOT ROOM — page control]',
  'You are running inside the user\u2019s browser via the Bot Room extension.',
  'To act on the page the user is looking at, print ONE JSON line on stdout:',
  '  {"bot_room":"page_action","action":"<action>","arguments":{...}}',
  'Actions: navigate {url} | click {selector|text} | type {selector,text} |',
  'scroll {dx,dy} | snapshot {} | screenshot {} | read {selector|text} |',
  'mascot.perform {action:dance|wave|spin|jump|celebrate|point,x?,y?} |',
  'web.fetch {url}. The action runs in their real tab; keep working after',
  'emitting one (the result is echoed back to the relay, not to you).',
  '[/BOT ROOM]',
  '',
].join('\n')

const DEFAULT_TASK_TIMEOUT_MS = 300_000

interface ActiveTask {
  botRef: string
  resolve: (r: TaskResult) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
  settled: boolean
  actionsRun: number
}

export class CliRelayHarness implements Harness {
  readonly pageControl = true
  readonly id: string
  readonly kind: string
  readonly name: string

  private sock: JsonSocket
  private bots: Bot[]
  private tasks = new Map<string, ActiveTask>()
  private pendingCbs = new Map<string, TaskCallbacks>()
  /** botRef → the last task_id, for interrupt(). */
  private activeByBot = new Map<string, string>()
  /** botRef → CLI conversation id, echoed back for resume. */
  private sessions = new Map<string, string>()
  private presetName: string

  constructor(private cfg: GenericHarnessConfig) {
    this.id = cfg.id
    this.name = cfg.name
    this.kind = cfg.kind ?? 'cli-relay'
    this.bots = cfgBots(cfg, true)
    // Preset selection: explicit kind suffix ('cli-relay:claude') wins, then
    // the config's "model" field (it doubles as the preset picker for CLIs),
    // then codex as the neutral default.
    const suffix = (cfg.kind ?? '').split(':')[1]
    const requested = (suffix ?? cfg.model ?? '').toLowerCase()

    this.presetName = requested in CLI_PRESETS ? requested : 'codex'

    this.sock = new JsonSocket(cfg.baseUrl || 'ws://127.0.0.1:9933', {
      label: `cli-relay:${cfg.id}`,
    })
    this.sock.onFrame = f => this.handleFrame(f)

    this.sock.onOpen = () => {
      this.sock.send({ type: 'init', client: 'bot-room', version: 1 })
    }

    this.sock.onClose = () => this.failAll(new Error('relay connection dropped'))
  }

  async listBots() {
    // Config-driven roster: bots must exist even when the relay is down —
    // a dead relay is a send()-time error, not an empty roster.
    return this.bots
  }

  async send(botRef: string, text: string, cb: TaskCallbacks): Promise<TaskResult> {
    await this.sock.connect()

    const taskId = rid()
    const sessionId = this.sessions.get(botRef)
    const spec = CLI_PRESETS[this.presetName] ?? CLI_PRESETS['codex']!

    const persona = systemPromptFor(this.cfg, botRef)

    const frame: Record<string, unknown> = {
      type: 'task.start',
      task_id: taskId,
      bot: botRef,
      preset: this.presetName,
      spec: { ...spec, session_args: spec.sessionArgs },
      text: `${persona ? `${persona}\n\n` : ''}${PAGE_ACTION_PREAMBLE}${text}`,
      timeout_ms: DEFAULT_TASK_TIMEOUT_MS,
    }

    if (sessionId) {frame['session_id'] = sessionId}

    const reply = new Promise<TaskResult>((resolve, reject) => {
      const task: ActiveTask = {
        botRef,
        resolve,
        reject,
        settled: false,
        actionsRun: 0,
        timer: setTimeout(() => {
          this.sock.send({ type: 'task.interrupt', task_id: taskId })
          this.settle(taskId, undefined, new Error('task timed out'))
        }, DEFAULT_TASK_TIMEOUT_MS),
      }

      this.tasks.set(taskId, task)
      this.pendingCbs.set(taskId, cb)
      this.activeByBot.set(botRef, taskId)
    })

    if (!this.sock.send(frame)) {
      this.settle(taskId, undefined, new Error('relay socket not open'))
    }

    return reply
  }

  async interrupt(botRef: string): Promise<void> {
    const taskId = this.activeByBot.get(botRef)

    if (!taskId) {return}
    this.sock.send({ type: 'task.interrupt', task_id: taskId })
    // Don't wait on the relay to confirm — the room's cancel should feel
    // instant; a late done frame is ignored once settled.
    this.settle(taskId, undefined, new Error('interrupted'))
  }

  private handleFrame(f: Record<string, unknown>) {
    const type = f['type']

    if (type === 'pong' || type === 'hello') {return}

    const taskId = String(f['task_id'] ?? '')

    if (type === 'error' && !taskId) {
      console.warn(`[cli-relay:${this.id}] relay error:`, f['message'])

      return
    }

    const task = this.tasks.get(taskId)

    if (!task) {return}

    switch (type) {
      case 'accepted':
        break

      case 'delta':
        this.pendingCbs.get(taskId)?.onDelta?.(String(f['text'] ?? ''))

        break

      case 'status':
        this.pendingCbs.get(taskId)?.onStatus?.(String(f['line'] ?? ''))

        break
      case 'page_action': {
        const cb = this.pendingCbs.get(taskId)
        const actionId = f['action_id']

        const run = (reply: (r: unknown) => void) => {
          cb?.onPageAction?.(
            String(f['action'] ?? ''),
            (f['arguments'] ?? {}) as Record<string, unknown>,
            reply,
          )
        }

        if (actionId) {
          task.actionsRun++
          void new Promise(resolve => run(resolve)).then(result => {
            this.sock.send({
              type: 'action.result',
              task_id: taskId,
              action_id: actionId,
              ok: true,
              result: result ?? null,
            })
          })
        } else {
          task.actionsRun++
          run(() => undefined) // fire-and-forget echo
        }

        break
      }

      case 'done': {
        const sid = f['session_id']

        if (typeof sid === 'string' && sid) {this.sessions.set(task.botRef, sid)}
        this.settle(taskId, { text: String(f['text'] ?? ''), actionsRun: task.actionsRun })

        break
      }

      case 'error':
        this.settle(taskId, undefined, new Error(String(f['message'] ?? 'relay error')))

        break

      default:
        break
    }
  }

  private settle(taskId: string, result?: TaskResult, error?: Error) {
    const task = this.tasks.get(taskId)

    if (!task || task.settled) {return}
    task.settled = true
    clearTimeout(task.timer)
    this.tasks.delete(taskId)
    this.pendingCbs.delete(taskId)

    if (this.activeByBot.get(task.botRef) === taskId) {
      this.activeByBot.delete(task.botRef)
    }

    if (error) {
      task.reject(error)
    } else {
      task.resolve(result ?? { text: '(done)' })
    }
  }

  private failAll(e: Error) {
    for (const taskId of [...this.tasks.keys()]) {
      this.settle(taskId, undefined, e)
    }
  }

  dispose() {
    this.failAll(new Error('harness disposed'))
    this.sock.close()
  }
}
