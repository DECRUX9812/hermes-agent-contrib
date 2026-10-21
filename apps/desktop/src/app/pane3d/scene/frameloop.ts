import type { FrameloopMode } from '../director/store'

/**
 * The pane's frame-loop mode (architecture §8.4, VAL-CROSS-004).
 *
 * Rendering is continuous ONLY while something is actually on screen — an
 * avatar that is out, or a chart that is turning. A hidden document pauses it
 * outright, whatever is on screen: a backgrounded pane must not burn a software
 * GL context. Pure and three-free so the rule is provable without a canvas.
 */
export function paneFrameloop(input: {
  anyAvatarVisible: boolean
  chartPresented: boolean
  documentHidden: boolean
}): FrameloopMode {
  if (input.documentHidden) {
    return 'never'
  }

  return input.anyAvatarVisible || input.chartPresented ? 'always' : 'demand'
}
