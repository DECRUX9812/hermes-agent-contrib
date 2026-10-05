/**
 * The document an MCP App runs as: the server's HTML with a Content-Security-
 * Policy injected ahead of any of its own markup. The frame is `sandbox=
 * "allow-scripts"` (opaque origin, no parent access); the CSP bounds what the
 * app may load or talk to — default-deny, widened only by the domains the
 * resource declares in `_meta.ui.csp` (ext-apps: connectDomains,
 * resourceDomains, frameDomains). A declared domain must be an https origin
 * (a `*.` subdomain wildcard allowed); anything else is dropped, so a server
 * cannot smuggle directives through the list.
 */

const ORIGIN_RE = /^https:\/\/(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*(:\d{1,5})?$/i

export interface McpAppCsp {
  connectDomains?: unknown
  frameDomains?: unknown
  resourceDomains?: unknown
}

function origins(value: unknown): string[] {
  return (Array.isArray(value) ? value : [])
    .map(entry =>
      String(entry ?? '')
        .trim()
        .replace(/\/+$/, '')
    )
    .filter(entry => ORIGIN_RE.test(entry))
}

/** `_meta.ui.csp` of a `ui://` resource → a CSP header value. */
export function mcpAppCsp(csp: McpAppCsp | null | undefined): string {
  const resources = origins(csp?.resourceDomains)
  const connect = origins(csp?.connectDomains)
  const frames = origins(csp?.frameDomains)
  const src = (...extra: string[]) => [...extra, ...resources].join(' ')

  return [
    "default-src 'none'",
    `script-src ${src("'unsafe-inline'")}`,
    `style-src ${src("'unsafe-inline'")}`,
    `img-src ${src('data:', 'blob:')}`,
    `font-src ${src('data:')}`,
    `media-src ${src('data:', 'blob:')}`,
    `connect-src ${connect.length ? connect.join(' ') : "'none'"}`,
    `frame-src ${frames.length ? frames.join(' ') : "'none'"}`,
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
}

const escapeAttr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

/** The app HTML with the CSP meta as the first thing the parser sees — ahead
 *  of any markup (only a doctype may precede it), so no app script runs before
 *  the policy exists; the parser files a leading meta into the implicit head. */
export function composeMcpAppDocument(html: string, csp: McpAppCsp | null | undefined): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(mcpAppCsp(csp))}">`
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)

  return doctype ? doctype[0] + meta + html.slice(doctype[0].length) : `<!doctype html>${meta}${html}`
}
