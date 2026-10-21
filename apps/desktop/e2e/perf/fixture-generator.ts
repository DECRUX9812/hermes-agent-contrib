/**
 * Fixture generator for the perf lane: seeds durable Hermes sessions/messages
 * into a sandboxed HERMES_HOME so the specs can measure realistic loads
 * (a 2,000-message transcript, a 500-session rail across three profiles)
 * without paying for hundreds of real agent turns.
 *
 * The database file itself is always created by the REAL backend schema —
 * `SessionDB(db_path=...)` from this checkout — so tables, FTS triggers and
 * schema_version are whatever the repo ships. The generator only
 * bulk-appends rows that read exactly like closed desktop sessions
 * (source='desktop', end_reason='tui_close').
 *
 * Requires a working repo Python env: HERMES_PYTHON or `python` on PATH must
 * be able to `import hermes_state` (repo root is added to PYTHONPATH).
 */

import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { writeEnvFile, writeMockProviderConfig } from '../../../../tests-js/scripts/mock-provider-config'

/** state.db location for a profile: the profile's own home directory. */
export function stateDbPath(hermesHome: string, profile = 'default'): string {
  return profile === 'default'
    ? path.join(hermesHome, 'state.db')
    : path.join(hermesHome, 'profiles', profile, 'state.db')
}

/**
 * Register a named profile on disk the same way the backend's profile
 * discovery expects: `profiles/<name>/` with a config.yaml.
 */
export function seedProfileDir(hermesHome: string, name: string): void {
  const dir = path.join(hermesHome, 'profiles', name)
  fs.mkdirSync(dir, { recursive: true })

  if (!fs.existsSync(path.join(dir, 'config.yaml'))) {
    fs.writeFileSync(path.join(dir, 'config.yaml'), '', 'utf8')
  }
}

/**
 * Create a real, fully-migrated state.db in `homeDir` by opening it through
 * this checkout's SessionDB — the same schema initializer the backend runs.
 * Returns the db path with zero rows.
 */
export function bootstrapDbForSeeds(homeDir: string): string {
  const dbPath = path.join(homeDir, 'state.db')

  if (fs.existsSync(dbPath)) {
    return dbPath
  }

  const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
  execFileSync(
    process.env.HERMES_PYTHON ?? 'python',
    [
      '-c',
      'import sys\nfrom pathlib import Path\nfrom hermes_state import SessionDB\nSessionDB(db_path=Path(sys.argv[1])).close()',
      dbPath,
    ],
    {
      env: { ...process.env, HERMES_HOME: homeDir, PYTHONPATH: repoRoot },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  )

  if (!fs.existsSync(dbPath)) {
    throw new Error(`fixture bootstrap ran but ${dbPath} was not created`)
  }

  return dbPath
}

/**
 * Copy the bootstrapped default-profile database into `targetDir` (a genuine
 * schema without another gateway spawn) and return the new db path.
 */
function cloneStateDb(templatePath: string, targetDir: string): string {
  fs.mkdirSync(targetDir, { recursive: true })
  const target = path.join(targetDir, 'state.db')
  fs.copyFileSync(templatePath, target)

  return target
}

export interface SeededSession {
  id: string
  /** First user message — the rail falls back to it as the row preview. */
  preview: string
}

/**
 * Insert `count` closed desktop sessions, each with `pairs` user/assistant
 * turns. `idPrefix` must be unique across the seeded home (ids are
 * profile-scoped anyway, but unique ids keep debugging sane). Timestamps are
 * spread backwards from `now` one minute apart so ordering is deterministic:
 * index 0 in the returned list is the most recently started session.
 */
export function insertSessions(
  dbPath: string,
  opts: { count: number; idPrefix: string; titlePrefix: string; pairs?: number; now?: number },
): SeededSession[] {
  const pairs = opts.pairs ?? 1
  const now = opts.now ?? Date.now() / 1000
  const db = new DatabaseSync(dbPath)

  const insertSession = db.prepare(
    `INSERT INTO sessions
       (id, source, started_at, ended_at, end_reason, message_count, tool_call_count,
        cwd, title, title_source, last_activity_at, archived, hidden, pinned)
     VALUES (?, 'desktop', ?, ?, 'tui_close', ?, 0, ?, ?, 'derived', ?, 0, 0, 0)`,
  )

  const insertMessage = db.prepare(
    `INSERT INTO messages
       (session_id, role, content, timestamp, token_count, finish_reason, observed, active, display_order)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)`,
  )

  const seeded: SeededSession[] = []

  try {
    db.exec('BEGIN')

    for (let i = 0; i < opts.count; i += 1) {
      const id = `perf-${opts.idPrefix}-${i}`
      const preview = `${opts.titlePrefix} ${i}`
      const startedAt = now - (opts.count - i) * 60
      insertSession.run(id, startedAt, startedAt + 30, pairs * 2, '/tmp/perf-seed', preview, startedAt + 30)

      for (let turn = 0; turn < pairs; turn += 1) {
        const t = startedAt + turn * 2
        insertMessage.run(id, 'user', turn === 0 ? preview : `${preview} follow-up ${turn}`, t, 8, null, turn * 2)
        insertMessage.run(id, 'assistant', `${preview} reply ${turn}`, t + 1, 12, 'stop', turn * 2 + 1)
      }

      seeded.push({ id, preview })
    }

    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally {
    db.close()
  }

  return seeded
}

/** Bootstrap the default profile's state.db and seed `count` listable sessions into it. */
export function seedSessionsIntoDefault(
  hermesHome: string,
  count: number,
  titlePrefix = 'perf session',
): SeededSession[] {
  const dbPath = bootstrapDbForSeeds(hermesHome)

  return insertSessions(dbPath, { count, idPrefix: 'default', titlePrefix })
}

/**
 * One session holding `pairs` user/assistant turns (2×pairs messages) in the
 * default profile. The first user row carries `title` (the rail preview); the
 * last pair carries distinctive end markers so specs can wait on the
 * oldest/newest rendered rows.
 */
export function seedTranscriptSession(
  hermesHome: string,
  opts: { title: string; pairs: number },
): { id: string; title: string } {
  const dbPath = bootstrapDbForSeeds(hermesHome)
  const id = `perf-transcript-${Math.random().toString(36).slice(2, 10)}`
  const now = Date.now() / 1000
  const db = new DatabaseSync(dbPath)

  const insertSession = db.prepare(
    `INSERT INTO sessions
       (id, source, started_at, ended_at, end_reason, message_count, tool_call_count,
        cwd, title, title_source, last_activity_at, archived, hidden, pinned)
     VALUES (?, 'desktop', ?, ?, 'tui_close', ?, 0, '/tmp/perf-seed', ?, 'derived', ?, 0, 0, 0)`,
  )

  const insertMessage = db.prepare(
    `INSERT INTO messages
       (session_id, role, content, timestamp, token_count, finish_reason, observed, active, display_order)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)`,
  )

  try {
    db.exec('BEGIN')
    insertSession.run(id, now - opts.pairs * 2, now, opts.pairs * 2, opts.title, now)

    for (let i = 0; i < opts.pairs; i += 1) {
      const userText =
        i === 0 ? opts.title : i === opts.pairs - 1 ? `PERF TRANSCRIPT LAST USER ${i}` : `perf turn ${i}: user message`

      const assistantText =
        i === opts.pairs - 1
          ? `PERF TRANSCRIPT LAST ASSISTANT ${i}`
          : `perf turn ${i}: assistant reply with a realistic amount of text, enough to paint several lines and keep the row weight honest.`

      insertMessage.run(id, 'user', userText, now - opts.pairs * 2 + i * 2, 8, null, i * 2)
      insertMessage.run(id, 'assistant', assistantText, now - opts.pairs * 2 + i * 2 + 1, 40, 'stop', i * 2 + 1)
    }

    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally {
    db.close()
  }

  return { id, title: opts.title }
}

/**
 * Seed `profiles` (and `default` when listed) with `sessionsPerProfile`
 * sessions each. Bootstraps the schema once in `hermesHome`, then clones the
 * empty db into each profile home so every seed shares genuine metadata.
 */
export function seedSessionRail(
  hermesHome: string,
  profiles: string[],
  sessionsPerProfile: number,
  mockUrl?: string,
): void {
  const template = bootstrapDbForSeeds(hermesHome)

  for (const profile of profiles) {
    const dbPath =
      profile === 'default'
        ? template
        : cloneStateDb(template, path.join(hermesHome, 'profiles', profile))

    if (profile !== 'default') {
      seedProfileDir(hermesHome, profile)

      // A named profile booting without provider config puts the onboarding
      // glass over the whole window; give each seeded profile the same mock
      // endpoint as the default home so any of them can be "most recent".
      if (mockUrl) {
        const profileHome = path.join(hermesHome, 'profiles', profile)
        writeMockProviderConfig(profileHome, mockUrl)
        writeEnvFile(profileHome, 'e2e-mock-key', mockUrl)
      }
    }

    insertSessions(dbPath, {
      count: sessionsPerProfile,
      idPrefix: `${profile}-rail`,
      titlePrefix: `perf rail ${profile}`,
    })
  }
}
