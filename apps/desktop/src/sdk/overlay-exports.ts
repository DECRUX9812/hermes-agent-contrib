/**
 * Plugin SDK exports (names and plugin areas) this overlay adds on top of stock Hermes.
 *
 * They live here rather than in `./index` so upstream edits to the SDK barrel
 * never collide with them: `./index` re-exports this module in one line
 * (`export * from './overlay-exports'`), and the names reach plugins through
 * `@hermes/plugin-sdk` exactly as if they were declared there.
 */
import { host, type PluginOpenSessionOptions } from './index'

/** Top-level `openSession` — the SAME function as `host.openSession`.
 *
 *  The runtime plugin shim re-exports a namespace's own keys
 *  (`sdk/runtime.ts` builds `export const { … } = m` from
 *  `Object.keys(__HERMES_PLUGIN_SDK__)`), so a member reachable only as
 *  `host.openSession` is NOT a named export. Plugin code that does
 *  `import { openSession } from '@hermes/plugin-sdk'` then fails at link time
 *  ("does not provide an export named 'openSession'") and the whole plugin
 *  vanishes. Alias it here rather than duplicating the implementation.
 *  `host` is read at call time, so the import cycle with `./index` is safe. */
export const openSession = (storedSessionId: string, options?: PluginOpenSessionOptions): Promise<void> =>
  host.openSession(storedSessionId, options)

/** Top-level `navigate` — the SAME function as `host.navigate`, re-exported
 *  for the same reason as `openSession` (`import { navigate } from
 *  '@hermes/plugin-sdk'`). */
export const navigate = (path: string): void => host.navigate(path)

/** The inline approval card core's composer mounts, for plugin surfaces that show pending approvals. */
export { ApprovalCard, type ApprovalCardProps, type ApprovalDecision } from '@/components/assistant-ui/tool/approval'
/** Draw a Bot Chat's plain tool activity runs (reads, commands, browser
 *  steps) in place of core's rows. Core picks the calls; you draw them. */
export {
  isPlainToolActivity,
  TOOL_RUN_RENDERER_AREA,
  type ToolRunPart,
  type ToolRunRendererContribution,
  type ToolRunRendererProps
} from '@/components/assistant-ui/tool/fallback'
/** Tool-run renderer building blocks: the tool view model core's rows read,
 *  a media loader that resolves backend image paths, and the side preview. */
export {
  buildToolView,
  compactPreview,
  findFirstUrl,
  parseMaybeObject,
  stableHash,
  type ToolPart,
  type ToolView
} from '@/components/assistant-ui/tool/fallback-model'
/** Under the empty-chat intro: starter prompts, first-run cards. Every
 *  registration mounts; make clickable content `pointer-events-auto`. */
export { CHAT_INTRO_AREA } from '@/components/chat/intro'
/** A site's favicon with a fallback while it loads or when it has none. */
export { Favicon } from '@/components/ui/favicon'
/** The icon a tool's rows use, by tool icon name. */
export { ToolIcon } from '@/components/ui/tool-icon'
export { useMediaImage } from '@/hooks/use-media-image'
export { hostPathLabel } from '@/lib/external-link'
export { openPreview } from '@/store/preview'
export { stripAnsi } from '@hermes/shared/ansi'
