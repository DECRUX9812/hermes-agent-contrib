import { cleanup, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { ContribRender } from '@/contrib/react/boundary'
import { registry } from '@/contrib/registry'

import { useStatusbarContributions } from './panes'

describe('useStatusbarContributions', () => {
  afterEach(cleanup)

  it('keeps mapped items reference-stable across parent re-renders (no remount)', () => {
    let mounts = 0

    function Stateful() {
      useEffect(() => {
        mounts += 1
      }, [])
      return <span>plugin item</span>
    }

    const dispose = registry.register({
      id: 'test-plugin-statusbar',
      area: 'statusBar.left',
      source: 'plugin:test',
      render: () => <Stateful />
    })
    try {
      const seen: Array<readonly unknown[]> = []

      function Host({ tick }: { tick: number }) {
        void tick
        const items = useStatusbarContributions('left')
        seen.push(items)
        // Mirror the real consumer: statusbar-controls mounts each item's
        // render fn through ContribRender (createElement(render)).
        return (
          <>
            {items.map(item => (item.render ? <ContribRender key={item.id} render={item.render} /> : null))}
          </>
        )
      }

      function Parent({ tick }: { tick: number }) {
        return (
          <div>
            <span>{tick}</span>
            <Host tick={tick} />
          </div>
        )
      }

      const { rerender } = render(<Parent tick={0} />)
      expect(mounts).toBe(1)

      rerender(<Parent tick={1} />)
      rerender(<Parent tick={2} />)

      expect(seen.length).toBeGreaterThanOrEqual(3)
      const first = seen[0]
      for (const batch of seen) {
        expect(batch.length).toBe(first.length)
        batch.forEach((item, i) => expect(item).toBe(first[i]))
      }
      expect(mounts).toBe(1)
    } finally {
      dispose()
    }
  })
})
