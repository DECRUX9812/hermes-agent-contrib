/**
 * Inline per-profile MCP setup: the `mcp.servers.*` RPC wrapper, its
 * feature-detect, and the button a capability row renders.
 *
 * Shared leaf: the advanced profile editor and the create dialog both render
 * the button, so it lives below both.
 */

import { Button, host, Input, type PluginProfileRoute, useI18n } from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'

import { useBots } from './i18n'

// -- inline MCP setup (per-profile), driven by the mcp.servers.* gateway RPCs --
// Feature-detected: if the gateway predates those RPCs the setup button hides
// and the row falls back to the "run hermes mcp / Settings" hint. profile is
// the target bot's profile name (its config is what we write).

/** Body of an `mcp.servers.*` reply. Some gateway builds wrap it in a second
 *  `result` envelope, which every call site below unwraps — hence the
 *  self-reference. */
interface McpServerPayload {
  auth_url?: string
  error?: string
  error_message?: string
  ok?: boolean
  result?: McpServerPayload
  session_id?: string
  status?: string
  verification_url?: string
}

/** `mcpRpc`'s outcome. `unsupported` separates an older gateway that doesn't
 *  know the method from a real failure. */
interface McpRpcResult {
  error?: string
  ok: boolean
  result?: McpServerPayload
  unsupported?: boolean
}

async function mcpRpc(
  method: string,
  params: Record<string, unknown>,
  route?: PluginProfileRoute | null
): Promise<McpRpcResult> {
  // Returns { ok, result } or { ok:false, unsupported:true } when the gateway
  // doesn't know the method (older backend) vs a real error. Source-scoped
  // bots dial their OWN connection's backend through the route descriptor —
  // a plain host.request would write the config onto this window's gateway
  // instead of the bot's.
  try {
    const res = await (route && typeof host.requestProfile === 'function'
      ? host.requestProfile<McpServerPayload>(route, method, params)
      : host.request<McpServerPayload>(method, params))

    return {
      ok: true,
      result: res
    }
  } catch (err: unknown) {
    const msg = String((err instanceof Error ? err.message : (err as { message?: string })?.message) || err || '')

    if (/unknown method/i.test(msg)) {
      return {
        ok: false,
        unsupported: true
      }
    }

    return {
      ok: false,
      error: msg
    }
  }
}

// Probe whether the new lifecycle RPCs exist on the target backend (cached per
// connection — a source-scoped bot's gateway may not match this window's).
const _mcpRpcSupported = new Map<string, boolean>()

async function mcpSetupSupported(route?: PluginProfileRoute | null): Promise<boolean> {
  const key = route?.connectionId || ''

  if (_mcpRpcSupported.has(key)) {
    return _mcpRpcSupported.get(key)!
  }

  const r = await mcpRpc('mcp.servers.list', {}, route)
  const ok = !(r.ok === false && r.unsupported)

  _mcpRpcSupported.set(key, ok)

  return ok
}

/** One row of the capability pane's MCP list (catalog entry or installed server). */
interface McpCatalogEntry {
  auth?: null | string
  fromCatalog?: boolean
  installed?: boolean
  name: string
  requires?: string[]
}

interface McpSetupButtonProps {
  ensureProfile?: () => Promise<null | string>
  entry: McpCatalogEntry
  onDone?: () => void
  /** The backend profile NAME the mcp.servers.* calls write to. Null on the
   *  New Bot pane until ensureProfile() materializes the draft profile. */
  profile: null | string | undefined
  /** The bot's connection route when it is source-scoped — routes the
   *  mcp.servers.* RPCs (and the OAuth scope) to its own backend. */
  route?: PluginProfileRoute | null
}

export function McpSetupButton({ profile, entry, onDone, ensureProfile, route }: McpSetupButtonProps) {
  const { t } = useI18n()
  const b = useBots()
  // entry: { name, requires:[env keys], auth?, fromCatalog, installed }
  // profile may be null at first (New Bot: the profile isn't created yet).
  // ensureProfile() lazily creates it on the first setup action and returns the
  // slug, so OAuth / API-key setup works DURING creation, not only in Edit.
  const [phase, setPhase] = useState<'busy' | 'done' | 'error' | 'idle' | 'keys' | 'oauth'>('idle') // idle | keys | oauth | busy | done | error
  const [supported, setSupported] = useState<boolean | null>(null)
  const [keyValues, setKeyValues] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const oauthEpoch = useRef(0)
  // Holds ONLY the profile this component created on demand. The live prop
  // wins wherever both exist, so there is nothing to mirror into the ref and
  // no render of lag between the parent supplying a profile and us using it.
  const createdProfileRef = useRef<null | string>(null)

  // Resolve the target profile, creating it on demand for the New Bot flow.
  const resolveProfile = async () => {
    const known = profile || createdProfileRef.current

    if (known) {
      return known
    }

    if (ensureProfile) {
      const created = await ensureProfile()

      if (created) {
        createdProfileRef.current = created
      }

      return created
    }

    return null
  }

  useEffect(() => {
    const epoch = oauthEpoch
    let alive = true
    mcpSetupSupported(route).then(ok => {
      if (alive) {
        setSupported(ok)
      }
    })

    return () => {
      alive = false

      epoch.current++
    }
  }, [route])
  const isOAuth = (entry.auth || '').toLowerCase() === 'oauth'
  const requires = entry.requires || []

  const beginKeys = async () => {
    // Ensure the server exists in the target profile first (add from catalog).
    setPhase('busy')
    setMessage('')
    const profile = await resolveProfile()

    if (!profile) {
      setPhase('idle')

      return
    }

    if (entry.fromCatalog && !entry.installed) {
      const add = await mcpRpc(
        'mcp.servers.add',
        {
          profile,
          name: entry.name,
          preset: entry.name
        },
        route
      )

      if (!add.ok) {
        setPhase('error')
        setMessage(add.error || b.tools.addServerFailed)

        return
      }
    }

    setPhase(isOAuth ? 'oauth' : 'keys')
  }

  const submitKeys = async () => {
    setPhase('busy')
    const target = profile || createdProfileRef.current

    if (!target) {
      setPhase('error')
      setMessage(b.tools.noTarget)

      return
    }

    for (const k of requires) {
      const val = (keyValues[k] || '').trim()

      if (!val) {
        continue
      }

      const r = await mcpRpc(
        'mcp.servers.set_api_key',
        {
          profile: target,
          name: entry.name,
          env_var: k,
          value: val
        },
        route
      )

      if (!r.ok) {
        setPhase('error')
        setMessage(r.error || b.tools.setKeyFailed(k))

        return
      }
    }

    // Verify via test.
    const t = await mcpRpc(
      'mcp.servers.test',
      {
        profile: target,
        name: entry.name
      },
      route
    )

    if (t.ok && t.result && (t.result.ok || (t.result.result && t.result.result.ok))) {
      setPhase('done')
      host.notify({
        kind: 'success',
        message: b.tools.configured(entry.name)
      })
      onDone && onDone()
    } else {
      setPhase('error')
      setMessage((t.result && (t.result.error || (t.result.result && t.result.result.error))) || b.tools.testFailed)
    }
  }

  const beginOAuth = async () => {
    const epoch = ++oauthEpoch.current

    setPhase('busy')
    setMessage('')
    const resolvedProfile = await resolveProfile()

    if (!resolvedProfile) {
      setPhase('idle')

      return
    }

    // The OAuth bridge wants a {connectionId, profile} scope: the bot's own
    // connection for a source-scoped route, this window's otherwise.
    const scope = {
      connectionId: route?.connectionId ?? host.state.connectionId.get(),
      profile: resolvedProfile || host.state.profile.get()
    }

    try {
      setPhase('oauth')
      setMessage(b.tools.completeSignIn)
      await host.completeMcpOAuth({
        serverName: entry.name,
        profile: scope,
        catalogPreset: entry.fromCatalog && !entry.installed ? entry.name : undefined,
        cancelled: () => oauthEpoch.current !== epoch
      })

      if (oauthEpoch.current !== epoch) {
        return
      }

      setPhase('done')
      host.notify({ kind: 'success', message: b.tools.authenticated(entry.name) })
      onDone?.()
    } catch (error) {
      if (oauthEpoch.current !== epoch) {
        return
      }

      setPhase('error')
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  if (supported === false) {
    return (
      <span className="ml-1.5 text-[0.65rem] text-(--ui-text-quaternary)">
        {b.tools.needsSetup(requires.join(', '))}
      </span>
    )
  }

  if (phase === 'done') {
    return <span className="ml-1.5 text-[0.65rem] text-(--ui-success)">{b.tools.setUpDone}</span>
  }

  if (phase === 'keys') {
    return (
      <div className="mt-1 grid gap-1">
        {requires.map(k => (
          <Input
            className="h-6 text-[0.7rem]"
            key={k}
            onChange={e =>
              setKeyValues(prev => ({
                ...prev,
                [k]: e.target.value
              }))
            }
            placeholder={k}
            type="password"
            value={keyValues[k] || ''}
          />
        ))}
        <div className="flex gap-1">
          <Button onClick={() => void submitKeys()} size="xs" variant="secondary">
            {b.tools.saveTest}
          </Button>
          <Button onClick={() => setPhase('idle')} size="xs" variant="ghost">
            {t.common.cancel}
          </Button>
        </div>
      </div>
    )
  }

  if (phase === 'oauth') {
    return <span className="ml-1.5 text-[0.65rem] text-(--ui-text-quaternary)">{message || b.tools.authorizing}</span>
  }

  if (phase === 'busy') {
    return <span className="ml-1.5 text-[0.65rem] text-(--ui-text-quaternary)">{b.tools.working}</span>
  }

  if (phase === 'error') {
    return (
      <span className="ml-1.5 text-[0.65rem] text-(--ui-danger,#f87171)">
        {(message || b.tools.setupFailed) + ' '}
        <Button className="underline" onClick={() => setPhase('idle')} size="inline" variant="link">
          {t.common.retry}
        </Button>
      </span>
    )
  }

  // idle
  return (
    <Button
      className="ml-1.5 text-[0.65rem] text-(--ui-accent) underline"
      onClick={() => void (isOAuth ? beginOAuth() : beginKeys())}
      size="inline"
      variant="link"
    >
      {isOAuth ? b.tools.signIn : b.tools.setUp}
    </Button>
  )
}
