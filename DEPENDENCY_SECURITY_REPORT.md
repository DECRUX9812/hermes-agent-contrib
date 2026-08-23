# npm High-Severity Advisory Closure

## Baseline

A clean root `npm ci` on upstream main reported six high-severity findings:

- Electron sandboxed-iframe OpenURL bypass (`GHSA-9f4c-93c8-jc8g`)
- Electron custom-protocol session-cache issue (`GHSA-r4w5-6pfg-jxp5`)
- `extract-zip` symlink traversal (`GHSA-jmr9-qjv8-65gv`)
- `nanoid` zero-size generator loop (`GHSA-2v37-7h3g-55p8`)
- aggregate `postcss`, `sanitize-html`, and Vite paths caused by the vulnerable nanoid node

## Prepared fix

```text
worktree: /home/decrux/Code/hermes-dependency-security-pr
branch: fix/npm-high-severity-advisories
commit: c687836fec
base: origin/main
```

Changes:

- Electron `40.10.2` → `41.10.6`
- `extract-zip@2.0.1` → `@electron-internal/extract-zip@1.0.5` through Electron 41
- nanoid 3.x override `3.3.17` → `3.3.18`
- postcss override `8.5.23` → `8.5.26`
- temporary minimum-release-age exception scoped only to Electron 41.10.6
- removal of the now-expired nanoid age-gate exception

The lockfile package graph has 9 added nodes and 13 removed nodes, all belonging to the Electron/extract-zip or postcss/nanoid replacement chains. No unrelated package version changed.

## Verification

- Fresh `npm ci`: 0 vulnerabilities
- `npm audit`: 0 vulnerabilities
- UI: 570 files / 5,468 tests passed
- Electron platform: 112 files passed, 1 skipped / 1,598 tests passed, 3 skipped
- Bundled plugins: 411 passed
- Typecheck: passed
- ESLint: 0 errors; 117 existing warnings
- Production build: passed
- Unpacked package: passed with `electron=41.10.6`
- Isolated packaged Electron 41 launch: provider onboarding rendered successfully on Linux/X11
- Added-line static security scan: no secret, shell-injection, eval/exec, unsafe-HTML, or unpinned-git matches

## Publishing constraint

The existing GitHub token lacks `workflow` scope, so any branch based on current upstream main is rejected when pushed to the stale fork because upstream history includes workflow updates. The fix remains local and patch-ready until `gh auth login --web --scopes repo,workflow` is completed.

Patch artifact:

```text
artifacts/0001-fix-deps-clear-high-severity-npm-advisories.patch
SHA-256 d2c89f367cd4bd80ca14f0cf2550987358c7cbcc6c3fc974bfc164d3ed1d6f12
```
