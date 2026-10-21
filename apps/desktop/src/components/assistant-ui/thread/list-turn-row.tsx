import { ThreadPrimitive } from '@assistant-ui/react'
import { type ComponentProps, memo } from 'react'

import { cn } from '@/lib/utils'

import { MessageRenderBoundary } from '../message-render-boundary'

import type { MessageGroup } from './list-groups'
import { ResponseMessages } from './response-group'

export type ThreadMessageComponents = ComponentProps<typeof ThreadPrimitive.MessageByIndex>['components']

interface TurnRowProps {
  components: ThreadMessageComponents
  group: MessageGroup
  resetKey: string
  virtualized: boolean
}

// One turn (or standalone message) of the transcript. memo() is the point:
// the rows array below is REBUILT whenever the DOM budget's cut advances
// (hiddenCount changes its slice), and without per-row bail-out that rebuild
// re-rendered every mounted turn — markdown, code cards, tool blocks — in one
// synchronous frame, a 100-800ms stall once a second on a streaming long
// session. With memo, a rebuild re-renders only rows whose props changed:
// the dropped head row unmounts, the virtualization boundary rows flip their
// flag, and everything else bails on identical group/resetKey identity.
//
// content-visibility:auto (virtualized rows) — off-screen turns skip style
// recalc, layout, and paint. On a long transcript this is what keeps
// UNRELATED UI fast: any dialog/popover mount (Radix Presence reads
// getComputedStyle) forces a whole-document style recalc, measured
// ~650-730ms per open on a 1300-message session and ~100-200ms with this
// on. contain-intrinsic-size keeps a placeholder height for never-rendered
// turns (auto: remembered real size once rendered), so scrollbar/anchoring
// stay stable. Sticky human bubbles are unaffected — their turn is rendered
// whenever any part of it intersects the viewport.
//
// The live tail (newest turns) is exempt: virtualizing a turn whose final
// size hasn't been remembered yet snaps it to a stale height when it scrolls
// off, drifting stick-to-bottom up over old turns. See liveTailStart.
export const TurnRow = memo(function TurnRow({ components, group, resetKey, virtualized }: TurnRowProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-(--conversation-turn-gap) pb-(--conversation-turn-gap)',
        virtualized && '[contain-intrinsic-size:auto_37.5rem] [content-visibility:auto]'
      )}
      data-slot="aui_message-group"
    >
      <MessageRenderBoundary resetKey={resetKey}>
        {group.kind === 'turn' ? (
          <div
            className="composer-human-ai-pair-container relative flex min-w-0 flex-col gap-(--conversation-turn-gap)"
            data-slot="aui_turn-pair"
          >
            <ResponseMessages components={components} indices={group.indices} />
          </div>
        ) : (
          <ThreadPrimitive.MessageByIndex components={components} index={group.index} />
        )}
      </MessageRenderBoundary>
    </div>
  )
})
