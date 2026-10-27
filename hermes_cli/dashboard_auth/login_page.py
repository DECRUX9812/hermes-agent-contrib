"""Server-rendered /login page (no React, no SPA bundle, no injected token).

Providers come from the registry; an OAuth provider renders an anchor to
``/auth/login?provider=<name>``, a ``supports_password`` provider renders a
credential form wired by :data:`_PASSWORD_FORM_SCRIPT`. Styling mirrors the
``@nous-research/ui`` design system; fonts load from the SPA's ``/fonts/``
mount, which the gate allowlists pre-auth.

The ``class="provider-btn"`` anchor is test-stable: the suite extracts its
href to walk the OAuth flow.
"""
from __future__ import annotations

import html
from urllib.parse import quote, urlencode

from hermes_cli.dashboard_auth import list_session_providers

_PAPER_HEAD = """\
<style>
  /* Shared design tokens. Same names and values as the app: the colours are
     Warm Paper (apps/desktop/src/themes/paper.ts, the default skin) and the
     radius/motion roles come from apps/desktop/src/design/tokens.css.
     light-dark() follows the OS; the password page's script also applies
     the scheme chosen in the app. Drift is caught by
     tests/hermes_cli/test_login_page_tokens.py. */
  :root {
    color-scheme: light dark;
    --dt-background: light-dark(#f6f3ee, #17161a);
    --dt-foreground: light-dark(#26231e, #ece9e2);
    --dt-card: light-dark(#fbfaf7, #1c1b20);
    --dt-muted-foreground: light-dark(#6b665c, #a7a399);
    --dt-primary: light-dark(#4a5bd0, #8d9bff);
    --dt-primary-foreground: light-dark(#ffffff, #17161a);
    --dt-accent: light-dark(#e9ecfb, #2a2d4d);
    --dt-accent-foreground: light-dark(#2c3560, #dfe3ff);
    --dt-border: light-dark(#e7e2d9, #2c2b32);
    --dt-input: light-dark(#d6cfc2, #3a3943);
    --dt-ring: light-dark(#5b6ee1, #8d9bff);
    --dt-destructive: light-dark(#bd4139, #e0776f);
    --dt-shadow-color: light-dark(rgb(38 35 30 / 16%), transparent);
    --dt-shadow: 0 12px 32px -16px var(--dt-shadow-color);
    --radius-control: 0.375rem;
    --radius-card: 0.625rem;
    --dur-fast: 120ms;
    --ease-standard: cubic-bezier(0.2, 0, 0, 1);
    --ds-focus-ring: 0 0 0 2px var(--dt-card), 0 0 0 4px color-mix(in srgb, var(--dt-ring) 55%, transparent);
    --dt-font-sans: "Inter", "Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  }
  :root[data-theme="light"] { color-scheme: light; }
  :root[data-theme="dark"] { color-scheme: dark; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    min-height: 100%;
    background: var(--dt-background);
    color: var(--dt-foreground);
    font-family: var(--dt-font-sans);
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  body {
    font-size: 0.875rem;
    display: grid;
    place-items: center;
    padding: clamp(1.5rem, 6vh, 6rem) 1rem;
  }
  .card {
    padding: 2rem 1.5rem 1.5rem;
    background: var(--dt-card);
    border: 1px solid var(--dt-border);
    border-radius: var(--radius-card);
    box-shadow: var(--dt-shadow);
  }
  h1 {
    margin: 0 0 0.25rem;
    font-weight: 600;
    font-size: 1.25rem;
    line-height: 1.75rem;
    letter-spacing: -0.01em;
  }
  a { color: var(--dt-primary); }
  ::selection { background: var(--dt-accent); color: var(--dt-accent-foreground); }
</style>
"""

# Single curly braces are ``str.format`` placeholders; CSS curlies are doubled.
_LOGIN_HTML_TEMPLATE = """\
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in — Hermes Agent</title>
@@PAPER_HEAD@@
<style>
  /* Brand fonts shipped by @nous-research/ui — same files the SPA loads. */
  @font-face {{
    font-family: 'Collapse';
    font-style: normal;
    font-weight: 400;
    font-display: swap;
    src: url('/fonts/Collapse-Regular.woff2') format('woff2');
  }}
  @font-face {{
    font-family: 'Collapse';
    font-style: normal;
    font-weight: 700;
    font-display: swap;
    src: url('/fonts/Collapse-Bold.woff2') format('woff2');
  }}
  @font-face {{
    font-family: 'Rules Compressed';
    font-style: normal;
    font-weight: 400;
    font-display: swap;
    src: url('/fonts/RulesCompressed-Regular.woff2') format('woff2');
  }}
  @font-face {{
    font-family: 'Rules Compressed';
    font-style: normal;
    font-weight: 600;
    font-display: swap;
    src: url('/fonts/RulesCompressed-Medium.woff2') format('woff2');
  }}

  main {{
    width: 100%;
    max-width: 22.5rem;
    position: relative;
    animation: slide-up 180ms var(--ease-standard) both;
  }}

  @keyframes slide-up {{
    from {{ opacity: 0; transform: translateY(6px); }}
    to   {{ opacity: 1; transform: translateY(0); }}
  }}

  @media (prefers-reduced-motion: reduce) {{
    main {{ animation: none; }}
  }}

  .brand {{
    text-align: center;
    margin-bottom: 1.25rem;
    font-weight: 600;
    font-size: 1rem;
  }}
  .brand .dot {{
    display: inline-block;
    width: 6px;
    height: 6px;
    background: var(--dt-primary);
    margin: 0 0.4em 0.15em;
    vertical-align: middle;
    border-radius: 50%;
  }}

  .subtitle {{
    margin: 0 0 1.5rem;
    color: var(--dt-muted-foreground);
    font-size: 0.8125rem;
    line-height: 1.25rem;
  }}

  .provider-list {{
    display: grid;
    gap: 0.75rem;
  }}

  .provider-btn {{
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 2.25rem;
    padding: 0 1rem;
    background: var(--dt-primary);
    color: var(--dt-primary-foreground);
    font: inherit;
    font-weight: 500;
    text-decoration: none;
    border: 0;
    border-radius: var(--radius-control);
    cursor: pointer;
    transition: background-color var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard);
  }}
  .provider-btn:hover {{
    background: color-mix(in srgb, var(--dt-primary) 88%, var(--dt-foreground));
  }}
  .provider-btn:active {{
    transform: scale(0.98);
  }}
  .provider-btn:disabled {{
    opacity: 0.6;
    cursor: default;
  }}
  .provider-btn:focus-visible, .field-input:focus-visible {{
    outline: none;
    box-shadow: var(--ds-focus-ring);
  }}

  .provider-form {{
    display: grid;
    gap: 0.85rem;
    text-align: left;
  }}
  .form-title {{
    font-weight: 500;
    margin-bottom: 0.125rem;
  }}
  .field {{
    display: grid;
    gap: 0.35rem;
  }}
  .field-label {{
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--dt-muted-foreground);
  }}
  .field-input {{
    width: 100%;
    height: 2.25rem;
    padding: 0 0.75rem;
    background: var(--dt-background);
    color: var(--dt-foreground);
    border: 1px solid var(--dt-input);
    border-radius: var(--radius-control);
    font: inherit;
    transition: border-color var(--dur-fast) var(--ease-standard);
  }}
  .field-input:focus-visible {{
    border-color: var(--dt-ring);
  }}
  .form-error {{
    color: var(--dt-destructive);
    font-size: 0.8125rem;
  }}
  .provider-form .provider-btn {{
    margin-top: 0.5rem;
  }}

  footer {{
    margin-top: 1.25rem;
    text-align: center;
    color: var(--dt-muted-foreground);
    font-size: 0.75rem;
  }}
</style>
</head>
<body>
<main>
  <div class="brand">Hermes<span class="dot"></span>Desktop</div>
  <div class="card">
    <h1>Sign in</h1>
    <p class="subtitle">Enter your credentials to continue to Hermes Desktop.</p>
    <div class="provider-list">
{provider_buttons}
    </div>
  </div>
  <footer>
    Signed-in session required
  </footer>
</main>
{password_script}
</body>
</html>
"""

_LOGIN_HTML_TEMPLATE = _LOGIN_HTML_TEMPLATE.replace(
    "@@PAPER_HEAD@@", _PAPER_HEAD.replace("{", "{{").replace("}", "}}"))

_EMPTY_HTML = """\
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign-in unavailable — Hermes Agent</title>
@@PAPER_HEAD@@
<style>
  @font-face {
    font-family: 'Collapse';
    font-style: normal;
    font-weight: 400;
    font-display: swap;
    src: url('/fonts/Collapse-Regular.woff2') format('woff2');
  }
  @font-face {
    font-family: 'Rules Compressed';
    font-style: normal;
    font-weight: 600;
    font-display: swap;
    src: url('/fonts/RulesCompressed-Medium.woff2') format('woff2');
  }
  main { width: 100%; max-width: 28rem; }
  p { margin: 0 0 1rem; color: var(--dt-muted-foreground); }
  p:last-child { margin-bottom: 0; }
  code {
    background: var(--dt-accent);
    color: var(--dt-accent-foreground);
    padding: 0.125em 0.375em;
    border-radius: var(--radius-control);
    font-size: 0.875em;
  }
</style>
</head>
<body>
<main class="card">
<h1>Sign-in unavailable</h1>
<p>This dashboard is bound to a non-loopback host but no authentication
providers are available.</p>
<p>Configure the bundled username/password provider or an OAuth provider.
See the <a href="https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard#authentication-gated-mode">dashboard
authentication documentation</a> for setup instructions.</p>
<p>For auth-free local use, bind to <code>127.0.0.1</code> and connect through
an SSH tunnel or Tailscale.</p>
</main>
</body>
</html>
""".replace("@@PAPER_HEAD@@", _PAPER_HEAD)


# Emitted ONLY when a ``supports_password`` provider is listed, so OAuth-only
# login pages stay script-free. Plain string (not ``str.format``): braces are
# literal. One delegated submit handler covers every form; the provider name
# comes from the form's ``data-provider`` attribute.
#
# Reverse-proxy prefix support: the script reads ``data-prefix`` from the
# ``<main>`` element (set by :func:`render_login_html`) and prepends it
# to the POST target and the post-login landing path so the login flow
# works behind ``X-Forwarded-Prefix`` proxies.
_PASSWORD_FORM_SCRIPT = """\
<script>
(function () {
  try {
    var scheme = localStorage.getItem('hermes-boot-color-scheme') || localStorage.getItem('theme');
    if (scheme === 'dark' || scheme === 'light') document.documentElement.setAttribute('data-theme', scheme);
  } catch (e) {}
  var mainEl = document.querySelector('main');
  var prefix = (mainEl && mainEl.getAttribute('data-prefix')) || '';
  function handle(form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var err = form.querySelector('.form-error');
      var btn = form.querySelector('button[type=submit]');
      if (err) { err.hidden = true; err.textContent = ''; }
      if (btn) { btn.disabled = true; }
      var body = {
        provider: form.getAttribute('data-provider') || '',
        username: (form.querySelector('input[name=username]') || {}).value || '',
        password: (form.querySelector('input[name=password]') || {}).value || '',
        next: (form.querySelector('input[name=next]') || {}).value || ''
      };
      fetch(prefix + '/auth/password-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'same-origin'
      }).then(function (resp) {
        if (resp.ok) {
          return resp.json().then(function (data) {
            window.location.assign((data && data.next) || (prefix + '/'));
          });
        }
        var msg = resp.status === 429
          ? 'Too many attempts. Please wait and try again.'
          : (resp.status === 401 ? 'Invalid username or password.'
                                 : 'Sign-in failed. Please try again.');
        if (err) { err.textContent = msg; err.hidden = false; }
        if (btn) { btn.disabled = false; }
      }).catch(function () {
        if (err) { err.textContent = 'Network error. Please try again.'; err.hidden = false; }
        if (btn) { btn.disabled = false; }
      });
    });
  }
  var forms = document.querySelectorAll('form.provider-form');
  for (var i = 0; i < forms.length; i++) { handle(forms[i]); }
})();
</script>
"""


def render_login_html(*, next_path: str = "", prefix: str = "") -> str:
    """Return the full HTML for ``GET /login``.

    ``next_path`` is threaded into each provider button/form so the OAuth round
    trip carries it end-to-end. The caller validates it same-origin; it is
    HTML-escaped here as defence in depth.

    ``prefix`` — when set, the path prefix from ``X-Forwarded-Prefix``
    (e.g. ``"/hermes"``). Prepended to all auth URLs so the login page
    works behind a reverse proxy that mounts the dashboard at a
    sub-path. Empty string (default) means no prefix — bare-root
    deploys are unaffected.
    """
    providers = list_session_providers()
    if not providers:
        return _EMPTY_HTML
    # URL-encode then HTML-escape, matching the gate's ``_safe_next_target``
    # shape so a round-tripped value is byte-identical.
    next_qs = f"&next={html.escape(quote(next_path, safe=''), quote=True)}" if next_path else ""
    buttons = [
        _render_password_form(p, next_path, prefix=prefix)
        if getattr(p, "supports_password", False) else
        f'      <a class="provider-btn" '
        f'href="{prefix}/auth/login?provider={html.escape(p.name, quote=True)}{next_qs}">'
        f'Sign in with {html.escape(p.display_name)}</a>'
        for p in providers
    ]
    needs_password_script = any(getattr(p, "supports_password", False) for p in providers)
    html_out = _LOGIN_HTML_TEMPLATE.format(
        provider_buttons="\n".join(buttons),
        password_script=_PASSWORD_FORM_SCRIPT if needs_password_script else "",
    )
    # Inject the reverse-proxy prefix so the password-login JS can read
    # it from the <main> element's data attribute, and rewrite the font
    # URLs to stay inside the mount.  ``str.replace`` after ``str.format``
    # avoids interfering with the CSS ``{{ }}`` doubling in the template.
    return _apply_proxy_prefix(html_out, prefix)


def _apply_proxy_prefix(html_out: str, prefix: str) -> str:
    """Rewrite a rendered login-family page for a reverse-proxy sub-path.

    Two rewrites, both no-ops when *prefix* is empty (bare-root deploys are
    byte-for-byte unaffected):

    * ``<main>`` gains ``data-prefix`` so the password-login JS (a plain
      string, never ``str.format``-aware) can prepend the prefix to its
      fetch target and post-login landing.
    * ``@font-face`` ``url('/fonts/...')`` becomes ``url('<prefix>/fonts/...')``
      so the fonts load from the mount instead of the origin root (404
      behind a prefix-stripping proxy).
    """
    if not prefix:
        return html_out
    html_out = html_out.replace("<main>", f'<main data-prefix="{prefix}">', 1)
    html_out = html_out.replace("url('/fonts/", f"url('{prefix}/fonts/")
    return html_out


def render_native_provider_choice_html(
        *, providers, authorize_path: str, code_challenge: str,
        code_challenge_method: str, redirect_uri: str, state: str,
        prefix: str = "") -> str:
    """Provider picker for a native authorize request with more than one interactive provider.

    Every link re-enters ``/auth/native/authorize`` with the SAME desktop PKCE inputs plus an
    explicit ``provider``, so the choice never leaves the validated native flow. ``prefix``
    (from ``X-Forwarded-Prefix``) rewrites the template's font URLs so the page works behind
    a reverse-proxy sub-path; the buttons' ``authorize_path`` is already prefixed by the caller.
    """
    common = {"code_challenge": code_challenge, "code_challenge_method": code_challenge_method,
              "redirect_uri": redirect_uri, "state": state}
    buttons = []
    for p in providers:
        href = html.escape(f"{authorize_path}?{urlencode({**common, 'provider': p.name})}",
                           quote=True)
        buttons.append(f'      <a class="provider-btn" href="{href}">'
                       f'Sign in with {html.escape(p.display_name)}</a>')
    if not buttons:
        return _EMPTY_HTML
    return _apply_proxy_prefix(
        _LOGIN_HTML_TEMPLATE.format(
            provider_buttons="\n".join(buttons), password_script=""),
        prefix)


def _render_password_form(provider, next_path: str, *, prefix: str = "") -> str:
    """Username/password form for a ``supports_password`` provider.

    ``next_path`` rides in a hidden field (already validated by the caller,
    HTML-escaped here). The provider name is a ``data-`` attribute so the
    script does not depend on field ordering.

    ``prefix`` — reverse-proxy path prefix (e.g. ``"/hermes"``); kept for
    interface parity with the other renderers (the submit handler reads
    the prefix from ``<main data-prefix>``).
    """
    pname = html.escape(provider.name, quote=True)
    plabel = html.escape(provider.display_name)
    safe_next = html.escape(next_path, quote=True) if next_path else ""
    return (
        f'      <form class="provider-form" data-provider="{pname}" '
        f'autocomplete="on">\n'
        f'        <div class="form-title">Sign in with {plabel}</div>\n'
        f'        <input type="hidden" name="next" value="{safe_next}">\n'
        f'        <label class="field">\n'
        f'          <span class="field-label">Username</span>\n'
        f'          <input class="field-input" type="text" name="username" '
        f'autocomplete="username" autocapitalize="none" '
        f'autocorrect="off" spellcheck="false" required>\n'
        f'        </label>\n'
        f'        <label class="field">\n'
        f'          <span class="field-label">Password</span>\n'
        f'          <input class="field-input" type="password" name="password" '
        f'autocomplete="current-password" required>\n'
        f'        </label>\n'
        f'        <div class="form-error" role="alert" hidden></div>\n'
        f'        <button class="provider-btn" type="submit">Sign in</button>\n'
        f'      </form>'
    )
