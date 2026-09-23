// Resolver for the OpenSSH client binary. The Windows in-box ssh.exe under
// System32\OpenSSH can be present yet broken (disabled optional feature,
// corrupted install), and spawning it boot-loops the caller. Candidates are
// tried in precedence order and each is validated by a bounded `ssh -V`
// probe — existence is not proof. Pure/electron-free: spawn, platform, and
// paths arrive as data so tests fake the host, not the machine.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const SSH_PROBE_TIMEOUT_MS = 5_000

export class SshBinaryUnavailableError extends Error {
  readonly candidates: string[]

  constructor(candidates: string[]) {
    super(
      'No working OpenSSH client found. Tried: ' +
        candidates.join(', ') +
        ". Install an OpenSSH client (Windows: Settings > Optional features > 'OpenSSH Client') or repair the existing installation."
    )
    this.name = 'SshBinaryUnavailableError'
    this.candidates = candidates
  }
}

export interface SshBinaryResolutionDeps {
  platform?: string
  systemRoot?: string
  resourcesPath?: string | null
  exists?: (candidate: string) => boolean
  spawnFn?: typeof spawn
  probeTimeoutMs?: number
}

function sshBinaryCandidates(deps: SshBinaryResolutionDeps): string[] {
  const platform = deps.platform ?? process.platform
  const candidates = ['ssh']

  if (platform === 'win32') {
    const root = deps.systemRoot ?? process.env.SystemRoot ?? 'C:\\Windows'
    candidates.push(`${root}\\System32\\OpenSSH\\ssh.exe`)
  }

  const resourcesPath = deps.resourcesPath !== undefined ? deps.resourcesPath : process.resourcesPath

  if (resourcesPath) {
    candidates.push(path.join(resourcesPath, 'openssh', platform === 'win32' ? 'ssh.exe' : 'ssh'))
  }

  return candidates
}

function probeSshBinary(candidate: string, deps: SshBinaryResolutionDeps): Promise<boolean> {
  const spawnFn = deps.spawnFn ?? spawn
  const timeout = deps.probeTimeoutMs ?? SSH_PROBE_TIMEOUT_MS

  return new Promise(resolve => {
    const child = spawnFn(candidate, ['-V'], { stdio: ['ignore', 'ignore', 'pipe'] })

    const timer = setTimeout(() => {
      child.kill()
      resolve(false)
    }, timeout)

    child.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
    child.once('exit', code => {
      clearTimeout(timer)
      resolve(code === 0)
    })
  })
}

export async function resolveSshBinary(deps: SshBinaryResolutionDeps = {}): Promise<string> {
  const exists = deps.exists ?? (candidate => candidate === 'ssh' || fs.existsSync(candidate))
  const candidates = sshBinaryCandidates(deps).filter(candidate => exists(candidate))

  for (const candidate of candidates) {
    if (await probeSshBinary(candidate, deps)) {
      return candidate
    }
  }

  throw new SshBinaryUnavailableError(candidates)
}
