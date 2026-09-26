import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Regression coverage for #93479: a failed dynamic import of the lazily-loaded
// Shiki diff module (packaged asar/asar.unpacked path mismatch, or any other
// fetch failure) rejects the `React.lazy()` promise. React.Suspense only
// covers the *pending* state, so the rejection throws past it to the nearest
// error boundary — which in production is the whole workspace `ContribBoundary`
// — and blanks the transcript instead of degrading to the plain colored diff.
//
// The mock resolves to a component that throws the fetch error during render —
// the same way React surfaces a rejected lazy payload (a rejected import
// re-throws at render time). Do NOT throw inside the factory itself: a
// throwing factory leaves rejected promises in the vitest mocker registry,
// and under CI load one escapes as an "unhandled error during the test run"
// attributed to whichever sibling test file the worker is running (#94415).
vi.mock('./syntax-diff', () => ({
  default: () => {
    throw new Error(
      'Failed to fetch dynamically imported module: file:///Hermes.app/Contents/Resources/app.asar/dist/assets/syntax-diff-Bo0962zh.js'
    )
  }
}))

import { ErrorBoundary } from '@/components/error-boundary'

import { FileDiffPanel, insertDiffComments, parseDiff } from './diff-lines'

afterEach(cleanup)

const DIFF = [
  'diff --git a/file.ts b/file.ts',
  '--- a/file.ts',
  '+++ b/file.ts',
  '@@ -1,2 +1,2 @@',
  ' const a = 1',
  '-const b = 2',
  '+const b = 3'
].join('\n')

const WORKSPACE_FALLBACK_TEXT = 'workspace failed to render'

// The failure surfaces only from console.error noise, not from the assertion.
function renderQuietly(node: Parameters<typeof render>[0]) {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

  try {
    return render(node)
  } finally {
    spy.mockRestore()
  }
}

describe('FileDiffPanel survives a failed lazy syntax-diff chunk', () => {
  it('degrades to the plain colored diff instead of taking down the surrounding boundary', async () => {
    const { container } = renderQuietly(
      <ErrorBoundary fallback={() => <div>{WORKSPACE_FALLBACK_TEXT}</div>} label="workspace">
        <FileDiffPanel diff={DIFF} path="file.ts" />
      </ErrorBoundary>
    )

    // The rejection settles a tick after the initial Suspense-pending render
    // (which coincidentally shows the same plain text already) — give it
    // real time to propagate before asserting nothing regressed.
    await act(() => new Promise(resolve => setTimeout(resolve, 300)))

    expect(container.textContent).toContain('const a = 1')
    expect(container.textContent).toContain('const b = 2')
    expect(container.textContent).toContain('const b = 3')
    expect(container.textContent).not.toContain(WORKSPACE_FALLBACK_TEXT)
  })
})

describe('insertDiffComments', () => {
  // DIFF: context a=1 (new 1), removed b=2 (old 2), added b=3 (new 2).
  const LINES = parseDiff(DIFF)

  it('splices a comment below the row carrying its new-file line number', () => {
    const out = insertDiffComments(LINES, [{ body: 'rename is fine here', line: 2 }])
    const at = out.findIndex(line => line.kind === 'comment')

    expect(at).toBeGreaterThan(0)
    expect(out[at - 1].newNo).toBe(2)
    expect(out[at].text).toBe('rename is fine here')
  })

  it('anchors a comment for a removed line under the remove row (oldNo)', () => {
    // Pure removal: old line 2 exists only on the `-` side, so a comment naming
    // it survives via the oldNo sweep instead of being dropped.
    const removal = parseDiff(['@@ -1,2 +1,1 @@', ' const a = 1', '-const b = 2'].join('\n'))
    const out = insertDiffComments(removal, [{ body: 'this line is gone', line: 2 }])
    const removed = out.findIndex(line => line.kind === 'remove' && line.oldNo === 2)

    expect(removed).toBeGreaterThanOrEqual(0)
    expect(out[removed + 1]?.kind).toBe('comment')

    const orphan = insertDiffComments(LINES, [{ body: 'orphan', line: 99 }])
    expect(orphan.some(line => line.kind === 'comment')).toBe(false)
  })

  it('returns the input untouched when there is nothing to splice', () => {
    expect(insertDiffComments(LINES, [])).toBe(LINES)
    expect(insertDiffComments(LINES, [{ body: ' ', line: 1 }])).toBe(LINES)
  })
})
