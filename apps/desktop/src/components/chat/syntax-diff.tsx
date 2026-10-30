'use client'

/**
 * The Shiki-highlighted compact diff body, split out of diff-lines.tsx so the
 * highlighter loads lazily on first use instead of on the cold-start path.
 * diff-lines.tsx reaches this through `React.lazy` with a plain `DiffBody`
 * fallback.
 *
 * It used to render through `react-shiki`, whose `useShikiHighlighter` reads
 * `bundledLanguages` from the `shiki` root entry — which made all 242 grammars
 * and 65 themes reachable from the renderer. It now goes through shiki-core's
 * allowlist, so this chunk loads one grammar rather than the bundled set.
 */
import { useEffect, useMemo, useState } from 'react'

import { DiffBody, type DiffLine, diffLineTransformer } from '@/components/chat/diff-lines'
import { SHIKI_COLOR_REPLACEMENTS, SHIKI_THEME } from '@/components/chat/shiki-config'
import { shikiCodeToHtml } from '@/components/chat/shiki-core'

/** Same content-addressed cache the code blocks use, so a diff that leaves and
 *  returns to the viewport is not re-tokenized. Local rather than shared: the
 *  keys carry transformers that only this renderer knows about. */
const HTML_CACHE_LIMIT = 100
const htmlCache = new Map<string, string>()

function cacheGet(key: string): string | undefined {
  const hit = htmlCache.get(key)

  if (hit !== undefined) {
    // Refresh recency: Map preserves insertion order.
    htmlCache.delete(key)
    htmlCache.set(key, hit)
  }

  return hit
}

function cacheSet(key: string, value: string): void {
  htmlCache.set(key, value)

  if (htmlCache.size > HTML_CACHE_LIMIT) {
    const oldest = htmlCache.keys().next().value

    if (oldest !== undefined) {
      htmlCache.delete(oldest)
    }
  }
}

export default function SyntaxDiff({ language, lines }: { language: string; lines: DiffLine[] }) {
  const code = useMemo(() => lines.map(line => line.text).join('\n'), [lines])
  const kinds = useMemo(() => lines.map(line => line.kind), [lines])
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const key = `${language}\u0000${kinds.join('')}\u0000${code}`
    const cached = cacheGet(key)

    if (cached !== undefined) {
      setHtml(cached)

      return
    }

    void shikiCodeToHtml({
      code,
      language,
      theme: SHIKI_THEME,
      colorReplacements: SHIKI_COLOR_REPLACEMENTS,
      transformers: [diffLineTransformer(kinds)]
    })
      .then(result => {
        cacheSet(key, result)

        if (!cancelled) {
          setHtml(result)
        }
      })
      .catch(() => {
        // Keep the plain diff rather than blanking the block.
        if (!cancelled) {
          setHtml(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [code, kinds, language])

  // Until Shiki resolves, show the plain colored diff so there's no flash.
  if (html === null) {
    return <DiffBody lines={lines} />
  }

  return <div className="rs-root not-prose" dangerouslySetInnerHTML={{ __html: html }} />
}
