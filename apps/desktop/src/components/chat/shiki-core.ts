// The one module that owns Shiki's runtime in the renderer.
//
// Everything here is reached only through a dynamic import (the `shiki-block`
// chunk, the diff tokenizer below, the streamdown code plugin), so Shiki stays
// off the cold-start path. It is deliberately NOT imported statically from the
// entry graph.
//
// It uses `shiki/core` rather than the `shiki` root entry. The root entry
// re-exports `bundledLanguages` / `bundledThemes`, maps of 242 grammars and 65
// themes held as `() => import()` thunks; referencing that map forces the
// bundler to keep every one of them reachable, which is how the renderer grew a
// single 19.5 MB `shiki` chunk that every first code block had to parse.
// `shiki/core` carries no bundled map: grammars and themes arrive one at a time
// from the explicit maps below, so a fence fetches its own grammar (~10–80 KB)
// and nothing else.
import { createHighlighterCore, type HighlighterCore, type LanguageInput, type ShikiTransformer } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'

import { SHIKI_THEME } from '@/components/chat/shiki-config'
import { resolveShikiLanguage } from '@/components/chat/shiki-languages'

/**
 * Grammar loaders, one dynamic import each. Keyed by the canonical ids in
 * `SHIKI_LANGUAGES` — keep the two in step (a missing entry here means the
 * language resolves but never loads, and rendering falls back to plain text).
 */
const GRAMMARS = {
  astro: () => import('shiki/dist/langs/astro.mjs'),
  bash: () => import('shiki/dist/langs/bash.mjs'),
  c: () => import('shiki/dist/langs/c.mjs'),
  clojure: () => import('shiki/dist/langs/clojure.mjs'),
  cpp: () => import('shiki/dist/langs/cpp.mjs'),
  csharp: () => import('shiki/dist/langs/csharp.mjs'),
  css: () => import('shiki/dist/langs/css.mjs'),
  dart: () => import('shiki/dist/langs/dart.mjs'),
  diff: () => import('shiki/dist/langs/diff.mjs'),
  docker: () => import('shiki/dist/langs/docker.mjs'),
  elixir: () => import('shiki/dist/langs/elixir.mjs'),
  fish: () => import('shiki/dist/langs/fish.mjs'),
  go: () => import('shiki/dist/langs/go.mjs'),
  graphql: () => import('shiki/dist/langs/graphql.mjs'),
  haskell: () => import('shiki/dist/langs/haskell.mjs'),
  hcl: () => import('shiki/dist/langs/hcl.mjs'),
  html: () => import('shiki/dist/langs/html.mjs'),
  ini: () => import('shiki/dist/langs/ini.mjs'),
  java: () => import('shiki/dist/langs/java.mjs'),
  javascript: () => import('shiki/dist/langs/javascript.mjs'),
  json: () => import('shiki/dist/langs/json.mjs'),
  json5: () => import('shiki/dist/langs/json5.mjs'),
  jsonc: () => import('shiki/dist/langs/jsonc.mjs'),
  jsonl: () => import('shiki/dist/langs/jsonl.mjs'),
  jsx: () => import('shiki/dist/langs/jsx.mjs'),
  julia: () => import('shiki/dist/langs/julia.mjs'),
  kotlin: () => import('shiki/dist/langs/kotlin.mjs'),
  latex: () => import('shiki/dist/langs/latex.mjs'),
  less: () => import('shiki/dist/langs/less.mjs'),
  lua: () => import('shiki/dist/langs/lua.mjs'),
  make: () => import('shiki/dist/langs/make.mjs'),
  markdown: () => import('shiki/dist/langs/markdown.mjs'),
  matlab: () => import('shiki/dist/langs/matlab.mjs'),
  mdx: () => import('shiki/dist/langs/mdx.mjs'),
  nginx: () => import('shiki/dist/langs/nginx.mjs'),
  nix: () => import('shiki/dist/langs/nix.mjs'),
  'objective-c': () => import('shiki/dist/langs/objective-c.mjs'),
  ocaml: () => import('shiki/dist/langs/ocaml.mjs'),
  perl: () => import('shiki/dist/langs/perl.mjs'),
  php: () => import('shiki/dist/langs/php.mjs'),
  powershell: () => import('shiki/dist/langs/powershell.mjs'),
  prisma: () => import('shiki/dist/langs/prisma.mjs'),
  proto: () => import('shiki/dist/langs/proto.mjs'),
  python: () => import('shiki/dist/langs/python.mjs'),
  r: () => import('shiki/dist/langs/r.mjs'),
  ruby: () => import('shiki/dist/langs/ruby.mjs'),
  rust: () => import('shiki/dist/langs/rust.mjs'),
  sass: () => import('shiki/dist/langs/sass.mjs'),
  scala: () => import('shiki/dist/langs/scala.mjs'),
  scss: () => import('shiki/dist/langs/scss.mjs'),
  shellscript: () => import('shiki/dist/langs/shellscript.mjs'),
  solidity: () => import('shiki/dist/langs/solidity.mjs'),
  sql: () => import('shiki/dist/langs/sql.mjs'),
  svelte: () => import('shiki/dist/langs/svelte.mjs'),
  swift: () => import('shiki/dist/langs/swift.mjs'),
  systemd: () => import('shiki/dist/langs/systemd.mjs'),
  tcl: () => import('shiki/dist/langs/tcl.mjs'),
  terraform: () => import('shiki/dist/langs/terraform.mjs'),
  toml: () => import('shiki/dist/langs/toml.mjs'),
  tsx: () => import('shiki/dist/langs/tsx.mjs'),
  typescript: () => import('shiki/dist/langs/typescript.mjs'),
  vb: () => import('shiki/dist/langs/vb.mjs'),
  verilog: () => import('shiki/dist/langs/verilog.mjs'),
  viml: () => import('shiki/dist/langs/viml.mjs'),
  vue: () => import('shiki/dist/langs/vue.mjs'),
  wasm: () => import('shiki/dist/langs/wasm.mjs'),
  xml: () => import('shiki/dist/langs/xml.mjs'),
  xsl: () => import('shiki/dist/langs/xsl.mjs'),
  yaml: () => import('shiki/dist/langs/yaml.mjs'),
  zig: () => import('shiki/dist/langs/zig.mjs')
} satisfies Record<string, () => Promise<{ default: LanguageInput }>>

type GrammarId = keyof typeof GRAMMARS

/**
 * Themes. The renderer uses exactly one pair (see shiki-config.ts); a request
 * for anything else falls back to the matching half of that pair rather than
 * pulling another theme module.
 */
const THEMES = {
  [SHIKI_THEME.dark]: () => import('shiki/dist/themes/github-dark-dimmed.mjs'),
  [SHIKI_THEME.light]: () => import('shiki/dist/themes/github-light-default.mjs')
}

type ThemeName = keyof typeof THEMES

function themeEntry(name: string): ThemeName {
  if (name in THEMES) {
    return name as ThemeName
  }

  return name.includes('light') ? SHIKI_THEME.light : SHIKI_THEME.dark
}

let highlighterPromise: Promise<HighlighterCore> | null = null
const loading = new Map<string, Promise<void>>()

/**
 * The shared highlighter. Created with no grammars (the first block's grammar
 * is loaded straight after) and both themes, so the common path costs one
 * engine + wasm + one grammar instead of the whole bundled set.
 */
export function getShikiHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    langs: [],
    themes: Object.values(THEMES).map(loader => loader().then(module => module.default)),
    engine: createOnigurumaEngine(import('shiki/wasm'))
  })

  return highlighterPromise
}

/** Resolves once `language`'s grammar is in the highlighter; no-op for plain
 *  text or a language we do not ship. Concurrent callers share one import. */
async function ensureLanguage(highlighter: HighlighterCore, language: string): Promise<string> {
  const id = resolveShikiLanguage(language)

  if (id === '') {
    return ''
  }

  if (highlighter.getLoadedLanguages().includes(id)) {
    return id
  }

  let pending = loading.get(id)

  if (!pending) {
    pending = (async () => {
      const loader = GRAMMARS[id as GrammarId]
      const grammar = await loader()

      await highlighter.loadLanguage(grammar.default)
    })()
    loading.set(id, pending)
  }

  try {
    await pending
  } catch (error) {
    loading.delete(id)
    throw error
  }

  return highlighter.getLoadedLanguages().includes(id) ? id : ''
}

export interface ShikiHtmlOptions {
  code: string
  language: string
  theme?: { dark: string; light: string }
  colorReplacements?: Record<string, Record<string, string>>
  transformers?: ShikiTransformer[]
}

/** One fence to themed HTML. Throws only when the highlighter itself cannot
 *  start; callers degrade to plain text. */
export async function shikiCodeToHtml({
  code,
  language,
  theme = SHIKI_THEME,
  colorReplacements,
  transformers
}: ShikiHtmlOptions): Promise<string> {
  const highlighter = await getShikiHighlighter()
  const lang = await ensureLanguage(highlighter, language)

  return highlighter.codeToHtml(code, {
    // `text` is a special language in Shiki — always accepted, no grammar read.
    lang: lang || 'text',
    themes: { dark: themeEntry(theme.dark), light: themeEntry(theme.light) },
    defaultColor: 'light-dark()',
    colorReplacements
  })
}

export interface ShikiTokensOptions {
  code: string
  language: string
  theme: string
}

/** One diff body to themed tokens (single theme — the diff renderer follows
 *  the document color-scheme rather than emitting both variants). Shiki's
 *  token path takes no transformers, so callers that need them (the diff
 *  tint) go through `shikiCodeToHtml`. */
export async function shikiCodeToTokens({ code, language, theme }: ShikiTokensOptions) {
  const highlighter = await getShikiHighlighter()
  const lang = await ensureLanguage(highlighter, language)

  if (lang === '') {
    return null
  }

  return highlighter.codeToTokens(code, {
    lang,
    theme: themeEntry(theme)
  })
}

export interface ShikiThemedTokensOptions {
  code: string
  language: string
  /** `[light, dark]`, matching Streamdown's `HighlightOptions.themes` order. */
  themes: [string, string]
}

/** Both color variants in one pass, for the Streamdown code plugin's token
 *  contract. */
export async function shikiCodeToThemedTokens({ code, language, themes }: ShikiThemedTokensOptions) {
  const highlighter = await getShikiHighlighter()
  const lang = await ensureLanguage(highlighter, language)

  if (lang === '') {
    return null
  }

  return highlighter.codeToTokens(code, {
    lang,
    themes: { light: themeEntry(themes[0]), dark: themeEntry(themes[1]) }
  })
}
