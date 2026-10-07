import { describe, expect, it } from 'vitest'

import { paneFrameloop } from './frameloop'

describe('paneFrameloop', () => {
  it('renders continuously only while an avatar is out or a chart is turning', () => {
    expect(paneFrameloop({ anyAvatarVisible: true, chartPresented: false, documentHidden: false })).toBe('always')
    expect(paneFrameloop({ anyAvatarVisible: false, chartPresented: true, documentHidden: false })).toBe('always')
    expect(paneFrameloop({ anyAvatarVisible: false, chartPresented: false, documentHidden: false })).toBe('demand')
  })

  it('stops rendering outright while the document is hidden, whatever is on screen', () => {
    expect(paneFrameloop({ anyAvatarVisible: true, chartPresented: true, documentHidden: true })).toBe('never')
    expect(paneFrameloop({ anyAvatarVisible: false, chartPresented: false, documentHidden: true })).toBe('never')
  })
})
