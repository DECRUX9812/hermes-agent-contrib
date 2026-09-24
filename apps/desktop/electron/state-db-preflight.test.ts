/**
 * state-db-preflight.test.ts
 *
 * #91636 — the emergency state.db backup ran `fs.copyFileSync(state.db, bak)`
 * while the backend was still alive. state.db runs WAL
 * (hermes_state.py `apply_wal_with_fallback`), so frames committed only in
 * state.db-wal never reach the .bak: the snapshot is torn — a "backup" that
 * silently drops the most recent writes. The emergency set must carry the
 * `-wal`/`-shm` sidecars next to the `.bak`, and the 2-most-recent pruning
 * must keep each backup's sidecars in step with its `.bak`.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, test } from 'vitest'

import { preflightStateDb } from './state-db-preflight'

const tmpDirs: string[] = []

function mkTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-db-preflight-'))
  tmpDirs.push(dir)

  return dir
}

afterEach(() => {
  while (tmpDirs.length) {
    fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true })
  }
})

const noopLog = () => {}

/** Rows committed while this handle stays open live only in state.db-wal. */
function createWalBackedStateDb(home: string): DatabaseSync {
  const db = new DatabaseSync(path.join(home, 'state.db'))
  db.exec('PRAGMA journal_mode=WAL')
  db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, note TEXT)')
  db.exec("INSERT INTO sessions VALUES ('wal-only-row', 'committed in wal')")

  return db
}

function emergencyBaks(home: string): string[] {
  return fs
    .readdirSync(home)
    .filter(f => f.startsWith('state.db.pre-update-emergency-') && f.endsWith('.bak'))
    .sort()
}

describe('preflightStateDb emergency backup (#91636)', () => {
  test('copies the -wal/-shm sidecars so the .bak restores WAL-side rows', () => {
    const home = mkTmpDir()
    const live = createWalBackedStateDb(home)

    try {
      preflightStateDb(home, noopLog)
    } finally {
      live.close()
    }

    const baks = emergencyBaks(home)
    assert.equal(baks.length, 1, 'expected one emergency .bak')

    const bak = path.join(home, baks[0])
    assert.ok(
      fs.existsSync(`${bak}-wal`),
      'emergency backup must include the -wal sidecar — ' +
        'a bare copyFileSync of state.db loses every frame committed only in the WAL'
    )

    // Restore the backup set into a fresh dir and open it: rows that were
    // only in the WAL at snapshot time must be visible.
    const restoreDir = mkTmpDir()
    fs.copyFileSync(bak, path.join(restoreDir, 'state.db'))
    fs.copyFileSync(`${bak}-wal`, path.join(restoreDir, 'state.db-wal'))

    if (fs.existsSync(`${bak}-shm`)) {
      fs.copyFileSync(`${bak}-shm`, path.join(restoreDir, 'state.db-shm'))
    }

    const restored = new DatabaseSync(path.join(restoreDir, 'state.db'))

    try {
      const rows = restored.prepare('SELECT id FROM sessions').all() as Array<{ id: string }>
      expect(rows.map(r => r.id)).toContain('wal-only-row')
    } finally {
      restored.close()
    }
  })

  test('pruning keeps each retained backup’s sidecar set intact', () => {
    const home = mkTmpDir()

    // Three older backup sets, then the live preflight adds a fourth: the
    // two oldest sets must go entirely (bak + wal + shm), the two newest
    // old sets stay whole.
    for (const ts of ['2026-01-01T00-00-00-000Z', '2026-01-02T00-00-00-000Z', '2026-01-03T00-00-00-000Z']) {
      const base = path.join(home, `state.db.pre-update-emergency-${ts}.bak`)
      fs.writeFileSync(base, 'x'.repeat(200))
      fs.writeFileSync(`${base}-wal`, 'wal')
      fs.writeFileSync(`${base}-shm`, 'shm')
    }

    const live = createWalBackedStateDb(home)

    try {
      preflightStateDb(home, noopLog)
    } finally {
      live.close()
    }

    const baks = emergencyBaks(home)
    expect(baks.length).toBeLessThanOrEqual(3)

    // No orphan sidecars: every remaining -wal/-shm belongs to a kept .bak.
    const orphans = fs
      .readdirSync(home)
      .filter(f => f.endsWith('.bak-wal') || f.endsWith('.bak-shm'))
      .filter(f => !fs.existsSync(path.join(home, f.replace(/\.bak-(wal|shm)$/, '.bak'))))

    expect(orphans).toEqual([])
  })
})
