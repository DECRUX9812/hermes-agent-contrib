/**
 * Plan→build handoff: detect plan artifacts (files a session wrote to
 * `<workspace>/.hermes/plans/*.md`) and resolve the workspace they belong to,
 * so "Build with this" can seed a fresh session anchored there.
 */
import { isArtifactFilePath } from '@/lib/media'

import type { ArtifactRecord } from './artifact-utils'

// Plans land in `<cwd>/.hermes/plans/<timestamp>-<slug>.md` (agent/plan_prompt.py).
const PLAN_TAIL_ABS_RE = /[\\/]\.hermes[\\/]plans[\\/][^\\/]+\.md$/i
const PLAN_TAIL_REL_RE = /^\.hermes[\\/]plans[\\/][^\\/]+\.md$/i
const FILE_URL_RE = /^file:\/\//i

const normalizePath = (value: string): string =>
  value.replace(FILE_URL_RE, '').replace(/\\/g, '/').replace(/^\.\//, '')

/** The plan file's path as the artifact carries it, or null when the record
 *  isn't a `.hermes/plans/*.md` file artifact. */
export function planArtifactPath(artifact: Pick<ArtifactRecord, 'kind' | 'value'>): null | string {
  if (artifact.kind !== 'file') {
    return null
  }

  const path = normalizePath(artifact.value.trim())

  if (PLAN_TAIL_REL_RE.test(path)) {
    return path
  }

  return PLAN_TAIL_ABS_RE.test(path) && isArtifactFilePath(path) ? path : null
}

export function isPlanArtifact(artifact: Pick<ArtifactRecord, 'kind' | 'value'>): boolean {
  return planArtifactPath(artifact) !== null
}

/**
 * The workspace a plan artifact was written from, plus the plan's path
 * relative to it — the seed for a fresh session's cwd + `@file:` ref.
 *
 * Absolute plans carry their workspace in the path itself; a cwd-relative
 * `.hermes/plans/x.md` needs the origin session's cwd (absent → null, so the
 * affordance hides rather than anchoring the build to the wrong tree).
 */
export function planWorkspace(
  artifact: Pick<ArtifactRecord, 'kind' | 'value'>,
  sessionCwd?: null | string
): null | { relPath: string; workspace: string } {
  const path = planArtifactPath(artifact)

  if (!path) {
    return null
  }

  if (PLAN_TAIL_REL_RE.test(path)) {
    const workspace = sessionCwd?.replace(/[\\/]+$/, '')

    return workspace ? { relPath: path, workspace } : null
  }

  const tail = PLAN_TAIL_ABS_RE.exec(path)

  if (!tail || tail.index <= 0) {
    return null
  }

  return { relPath: path.slice(tail.index + 1), workspace: path.slice(0, tail.index) }
}
