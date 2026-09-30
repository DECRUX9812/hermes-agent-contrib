import { describe, expect, it, vi } from 'vitest'

import { createMcpAppBridge, JSON_RPC_INVALID_PARAMS, JSON_RPC_METHOD_NOT_FOUND, type JsonRpcMessage } from './bridge'
import { composeMcpAppDocument, mcpAppCsp } from './document'

function harness() {
  const posted: JsonRpcMessage[] = []

  const deps = {
    callTool: vi.fn(async (name: string) => ({ content: [{ text: `ran ${name}`, type: 'text' }] })),
    draftMessage: vi.fn(),
    hostContext: () => ({ displayMode: 'inline', theme: 'dark' }),
    offerLink: vi.fn(),
    onInitialized: vi.fn(),
    onSize: vi.fn()
  }

  return { bridge: createMcpAppBridge(deps, message => posted.push(message)), deps, posted }
}

describe('MCP App bridge', () => {
  it('answers ui/initialize with the host context and routes tools/call to the app server', async () => {
    const { bridge, deps, posted } = harness()

    await bridge.receive({ id: 1, jsonrpc: '2.0', method: 'ui/initialize', params: {} })
    await bridge.receive({ id: 2, jsonrpc: '2.0', method: 'tools/call', params: { arguments: { n: 1 }, name: 'increment' } })
    await bridge.receive({ jsonrpc: '2.0', method: 'ui/notifications/initialized' })

    expect(posted[0].result).toMatchObject({ hostContext: { theme: 'dark' } })
    expect(deps.callTool).toHaveBeenCalledWith('increment', { n: 1 })
    expect(posted[1]).toEqual({ id: 2, jsonrpc: '2.0', result: { content: [{ text: 'ran increment', type: 'text' }] } })
    expect(deps.onInitialized).toHaveBeenCalledOnce()
  })

  it('never acts on the app’s behalf: links are offered, messages are drafted, not sent', async () => {
    const { bridge, deps, posted } = harness()

    await bridge.receive({ id: 1, method: 'ui/open-link', params: { url: 'https://example.com/a' } })
    await bridge.receive({ id: 2, method: 'ui/open-link', params: { url: 'file:///etc/passwd' } })
    await bridge.receive({ id: 3, method: 'ui/message', params: { content: [{ text: 'Plan my trip', type: 'text' }], role: 'user' } })

    expect(deps.offerLink).toHaveBeenCalledExactlyOnceWith('https://example.com/a')
    expect(posted[1].error?.code).toBe(JSON_RPC_INVALID_PARAMS)
    expect(deps.draftMessage).toHaveBeenCalledWith('Plan my trip')
  })

  it('refuses unknown requests and ignores unknown notifications', async () => {
    const { bridge, posted } = harness()

    await bridge.receive({ id: 9, method: 'ui/update-model-context', params: {} })
    await bridge.receive({ method: 'something/else' })

    expect(posted).toEqual([
      { error: { code: JSON_RPC_METHOD_NOT_FOUND, message: 'ui/update-model-context is not supported' }, id: 9, jsonrpc: '2.0' }
    ])
  })
})

describe('MCP App document', () => {
  it('is default-deny and admits only declared https origins', () => {
    const csp = mcpAppCsp({
      connectDomains: ['https://api.example.com', "https://x.com; script-src *", 'http://insecure.example'],
      resourceDomains: ['https://*.cdn.example.com']
    })

    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain('connect-src https://api.example.com;')
    expect(csp).toContain('script-src ' + "'unsafe-inline' https://*.cdn.example.com")
    expect(csp).not.toContain('insecure')
    expect(csp).not.toContain('script-src *')
    expect(mcpAppCsp(undefined)).toContain("connect-src 'none'")
  })

  it('puts the policy ahead of every script the app ships', () => {
    const doc = composeMcpAppDocument('<!DOCTYPE html><script>steal()</script><head></head>', {})

    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<script>'))
    expect(composeMcpAppDocument('<p>hi</p>', {})).toMatch(/^<!doctype html><meta http-equiv="Content-Security-Policy"/)
  })
})
