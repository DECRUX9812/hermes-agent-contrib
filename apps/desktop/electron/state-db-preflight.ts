/**
 * state-db-preflight.ts
 *
 * Pre-flight state.db integrity guard (#68474).
 *
 * Take an emergency snapshot of state.db and verify the live copy is
 * intact before any update process mutates the install.  Runs in the
 * desktop Electron process itself, before the backend is killed and
 * before the updater is spawned — a separate safety net from the
 * Python-level pre-update snapshot inside `hermes update`.
 *
 * Extracted into its own dependency-free module (no electron import) so the
 * guard can be exercised directly against a real on-disk database, following
 * the backend-release-gate.ts pattern.
 */

import fs from 'node:fs'
import path from 'node:path'

function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

export function preflightStateDb(hermesHome: string, rememberLog: (line: string) => void): void {
  const stateDbPath = path.join(hermesHome, 'state.db')

  if (!fileExists(stateDbPath)) {
    rememberLog('[updates] state.db pre-flight: not found (fresh install?)')

    return
  }

  try {
    const stat = fs.statSync(stateDbPath)

    if (stat.size > 100) {
      const fd = fs.openSync(stateDbPath, 'r')
      const header = Buffer.alloc(16)

      fs.readSync(fd, header, 0, 16, 0)
      fs.closeSync(fd)

      const expectedHeader = Buffer.from('SQLite format 3\0')
      const headerOk = header.equals(expectedHeader)

      rememberLog(
        `[updates] state.db pre-flight: size=${stat.size}, ` +
          `headerOk=${headerOk}, headerHex=${header.toString('hex')}`
      )

      if (!headerOk) {
        rememberLog(
          '[updates] state.db header is INVALID before update — ' +
            'this indicates pre-existing corruption or a concurrent write issue'
        )
      }

      // Emergency timestamped backup, separate from the Python-level snapshot.
      const ts = new Date().toISOString().replace(/[:.]/g, '-')

      const emergencyPath = path.join(hermesHome, `state.db.pre-update-emergency-${ts}.bak`)

      try {
        fs.copyFileSync(stateDbPath, emergencyPath)

        // state.db runs WAL (hermes_state.py apply_wal_with_fallback), so
        // frames committed only in state.db-wal are not in the main file —
        // a bare copy of state.db is a torn snapshot missing the most recent
        // writes (#91636). Copy the -wal/-shm sidecars alongside the .bak so
        // the set restores consistently; either may be absent (checkpointed
        // or never created), which is fine.
        for (const sidecar of ['-wal', '-shm']) {
          const src = stateDbPath + sidecar

          if (fileExists(src)) {
            fs.copyFileSync(src, emergencyPath + sidecar)
          }
        }

        const emergStat = fs.statSync(emergencyPath)

        rememberLog(`[updates] emergency state.db backup: ${emergencyPath} ` + `(${emergStat.size} bytes)`)

        // Prune to the 2 most recent emergency backups — each .bak's -wal/
        // -shm sidecars go with it so no orphan sidecars survive (#91636).
        try {
          const homeDir = fs.readdirSync(hermesHome)

          const backups = homeDir
            .filter(
              f =>
                f.startsWith('state.db.pre-update-emergency-') &&
                f.endsWith('.bak') &&
                f !== path.basename(emergencyPath)
            )
            .sort()
            .reverse()

          for (const old of backups.slice(2)) {
            for (const f of [old, `${old}-wal`, `${old}-shm`]) {
              try {
                fs.unlinkSync(path.join(hermesHome, f))
              } catch {
                void 0
              }
            }
          }

          // Sidecars left behind by earlier versions (or a pruned .bak from
          // before they were copied) have no restorable .bak — drop them.
          for (const f of homeDir) {
            if (
              f.startsWith('state.db.pre-update-emergency-') &&
              (f.endsWith('.bak-wal') || f.endsWith('.bak-shm')) &&
              !fs.existsSync(path.join(hermesHome, f.replace(/\.bak-(wal|shm)$/, '.bak')))
            ) {
              try {
                fs.unlinkSync(path.join(hermesHome, f))
              } catch {
                void 0
              }
            }
          }
        } catch {
          void 0
        }
      } catch (copyErr) {
        rememberLog(`[updates] emergency state.db backup failed: ${(copyErr as Error).message}`)
      }
    } else {
      rememberLog(`[updates] state.db too small (${stat.size} bytes) for a valid SQLite database`)
    }
  } catch (statErr) {
    rememberLog(`[updates] could not stat state.db before update: ${(statErr as Error).message}`)
  }
}
