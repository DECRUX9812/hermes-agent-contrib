// Curated language allowlist for the lazily-loaded Shiki highlighter.
//
// WHY AN ALLOWLIST (`shiki` → `shiki/core`): importing `bundledLanguages` from
// the `shiki` root entry pulls the FULL bundled map — 242 grammar modules plus
// all 65 themes. Rolldown cannot tree-shake entries out of that map (each value
// is a `() => import()` thunk it must keep reachable), so every grammar ended
// up in the renderer's single 19.5 MB `shiki` chunk and the first rendered code
// block had to parse all of them. `shiki/core` has no bundled map at all: you
// hand it the grammars you want, and here each one is its own dynamic import so
// a fence only fetches the grammar it names.
//
// This module stays dependency-free (plain strings, no imports) so it can be
// reached from the entry graph — the streamdown code plugin needs
// `supportsLanguage()` on every message — without dragging Shiki along.
//
// A language NOT listed here still renders: `shiki-block` falls back to plain
// text, which is what an unsupported fence looked like before too (shiki's own
// unknown-language path). Adding a language is one line here plus one line in
// the `GRAMMARS` map in shiki-core.ts.

/** Canonical Shiki language ids we ship. Mirrors `SHIKI_LANGUAGE_BY_EXTENSION`
 *  in lib/markdown-code.ts plus the fences models actually emit. */
export const SHIKI_LANGUAGES = [
  'astro',
  'bash',
  'c',
  'clojure',
  'cpp',
  'csharp',
  'css',
  'dart',
  'diff',
  'docker',
  'elixir',
  'fish',
  'go',
  'graphql',
  'haskell',
  'hcl',
  'html',
  'ini',
  'java',
  'javascript',
  'json',
  'json5',
  'jsonc',
  'jsonl',
  'jsx',
  'julia',
  'kotlin',
  'latex',
  'less',
  'lua',
  'make',
  'markdown',
  'matlab',
  'mdx',
  'nginx',
  'nix',
  'objective-c',
  'ocaml',
  'perl',
  'php',
  'powershell',
  'prisma',
  'proto',
  'python',
  'r',
  'ruby',
  'rust',
  'sass',
  'scala',
  'scss',
  'shellscript',
  'solidity',
  'sql',
  'svelte',
  'swift',
  'systemd',
  'tcl',
  'terraform',
  'toml',
  'tsx',
  'typescript',
  'vb',
  'verilog',
  'viml',
  'vue',
  'wasm',
  'xml',
  'xsl',
  'yaml',
  'zig'
] as const

export type ShikiLanguage = (typeof SHIKI_LANGUAGES)[number]

const LANGUAGE_SET: ReadonlySet<string> = new Set(SHIKI_LANGUAGES)

/** Fence labels and Shiki aliases mapped onto an id we ship. A model writing
 *  ```sh or ```node gets colored output instead of a plain block. */
export const SHIKI_LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  'c#': 'csharp',
  'c++': 'cpp',
  'console': 'shellscript',
  'cs': 'csharp',
  'dockerfile': 'docker',
  'dotenv': 'ini',
  'env': 'ini',
  'htm': 'html',
  'js': 'javascript',
  'kt': 'kotlin',
  'kts': 'kotlin',
  'makefile': 'make',
  'md': 'markdown',
  'mts': 'typescript',
  'objc': 'objective-c',
  'perl6': 'perl',
  'proto3': 'proto',
  'ps1': 'powershell',
  'pwsh': 'powershell',
  'py': 'python',
  'pyi': 'python',
  'rb': 'ruby',
  'rs': 'rust',
  'scss': 'scss',
  'sh': 'bash',
  'shell': 'shellscript',
  'shell-session': 'shellscript',
  'terminal': 'shellscript',
  'tf': 'terraform',
  'ts': 'typescript',
  'vim': 'viml',
  'yml': 'yaml',
  'zsh': 'bash'
}

/** Shiki treats these as "no grammar": the block is emitted as plain text. */
const PLAIN_LANGUAGES: ReadonlySet<string> = new Set(['', 'text', 'txt', 'plain', 'plaintext', 'none'])

/**
 * Canonical Shiki id for a fence label, or `''` for "no grammar" (plain
 * text or a language we do not ship). Never throws — a fence label comes
 * straight from model output.
 */
export function resolveShikiLanguage(language: string | null | undefined): string {
  const raw = (language ?? '').trim().toLowerCase()

  if (PLAIN_LANGUAGES.has(raw)) {
    return ''
  }

  const id = SHIKI_LANGUAGE_ALIASES[raw] ?? raw

  return LANGUAGE_SET.has(id) ? id : ''
}

/** Whether a fence label can be highlighted at all (used by the streamdown
 *  code plugin before it promises tokens). */
export function isShikiLanguage(language: string | null | undefined): boolean {
  return resolveShikiLanguage(language) !== ''
}
