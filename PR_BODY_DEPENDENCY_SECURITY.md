## What does this PR do?

Removes all six npm high-severity findings reported by a clean root `npm ci` on current main.

The fixes are deliberately narrow:

- Electron `40.10.2` → `41.10.6`
  - fixes the sandboxed-iframe OpenURL bypass ([GHSA-9f4c-93c8-jc8g](https://github.com/advisories/GHSA-9f4c-93c8-jc8g));
  - fixes the custom-protocol session-cache issue ([GHSA-r4w5-6pfg-jxp5](https://github.com/advisories/GHSA-r4w5-6pfg-jxp5));
  - replaces vulnerable `extract-zip@2.0.1` ([GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv)) with `@electron-internal/extract-zip@1.0.5`.
- `nanoid@^3` override `3.3.17` → `3.3.18`, fixing [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8).
- `postcss` override `8.5.23` → `8.5.26`, deduplicating the fixed nanoid chain used through Vite and sanitize-html.

Electron 41.10.6 was published on 2026-08-18, so `.npmrc` temporarily exempts only `electron` from the 14-day minimum-release-age gate. The comment carries the removal condition. No blanket age-gate relaxation is introduced.

## Related Issue

No existing issue found. No matching open PR was present when this branch was prepared.

## Type of Change

- [x] 🐛 Bug fix
- [ ] ✨ New feature
- [x] 🔒 Security fix
- [ ] 📝 Documentation update
- [ ] ✅ Tests-only change
- [ ] ♻️ Refactor
- [ ] 🎯 New skill

## Changes Made

- `.npmrc`
  - Adds a temporary, package-scoped security-release exception for Electron 41.10.6.
- `apps/desktop/package.json`
  - Pins both the development runtime and electron-builder runtime to Electron 41.10.6.
- `package.json`
  - Keeps `allowScripts` aligned with the exact Electron pin.
  - Updates the nanoid 3.x and postcss security overrides.
- `package-lock.json`
  - Removes vulnerable Electron 40 / extract-zip / nanoid 3.3.17 / postcss 8.5.23 nodes.
  - Adds only the Electron 41 dependency chain and deduplicated fixed postcss/nanoid nodes; no unrelated package versions drifted.

## How to Test

```bash
npm ci
npm audit
cd apps/desktop
npm run typecheck
npm run lint
npm run test:ui
npm run test:desktop:platforms
npm run check:test:plugins
npm run test:desktop:all
```

Observed on Linux/X11:

- `npm ci`: **0 vulnerabilities**
- `npm audit`: **0 vulnerabilities**
- UI: **570 files / 5,468 tests passed**
- Electron platform: **112 files passed, 1 skipped / 1,598 tests passed, 3 skipped**
- Bundled plugins: **411 passed**
- Typecheck: passed
- ESLint: **0 errors**; 117 existing warnings
- Production build + unpacked package: passed
- electron-builder packaged with `electron=41.10.6`
- Isolated packaged Electron 41 app launched and rendered provider onboarding under X11

## Checklist

### Code

- [x] I've read the Contributing Guide
- [x] Commit messages follow Conventional Commits
- [x] I searched for existing PRs
- [x] This PR contains only dependency-security changes
- [x] Relevant JS/desktop tests pass
- [x] Tested on Linux/X11

### Documentation & Housekeeping

- [x] User docs — N/A; no user-facing setting
- [x] Config examples — N/A
- [x] Architecture docs — N/A
- [x] Cross-platform impact considered; builder runtime pin is aligned for every target
- [x] Tool schemas — N/A

## Screenshots / Logs

The packaged Electron 41 renderer was launched from `release/linux-unpacked/Hermes` against a throwaway `HERMES_HOME`; provider onboarding rendered successfully. Automated package/build tests remain the primary evidence.
