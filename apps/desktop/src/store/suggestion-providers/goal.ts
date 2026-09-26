import { requestComposerFocus, requestComposerInsert } from '@/app/chat/composer/focus'
import { translateNow } from '@/i18n'
import {
  type ComposerSuggestion,
  type DraftProviderContext,
  registerDraftProvider
} from '@/store/composer-suggestions'

/**
 * Goal-first plan chips (roadmap #20): the NEW-session draft — the empty box
 * a fresh chat starts as — offers to frame what the user types as an outcome:
 * `/plan` writes a plan to .hermes/plans/ without executing, `/goal` sets a
 * standing goal the session works toward. Two real slash commands, offered
 * as pills so the draft leads with intent instead of a naked question.
 *
 * The provider opts into `includeShortDraft`: its trigger is WHERE the draft
 * sits (the null-session draft bucket), not what it says, so the chips are
 * visible before the first keystroke — the "one box, one outcome" the item
 * borrows from rabbitOS. Invoke only edits the draft (a `/plan ` or `/goal `
 * prefix where slash routing expects it); the pill never sends on the user's
 * behalf, and once the draft leads with a slash the provider stands down.
 *
 * Only the null-session draft qualifies: a session that exists already has
 * its task — chips there would re-frame an in-flight conversation.
 */

const copy = (key: string) => translateNow(`composer.goalChips.${key}`)

const chip = (id: 'goal' | 'plan'): ComposerSuggestion => ({
  doneLabel: copy(`${id}Done`),
  doneTip: copy(`${id}DoneTip`),
  icon: id === 'plan' ? 'list-tree' : 'target',
  id,
  invoke: async () => {
    requestComposerInsert(`/${id}`, { mode: 'prefix' })
    requestComposerFocus()
  },
  label: copy(`${id}Label`),
  provider: 'goal',
  tip: copy(`${id}Tip`),
  workingLabel: copy(`${id}Label`),
  workingTip: copy(`${id}Tip`)
})

/** The provider's decision, exported for tests: the chips ride on the
 *  new-session draft only while it isn't already command-shaped. */
export function goalChips({ sessionId, text }: DraftProviderContext): ComposerSuggestion[] {
  if (sessionId !== null || text.trimStart().startsWith('/')) {
    return []
  }

  return [chip('plan'), chip('goal')]
}

registerDraftProvider('goal', async context => goalChips(context), { includeShortDraft: true })
