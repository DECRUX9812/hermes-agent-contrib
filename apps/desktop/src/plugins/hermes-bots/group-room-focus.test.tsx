import type * as HermesSdk from '@hermes/plugin-sdk'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { translateBots } from './i18n-test-helper'

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return { ...sdk, usePluginI18n: () => translateBots }
})

const { GroupComposerContext } = await import('./group-room-focus')

afterEach(cleanup)

it('says the lead answers when a lead is named', () => {
  render(<GroupComposerContext leadName="Ada" />)

  expect(screen.getByTestId('group-composer-context').textContent).toContain('Ada')
})

it('says everyone hears it when no lead is named', () => {
  render(<GroupComposerContext leadName="" />)

  expect(screen.getByTestId('group-composer-context').textContent).toContain('everyone hears it')
})
