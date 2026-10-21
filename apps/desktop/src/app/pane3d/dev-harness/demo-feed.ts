import { avatarDirector } from '../director/director'
import type { NotifyRequest } from '../protocol'

/**
 * The scripted notifications behind `playDemo('notify')` (architecture §11).
 *
 * LABELLED scaffolding: every request carries `source:'dev-harness'`, so the
 * card (and the feed entry it collapses into) shows the Dev-harness badge.
 */
export const INSTAGRAM_UPDATE: NotifyRequest = {
  action: { id: 'open', label: 'View post' },
  avatar: 'muse',
  body: 'I posted that reel to your Instagram.',
  source: 'dev-harness',
  title: "Hey — there's an update for you"
}

const DEMO_NOTIFICATIONS: NotifyRequest[] = [INSTAGRAM_UPDATE]

export function runDemoFeed(): void {
  DEMO_NOTIFICATIONS.forEach(request => avatarDirector.notify(request))
}
