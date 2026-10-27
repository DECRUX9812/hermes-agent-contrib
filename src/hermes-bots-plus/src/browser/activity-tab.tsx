/**
 * "Show me": a bot's browsing, followed in a browser tab. The tool card in the
 * chat publishes what it shows (steps, statuses, screenshots) and this tab
 * renders the same run large, following the latest step live until the user
 * picks one. From here the user can open the page in their own tab or watch
 * (and take over) the bot's real screen.
 */

import { Button, Codicon, Tip, useValue } from '@hermes/plugin-sdk'
import { useContext, useEffect, useRef } from 'react'

import { useBrowserBackend } from '../browser-backend'
import { useCardBot } from '../card-bot'
import { $botMeta } from '../data'
import { displayName } from '../labels'
import { botRosterMeta } from '../routing'
import { CrossfadeShot } from '../tool-card-live'
import type { ToolCardGroup } from '../tool-card-model'
import { PreviewSessionContext } from '../tool-card-session'

import { useBrowserText } from './browser-i18n'
import { CloudTakeOver } from './cloud'
import { openActivityInBrowser, openBotInBrowser, openInBrowser } from './open'
import { $activity, type ActivityStep, type ActivityTab, patchTab, publishActivity } from './store'
import { hostOf } from './url'

const VERB_ICON: Record<string, string> = {
  back: 'arrow-left',
  click: 'target',
  console: 'terminal',
  forward: 'arrow-right',
  get_images: 'file-media',
  navigate: 'globe',
  press: 'keyboard',
  reload: 'refresh',
  scroll: 'fold-down',
  snapshot: 'list-tree',
  type: 'edit',
  vision: 'eye'
}

function verbIcon(tool: string): string {
  return VERB_ICON[tool.replace(/^browser_/, '')] ?? 'globe'
}

/** Publish a browser tool card group so a browser tab can follow it. */
export function useBrowserActivity(group: ToolCardGroup): void {
  const session = useContext(PreviewSessionContext)
  const bot = useCardBot()
  const allMeta = useValue($botMeta)
  const running = group.state === 'running' || group.state === 'approval'
  const backend = useBrowserBackend(group.family === 'browser' && running ? bot : null)
  const onDesktop = backend === 'desktop'
  const realProfile = group.cards.some(card => card.realProfile)

  useEffect(() => {
    if (group.family !== 'browser') {
      return
    }

    let lastUrl = ''

    const steps: ActivityStep[] = group.cards.map(card => {
      lastUrl = card.thumb?.url && /^https?:\/\//i.test(card.thumb.url) ? card.thumb.url : lastUrl

      return {
        tool: card.tool ?? '',
        status: card.status,
        state: card.state,
        url: lastUrl,
        shot: card.thumb?.kind === 'screenshot' ? card.thumb.src : ''
      }
    })

    publishActivity({
      key: group.key,
      botName: bot ? displayName(bot, botRosterMeta(bot, allMeta) ?? null) : '',
      running,
      steps,
      sessionId: session.storedId,
      runtimeId: session.runtimeId,
      bot,
      onDesktop: onDesktop && !realProfile,
      backend: realProfile ? 'unknown' : backend
    })
  }, [allMeta, backend, bot, group, onDesktop, realProfile, running, session.runtimeId, session.storedId])
}

/** The "Show me" pill on a card's live frame and in its steps viewer. */
export function ShowMeButton({ group, step = null }: { group: ToolCardGroup; step?: null | number }) {
  const text = useBrowserText()
  const activity = useValue($activity)
  const name = activity[group.key]?.botName || group.name

  return (
    <Tip label={text.showMeHint}>
      <button
        className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-ui-2xs hbp-lv-badge hbp-tc-hover"
        data-show-me=""
        onClick={event => {
          event.stopPropagation()
          openActivityInBrowser(group.key, text.activityTab(name), step)
        }}
        onKeyDown={event => event.stopPropagation()}
        type="button"
      >
        <Codicon name="eye" size={12} />
        {text.showMe}
      </button>
    </Tip>
  )
}

export function ActivityTabView({ tab }: { tab: ActivityTab }) {
  const text = useBrowserText()
  const snapshot = useValue($activity)[tab.key]
  const listRef = useRef<HTMLDivElement>(null)

  const steps = snapshot?.steps ?? []
  const total = steps.length
  const following = tab.step === null
  const selected = Math.min(tab.step ?? total - 1, total - 1)
  const step = steps[selected]
  const shot = latestShotUpTo(steps, selected)
  const pageUrl = step?.url ?? ''

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>("[data-selected='true']")?.scrollIntoView({ block: 'nearest' })
  }, [selected, total])

  if (!snapshot) {
    return (
      <div className="hbb-center">
        <div className="hbb-card hbb-enter">
          <span className="hbb-card-icon">
            <Codicon name="eye-closed" size={20} />
          </span>
          <p>{text.activityGone}</p>
        </div>
      </div>
    )
  }

  const select = (index: null | number) => patchTab<ActivityTab>(tab.id, { step: index })

  return (
    <div className="hbb-act hbb-enter">
      <div className="hbb-act-status">
        {snapshot.running ? (
          <span className="hbb-chip hbb-chip-live">
            <span aria-hidden className="hbp-lv-dot size-1.5 rounded-full" />
            {snapshot.botName || text.title}
          </span>
        ) : (
          <strong>{snapshot.botName}</strong>
        )}
        <span className={snapshot.running && following ? 'hbb-act-status-text hbp-tc-shimmer' : 'hbb-act-status-text'}>
          {step ? step.status : text.activityWaiting}
        </span>
        {!snapshot.running && <span className="hbp-tc-subtle text-ui-xs">{text.activityIdle}</span>}
      </div>
      <div className="hbb-act-shot">
        {shot ? (
          <CrossfadeShot src={shot} />
        ) : (
          <div className="hbb-center hbp-tc-shimmer">
            <span className="text-ui-xs hbp-tc-subtle">{text.activityWaiting}</span>
          </div>
        )}
      </div>
      <div className="hbb-act-foot">
        <span className="min-w-0 flex-1 truncate text-ui-xs hbp-tc-muted tabular-nums">
          {total ? text.stepOf(selected + 1, total) : ''}
          {pageUrl ? ` · ${hostOf(pageUrl)}` : ''}
        </span>
        {!following && (
          <Button onClick={() => select(null)} size="xs" variant="ghost">
            <Codicon name="debug-step-into" />
            {text.followLatest}
          </Button>
        )}
        {pageUrl && (
          <Button onClick={() => openInBrowser(pageUrl)} size="xs" variant="outline">
            <Codicon name="globe" />
            {text.openPageHere}
          </Button>
        )}
        {snapshot.bot && snapshot.running && snapshot.onDesktop && (
          <Button
            onClick={() => snapshot.bot && openBotInBrowser(snapshot.bot, botRosterMeta(snapshot.bot, $botMeta.get()) ?? null)}
            size="xs"
          >
            <Codicon name="device-desktop" />
            {text.watchScreen}
          </Button>
        )}
        {snapshot.bot && snapshot.running && !snapshot.onDesktop && snapshot.backend === 'elsewhere' && <CloudTakeOver />}
      </div>
      <div aria-label={text.stepsLabel} className="hbb-steps" ref={listRef} role="list">
        {steps.map((item, index) => (
          <button
            className="hbb-step"
            data-selected={index === selected ? 'true' : 'false'}
            data-state={item.state}
            key={index}
            onClick={() => select(index === total - 1 && snapshot.running ? null : index)}
            role="listitem"
            type="button"
          >
            <span className="hbb-step-no">{index + 1}</span>
            <span className="hbb-step-icon">
              <Codicon name={item.state === 'running' ? 'loading' : verbIcon(item.tool)} size={13} spinning={item.state === 'running'} />
            </span>
            <span className="hbb-step-text">{item.status}</span>
            {item.url && <span className="hbb-step-host">{hostOf(item.url)}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

function latestShotUpTo(steps: readonly ActivityStep[], index: number): string {
  for (let at = index; at >= 0; at -= 1) {
    if (steps[at]?.shot) {
      return steps[at].shot
    }
  }

  return ''
}
