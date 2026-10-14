import { setThemeCall } from '@/components/assistant-ui/theme-picker/args'
import { deliveryTargetFromCommand } from '@/components/assistant-ui/thread/agent-delivery'
import { toolLabels } from '@/lib/connector-tools'
import { isTodoToolName } from '@/lib/todos'
import { isCardTool, isCardToolName, isSilentTool } from '@/lib/tool-render-class'

export interface CoveredToolPart {
  toolName: string
  args?: unknown
  isError?: boolean
  result?: unknown
}

function extractTerminalCommand(args: unknown): string {
  if (typeof args === 'object' && args !== null && 'command' in args) {
    const command = (args as { command?: unknown }).command

    return typeof command === 'string' ? command : ''
  }

  return ''
}

type CoveredPredicate = (part: CoveredToolPart) => boolean

const EXCLUDED_PREDICATES: readonly CoveredPredicate[] = [
  part => isTodoToolName(part.toolName),
  part => part.toolName === 'terminal' && Boolean(deliveryTargetFromCommand(extractTerminalCommand(part.args))),
  part => part.toolName === 'react_to_message' && !part.isError,
  part => isCardTool(part.toolName) || isCardToolName(part.toolName),
  part => Boolean(setThemeCall(part.toolName, (typeof part.args === 'object' && part.args !== null ? part.args : {}) as never)),
  part => toolLabels(part.args as never).length > 0,
  part => isSilentTool(part.toolName)
]

/**
 * True for calls the tool activity card stack draws, false for everything
 * ChainToolFallback already renders some other way.
 */
export function coveredByToolCards(part: CoveredToolPart): boolean {
  for (const excluded of EXCLUDED_PREDICATES) {
    if (excluded(part)) {
      return false
    }
  }

  return true
}
