import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, test } from 'vitest'

import {
  gitFor,
  repoStatus,
  resolveRenamePath,
  REVIEW_FILE_CAP,
  reviewList,
  reviewRevert,
  reviewStage,
  reviewUnstage
} from './git-review-ops'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true })
  }
})

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-desktop-git-status-'))

  tempDirs.push(dir)
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'hermes-test@example.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Hermes Test'], { cwd: dir })
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'tracked\n')
  execFileSync('git', ['add', 'tracked.txt'], { cwd: dir })
  execFileSync('git', ['commit', '-qm', 'initial'], { cwd: dir })

  return dir
}

test('resolveRenamePath: plain path is unchanged', () => {
  assert.equal(resolveRenamePath('src/a.ts'), 'src/a.ts')
})

test('gitFor accepts an internally resolved git binary path containing spaces', () => {
  assert.doesNotThrow(() => gitFor(process.cwd(), 'C:\\Program Files\\Git\\cmd\\git.exe'))
})

test('gitFor runs git through a spaced binary path', async () => {
  if (process.platform !== 'win32') {
    return
  }

  const gitBin = path.join(process.env.ProgramFiles || String.raw`C:\Program Files`, 'Git', 'cmd', 'git.exe')

  if (!fs.existsSync(gitBin)) {
    return
  }

  const repo = makeRepo()

  fs.writeFileSync(path.join(repo, 'changed.txt'), 'review me\n')

  const status = await gitFor(repo, gitBin).status()

  assert.equal(status.not_added.includes('changed.txt'), true)
})

test('resolveRenamePath: simple rename resolves to the new path', () => {
  assert.equal(resolveRenamePath('old.ts => new.ts'), 'new.ts')
})

test('resolveRenamePath: brace rename resolves to the new path', () => {
  assert.equal(resolveRenamePath('src/{old => new}/file.ts'), 'src/new/file.ts')
})

test('resolveRenamePath: brace rename collapsing a segment', () => {
  assert.equal(resolveRenamePath('src/{lib => }/file.ts'), 'src/file.ts')
})

test('repoStatus reports an untracked directory without recursively listing its contents', async () => {
  const dir = makeRepo()
  const nested = path.join(dir, 'generated', 'deep')

  fs.mkdirSync(nested, { recursive: true })
  fs.writeFileSync(path.join(nested, 'large-output.txt'), 'generated\n')

  const status = await repoStatus(dir, 'git')

  assert.ok(status)
  assert.equal(status.untracked, 1)
  assert.equal(status.changed, 1)
  assert.deepEqual(
    status.files.map(file => file.path),
    ['generated/']
  )
})

test('reviewList reports an untracked directory without recursively listing its contents', async () => {
  const dir = makeRepo()
  const nested = path.join(dir, 'browser-profile', 'Default', 'Cache')

  fs.mkdirSync(nested, { recursive: true })

  for (let i = 0; i < 20; i++) {
    fs.writeFileSync(path.join(nested, `cache-${i}.bin`), 'generated\n')
  }

  const result = await reviewList(dir, 'uncommitted', null, 'git')

  assert.deepEqual(
    result.files.map(file => file.path),
    ['browser-profile/']
  )
})

test('reviewStage treats a file path as a literal pathspec, not a glob', async () => {
  const dir = makeRepo()

  fs.writeFileSync(path.join(dir, 'a[bc].txt'), 'literal\n')
  fs.writeFileSync(path.join(dir, 'ab.txt'), 'glob-match\n')

  await reviewStage(dir, 'a[bc].txt', 'git')

  const status = await gitFor(dir, 'git').status()

  assert.deepEqual(status.staged, ['a[bc].txt'])
})

test('reviewUnstage treats a file path as a literal pathspec, not a glob', async () => {
  const dir = makeRepo()

  fs.writeFileSync(path.join(dir, 'a[bc].txt'), 'literal\n')
  fs.writeFileSync(path.join(dir, 'ab.txt'), 'glob-match\n')
  execFileSync('git', ['add', '-A'], { cwd: dir })

  await reviewUnstage(dir, 'a[bc].txt', 'git')

  const status = await gitFor(dir, 'git').status()

  assert.deepEqual(status.staged, ['ab.txt'])
})

test('reviewRevert restores only the literal file, not its glob matches', async () => {
  const dir = makeRepo()

  fs.writeFileSync(path.join(dir, 'a[bc].txt'), 'committed\n')
  fs.writeFileSync(path.join(dir, 'ab.txt'), 'committed\n')
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-qm', 'add both'], { cwd: dir })
  fs.writeFileSync(path.join(dir, 'a[bc].txt'), 'dirty\n')
  fs.writeFileSync(path.join(dir, 'ab.txt'), 'dirty\n')

  await reviewRevert(dir, 'a[bc].txt', 'git')

  assert.equal(fs.readFileSync(path.join(dir, 'a[bc].txt'), 'utf8'), 'committed\n')
  assert.equal(fs.readFileSync(path.join(dir, 'ab.txt'), 'utf8'), 'dirty\n')
})

test('reviewRevert removes an untracked literal-path file', async () => {
  const dir = makeRepo()

  fs.writeFileSync(path.join(dir, 'a[bc].txt'), 'untracked\n')
  fs.writeFileSync(path.join(dir, 'ab.txt'), 'keep\n')

  await reviewRevert(dir, 'a[bc].txt', 'git')

  assert.equal(fs.existsSync(path.join(dir, 'a[bc].txt')), false)
  assert.equal(fs.existsSync(path.join(dir, 'ab.txt')), true)
})

test('reviewRevert surfaces a checkout failure instead of swallowing it', async () => {
  const dir = makeRepo()

  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'dirty\n')

  // A git wrapper that fails `checkout` but delegates everything else, so the
  // revert hits a real checkout failure on a tracked file.
  const fakeGit = path.join(dir, 'failing-git')

  // simple-git may prepend `-c` flags, so match the subcommand anywhere — and
  // write to stderr: simple-git only rejects when the child reports an error.
  fs.writeFileSync(
    fakeGit,
    '#!/bin/sh\ncase " $* " in *" checkout "*) echo "fatal: checkout failed" >&2; exit 128;; esac\nexec git "$@"\n'
  )
  fs.chmodSync(fakeGit, 0o755)

  await assert.rejects(() => reviewRevert(dir, 'tracked.txt', fakeGit))
})

test('reviewList caps the file payload returned to the renderer', async () => {
  const dir = makeRepo()

  for (let i = 0; i < REVIEW_FILE_CAP + 10; i++) {
    fs.writeFileSync(path.join(dir, `untracked-${String(i).padStart(4, '0')}.txt`), 'generated\n')
  }

  const result = await reviewList(dir, 'uncommitted', null, 'git')

  assert.equal(result.files.length, REVIEW_FILE_CAP)
})
