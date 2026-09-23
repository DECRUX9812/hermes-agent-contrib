import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CredentialKeyCard } from './credential-key-ui'
import { envVar } from './test-utils'

const DOCS_URL = 'https://platform.example.com/api-keys'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderExpandedCard(url = DOCS_URL) {
  return render(
    <CredentialKeyCard
      expanded
      info={envVar('models', { url })}
      label="Example"
      onExpand={() => undefined}
      onToggle={() => undefined}
      placeholder="Paste key"
      rowProps={{
        edits: {},
        onClear: () => undefined,
        onReveal: () => undefined,
        onSave: () => undefined,
        revealed: {},
        saving: null,
        setEdits: () => undefined
      }}
      varKey="EXAMPLE_API_KEY"
    />
  )
}

describe('CredentialKeyCard docs link', () => {
  it('opens the provider console in the OS browser via the desktop bridge', () => {
    const openExternal = vi.fn()
    vi.stubGlobal('hermesDesktop', { openExternal })
    Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { openExternal } })

    renderExpandedCard()

    fireEvent.click(screen.getByRole('link', { name: /get a key/i }))

    // setWindowOpenHandler denies every window.open (GHSA-9f4c-93c8-jc8g), so
    // a bare target=_blank click is a no-op — the link must go through the bridge.
    expect(openExternal).toHaveBeenCalledWith(DOCS_URL)
  })
})
