/**
 * G6 — the roster's Marketplace stub. No hosted registry: one door in is a
 * bundle produced by a C5 export ('Import from file' → the existing
 * importBot path), the other is the C1 template catalog rendered as
 * installable starter cards — 'Add bot' hands the picked template to
 * CreateAgentDialog, which seeds the form exactly like its in-dialog
 * preset picker.
 */

import { Button, Codicon, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@hermes/plugin-sdk'

import { importBot } from './bot-export'
import { BOT_TEMPLATE_IDS } from './bot-templates'
import type { BotTemplateId } from './bot-templates'
import { useBots } from './i18n'

/** The installable starter set: every template except 'custom' — that one is
 *  the blank slate the New bot menu item already is, not a bundle. */
export const MARKET_STARTER_IDS: Array<Exclude<BotTemplateId, 'custom'>> = BOT_TEMPLATE_IDS.filter(
  (id): id is Exclude<BotTemplateId, 'custom'> => id !== 'custom'
)

interface MarketplaceDialogProps {
  onClose: () => void
  /** 'Add bot' on a starter card — the caller opens CreateAgentDialog with
   *  this template as its initialTemplate. */
  onPickTemplate: (id: BotTemplateId) => void
  open: boolean
}

export function MarketplaceDialog({ open, onClose, onPickTemplate }: MarketplaceDialogProps) {
  const b = useBots()

  return (
    <Dialog onOpenChange={next => !next && onClose()} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{b.market.title}</DialogTitle>
          <DialogDescription>{b.market.desc}</DialogDescription>
        </DialogHeader>
        {/* min-w-0 everywhere on the column: the dialog shell is a flex column
            and grid children default to min-width auto, so long hints once
            pushed the action buttons ~46px past the right edge. */}
        <div className="grid min-w-0 gap-3">
          <div className="min-w-0 rounded-md border border-(--ui-stroke-secondary) p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-(--ui-text-secondary)">{b.market.importFile}</div>
                <div className="mt-0.5 text-[0.6875rem] text-(--ui-text-tertiary)">{b.market.importHint}</div>
              </div>
              <Button
                onClick={() => {
                  void importBot().then(name => {
                    if (name) {
                      onClose()
                    }
                  })
                }}
                size="sm"
                variant="secondary"
              >
                <Codicon name="repo-pull" />
                {b.market.importFile}
              </Button>
            </div>
          </div>
          <div className="min-w-0">
            <div className="pb-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-(--ui-text-quaternary)">
              {b.market.starters}
            </div>
            <div className="grid min-w-0 gap-1.5">
              {MARKET_STARTER_IDS.map(id => {
                const seed = b.editor.templates[id]

                return (
                  <div
                    className="flex min-w-0 items-center gap-2.5 rounded-md border border-(--ui-stroke-secondary) px-2.5 py-2"
                    key={id}
                  >
                    <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="hubot" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-(--ui-text-secondary)">{seed.title}</div>
                      <div className="truncate text-[0.6875rem] text-(--ui-text-tertiary)">{seed.description}</div>
                    </div>
                    <Button className="shrink-0" onClick={() => onPickTemplate(id)} size="sm" variant="secondary">
                      {b.market.add}
                    </Button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
