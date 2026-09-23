/**
 * system-python.ts
 *
 * POSIX half of findSystemPython() (main.ts). The Windows branch already
 * filters candidates to SUPPORTED_VERSIONS via the registry, install-dir
 * names, and explicit `py -3.x` flags; the POSIX branch historically
 * returned the first `python3`/`python` on PATH with no version check.
 * On stock macOS that is /usr/bin/python3 == 3.9, and the codebase's
 * PEP 604 unions crash the backend at boot (#39536).
 *
 * So every POSIX PATH candidate is probed for its version before being
 * trusted, mirroring the Windows pass-3 `py.exe -<version>` approach.
 * A candidate that fails to report a version, or reports one outside
 * the supported range, is skipped — falling through to the next command
 * or to null, which lets the caller offer a managed install instead of
 * spawning a backend that cannot boot.
 */

export const SUPPORTED_PYTHON_VERSIONS = ['3.11', '3.12', '3.13']

const VERSION_PROBE_ARGS = ['-c', 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")']

export interface PosixSystemPythonOptions {
  findOnPath: (command: string) => string | null
  execText: (command: string, args: string[], opts?: { timeout?: number }) => Promise<string>
  timeoutMs?: number
}

/**
 * Return the first python3/python on PATH whose reported version is
 * supported, or null when no candidate qualifies.
 */
export async function findPosixSystemPython(opts: PosixSystemPythonOptions): Promise<string | null> {
  const { findOnPath, execText, timeoutMs } = opts

  for (const command of ['python3', 'python']) {
    const candidate = findOnPath(command)

    if (!candidate) {
      continue
    }

    try {
      const out = await execText(candidate, VERSION_PROBE_ARGS, { timeout: timeoutMs })

      if (SUPPORTED_PYTHON_VERSIONS.includes(out.trim())) {
        return candidate
      }
    } catch {
      // Probe failed (non-zero exit, timeout, not a real interpreter) —
      // an unverifiable python is not a usable backend. Try the next one.
    }
  }

  return null
}
