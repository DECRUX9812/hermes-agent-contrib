#!/usr/bin/env node
// Fail on new hardcoded English user-facing strings in the Bot Mode plugin.
//
// Three polish rounds found the same bug by hand: an English literal shipped in
// a UI that is otherwise translated. A regex can't see this reliably — it trips
// on `Promise<…>` in generic text and on identifiers — so this gate parses with
// the TypeScript compiler and looks at the AST instead:
//
//   1. JSX text nodes (`<button>Back</button>`, including text that spans
//      lines: a line that is just `Back` between tags is still a text node).
//   2. `host.notify({ message: '…' })` / `host.notify({ title: '…' })` /
//      `host.notifyError(err, '…')` literals. A toast's title is copy the
//      reader sees, so it is gated alongside the message.
//   3. `placeholder="…"` / `title="…"` / `aria-label="…"` literals.
//
// Everything it finds belongs in the plugin's own catalog (`./i18n.ts`, reach it
// with `useBots()` in a component and `botsText()` at module scope — the
// hook-free translator, required outside React). The allowlist below is for
// literals that are legitimately not translated, and every entry says why.
//
// Scope is deliberately one plugin: a repo-wide gate gets noisy and gets
// disabled. Run with no arguments to scan the whole plugin, or pass file paths
// (what the pre-commit job does) to scan just those.
//
// What v1 does NOT see, by design (keep the gate honest, not noisy): string
// literals inside JSX expression containers (`{'…'}`), ternaries or other
// dynamic expressions in an attribute, and template literals with
// substitutions. Those are dynamic copy by construction; extend the rules only
// with a false-positive story in hand.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'

import ts from 'typescript'

const HEREDIR = import.meta.dirname
const DESKTOP_ROOT = resolve(HEREDIR, '..')
const REPO_ROOT = resolve(DESKTOP_ROOT, '../..')
const PLUGIN_DIR = join(DESKTOP_ROOT, 'src/plugins/hermes-bots')

/** JSX attributes whose value is shown to the reader (or read to them). */
const USER_FACING_ATTRIBUTES = new Set(['placeholder', 'title', 'aria-label'])

/**
 * Literals that are legitimately not translated. Keep this list short: every
 * entry is a promise that the literal is not reader-facing prose.
 *
 * `file` is the path relative to the plugin directory; `kind` is which rule
 * matched; `text` is the exact trimmed literal.
 */
export const ALLOWLIST = [
  {
    file: 'create-dialog.tsx',
    kind: 'attribute',
    text: 'inbox-triage',
    // The NAME field's example: a slug's shape (lowercase, hyphenated) is the
    // thing being demonstrated. Translating it would teach a name that no
    // longer slugifies the way the field does.
    reason: 'example slug, not prose'
  },
  {
    file: 'cron.tsx',
    kind: 'attribute',
    text: 'every 1d · every 2h · 0 9 * * * (cron)',
    // The advanced-schedule field's placeholder is parser INPUT, not prose:
    // `every 1d` is the scheduler's own syntax and `0 9 * * *` is a crontab.
    // Translating the words would show a schedule the parser rejects.
    reason: 'cron syntax example'
  },
  {
    file: 'model-picker.tsx',
    kind: 'attribute',
    text: 'omnirouter / 9router / nous …',
    // Provider ids are machine identifiers the user pastes verbatim. A
    // translated provider name does not resolve to a provider.
    reason: 'provider id examples'
  },
  {
    file: 'model-picker.tsx',
    kind: 'attribute',
    text: 'omnirouter / inferx / 9router',
    // Same rule as above, in the free-text picker: provider ids, not words.
    reason: 'provider id examples'
  },
  {
    file: 'model-picker.tsx',
    kind: 'attribute',
    text: 'antigravity/gemini-3.6-flash-high',
    // A `provider/model` id, likewise a value rather than copy.
    reason: 'model id example'
  }
]

function allowed(finding) {
  return ALLOWLIST.some(
    entry => entry.file === finding.file && entry.kind === finding.kind && entry.text === finding.text
  )
}

function listSourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full))
      continue
    }
    if (!entry.isFile()) continue
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue
    // Tests assert on literals and render fixtures; they are not shipped UI.
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) continue
    out.push(full)
  }
  return out.sort()
}

function parse(file) {
  const text = readFileSync(file, 'utf8')
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, /* setParentNodes */ true, kind)
}

const LETTER = /[A-Za-z]/
// `&times;`, `&amp;`, `&#8230;`: entities carry no words of their own.
const ENTITY = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi

/** Normalized copy for a literal, or null when it has no words (whitespace,
 *  separators like `·`, punctuation, bare entities, numbers). */
function copyOf(raw) {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text || !LETTER.test(text.replace(ENTITY, ''))) return null
  return text
}

/** `host.notify(…)`, `host.notifyError(…)`, and their optional-chained forms. */
function notifyKind(call) {
  const callee = call.expression
  if (!ts.isPropertyAccessExpression(callee)) return null
  if (!ts.isIdentifier(callee.expression) || callee.expression.text !== 'host') return null
  const name = callee.name.text
  return name === 'notify' || name === 'notifyError' ? name : null
}

/** A literal the reader ends up seeing: plain string, or a template with no
 *  substitutions (`` `Back` ``). Interpolated copy is dynamic and out of scope. */
function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return null
}

function scanFile(file) {
  const sourceFile = parse(file)
  const pluginPath = relative(PLUGIN_DIR, file).split(sep).join('/')
  const findings = []

  const report = (kind, node, text, detail) => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    findings.push({ file: pluginPath, line: line + 1, column: character + 1, kind, text, detail })
  }

  const visit = node => {
    if (ts.isJsxText(node)) {
      // Report the whole text node so a multi-line run of copy is one finding.
      const copy = copyOf(node.text)
      if (copy) report('jsx-text', node, copy, 'JSX text')
    } else if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && USER_FACING_ATTRIBUTES.has(node.name.text)) {
      const init = node.initializer
      if (!init) return
      const text = ts.isStringLiteral(init)
        ? init.text
        : ts.isJsxExpression(init) && init.expression
          ? literalText(init.expression)
          : null
      const copy = text && copyOf(text)
      if (copy) report('attribute', init, text, `${node.name.text} attribute`)
    } else if (ts.isCallExpression(node)) {
      const kind = notifyKind(node)
      if (kind === 'notify') {
        const arg = node.arguments[0]
        if (arg && ts.isObjectLiteralExpression(arg)) {
          for (const property of arg.properties) {
            if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue
            const field = property.name.text
            // `title` and `message` are the toast's visible lines; `kind`,
            // `detail`, and `action` are not prose authored here.
            if (field !== 'message' && field !== 'title') continue
            const text = literalText(property.initializer)
            const copy = text && copyOf(text)
            if (copy) report('notify', property.initializer, text, `host.notify ${field}`)
          }
        }
      } else if (kind === 'notifyError' && node.arguments.length > 1) {
        const text = literalText(node.arguments[1])
        const copy = text && copyOf(text)
        if (copy) report('notify', node.arguments[1], text, 'host.notifyError message')
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return findings
}

const USAGE = `Usage: node scripts/i18n-bots-literals.mjs [files…]

Scans apps/desktop/src/plugins/hermes-bots/ for hardcoded user-facing English:
JSX text, host.notify/notifyError message and title literals, and
placeholder/title/aria-label literals. With no arguments it scans the whole
plugin; pass paths to scan only those (the pre-commit job passes the staged
files). Exits 1 on any finding that is not in the allowlist in this file.`

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE)
    return 0
  }

  const args = argv.filter(arg => !arg.startsWith('-'))
  const files = args.length ? args.map(resolveInput).filter(Boolean) : listSourceFiles(PLUGIN_DIR)

  const findings = files
    .flatMap(scanFile)
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column)

  const allowlisted = findings.filter(allowed)
  const reported = findings.filter(finding => !allowed(finding))

  for (const finding of reported) {
    console.log(
      `${join('apps/desktop/src/plugins/hermes-bots', finding.file)}:${finding.line}:${finding.column}  ` +
        `${finding.detail}: "${finding.text}"`
    )
  }

  if (reported.length) {
    console.error(
      `\n${reported.length} hardcoded user-facing literal${reported.length === 1 ? '' : 's'} in Bot Mode. ` +
        'Move each into ./i18n.ts (all four locales: en, ja, zh, zh-hant) and read it with ' +
        '`useBots()` in a component or `botsText()` at module scope.\n' +
        'If a literal is genuinely not translated (a slug, a brand, an identifier), add it to ' +
        'ALLOWLIST in apps/desktop/scripts/i18n-bots-literals.mjs with the why.'
    )

    return 1
  }

  console.log(
    `i18n bots literals: clean (${files.length} file${files.length === 1 ? '' : 's'} scanned` +
      `${allowlisted.length ? `, ${allowlisted.length} allowlisted` : ''})`
  )
  return 0
}

/** File arguments arrive from lefthook relative to apps/desktop (`./src/…`),
 *  but hand runs start at the repo root. Accept either, and drop anything that
 *  is not a source file in the plugin (deleted paths, test files, other
 *  workspaces). */
function resolveInput(arg) {
  const found = [resolve(process.cwd(), arg), resolve(DESKTOP_ROOT, arg), resolve(REPO_ROOT, arg)].find(candidate =>
    existsSync(candidate)
  )
  if (!found) return null
  const pluginRelative = relative(PLUGIN_DIR, found)
  if (pluginRelative.startsWith('..') || pluginRelative.includes(`..${sep}`)) return null
  if (basename(found).endsWith('.test.ts') || basename(found).endsWith('.test.tsx')) return null
  return found
}

if (!existsSync(PLUGIN_DIR)) {
  console.error(`i18n bots literals: plugin directory not found: ${PLUGIN_DIR}`)
  process.exit(1)
}

process.exit(main(process.argv.slice(2)))
