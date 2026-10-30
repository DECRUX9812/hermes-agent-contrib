/**
 * Streamdown's code-highlighter plugin, implemented locally.
 *
 * Streamdown needs a `CodeHighlighterPlugin` in its plugin table to parse a
 * fence as a code block (`supportsLanguage` drives the per-language deciders),
 * and the obvious candidate — `@streamdown/code` — imports `bundledLanguages`
 * from the `shiki` root entry. That map holds all 242 grammars as thunks, so
 * referencing it kept every grammar reachable and welded them into one 19.5 MB
 * chunk. Worse, this plugin is fetched as soon as a message mounts, so the
 * cost landed on the first reply rather than the first code block.
 *
 * This implementation answers `supportsLanguage` / `getSupportedLanguages` /
 * `getThemes` from the allowlist alone — no Shiki import on the module — and
 * only reaches for the highlighter inside `highlight()`, which our own
 * `SyntaxHighlighter` override never calls. The Shiki chunk therefore loads
 * for a rendered fence, not for a rendered message.
 */
import type { CodeHighlighterPlugin } from '@assistant-ui/react-streamdown'
import type { HighlightOptions, ThemeInput } from 'streamdown'

import { SHIKI_THEME } from '@/components/chat/shiki-config'
import type * as ShikiCore from '@/components/chat/shiki-core'
import { resolveShikiLanguage, SHIKI_LANGUAGES } from '@/components/chat/shiki-languages'

/** Shiki's `TokensResult` is structurally Streamdown's `HighlightResult`, which
 *  Streamdown declares but does not export. Restated here (content/color/
 *  bgColor/offset/htmlStyle/htmlAttrs) so the two cannot drift silently: the
 *  `as HighlightResult` cast in `highlight` fails to compile if shiki's shape
 *  changes. */
interface HighlightToken {
  bgColor?: string
  color?: string
  content: string
  htmlAttrs?: Record<string, string>
  htmlStyle?: Record<string, string>
  offset?: number
}

interface HighlightResult {
  bg?: string
  fg?: string
  rootStyle?: string | false
  tokens: HighlightToken[][]
}

type HighlightCallback = (result: HighlightResult) => void

/** `[light, dark]`, matching `HighlightOptions.themes`. */
const THEMES: [ThemeInput, ThemeInput] = [SHIKI_THEME.light, SHIKI_THEME.dark]

let corePromise: Promise<typeof ShikiCore> | null = null

function loadCore() {
  corePromise ??= import('@/components/chat/shiki-core')

  return corePromise
}

/** Bounded result cache: a streaming message re-highlights the same fence on
 *  every flush, and re-tokenizing it each time is the cost this avoids. */
const RESULT_LIMIT = 200
const results = new Map<string, HighlightResult>()
const waiting = new Map<string, Set<HighlightCallback>>()

function themeName(theme: ThemeInput): string {
  return typeof theme === 'string' ? theme : SHIKI_THEME.dark
}

function remember(key: string, result: HighlightResult): void {
  results.set(key, result)

  if (results.size > RESULT_LIMIT) {
    const oldest = results.keys().next().value

    if (oldest !== undefined) {
      results.delete(oldest)
    }
  }
}

export const shikiCodePlugin: CodeHighlighterPlugin = {
  name: 'shiki',
  type: 'code-highlighter',
  getSupportedLanguages: () => [...SHIKI_LANGUAGES],
  supportsLanguage: language => resolveShikiLanguage(language) !== '',
  getThemes: () => THEMES,
  highlight(options: HighlightOptions, callback?: (result: HighlightResult) => void): HighlightResult | null {
    const language = resolveShikiLanguage(options.language)

    // No grammar (plain text or a language we do not ship): let Streamdown take
    // its own non-highlighted path, exactly as Shiki's unsupported-language
    // branch did.
    if (language === '') {
      return null
    }

    const themes: [string, string] = [themeName(options.themes[0]), themeName(options.themes[1])]
    const key = `${language}\u0000${themes[0]}\u0000${themes[1]}\u0000${options.code}`
    const cached = results.get(key)

    if (cached) {
      return cached
    }

    if (!callback) {
      return null
    }

    // Coalesce: several renders of the same fence while its grammar loads share
    // one tokenize pass.
    const listeners = waiting.get(key)

    if (listeners) {
      listeners.add(callback)

      return null
    }

    waiting.set(key, new Set([callback]))

    void loadCore()
      .then(core => core.shikiCodeToThemedTokens({ code: options.code, language, themes }))
      .then(tokens => {
        if (!tokens) {
          return
        }

        const result = tokens as HighlightResult

        remember(key, result)
        waiting.get(key)?.forEach(listener => listener(result))
      })
      .catch(error => {
        console.error('[hermes] shiki highlight failed; leaving the block unhighlighted', error)
      })
      .finally(() => waiting.delete(key))

    return null
  }
}
