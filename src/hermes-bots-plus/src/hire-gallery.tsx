/**
 * "Hire a teammate" — Bot Mode's one door for new bots (revamp mockup
 * `docs/revamp/mockups/hire.html`). Three columns: shelves on the left, cards in
 * the middle, the picked teammate on the right.
 *
 *  - A starter card, or a free-text description, becomes a `BotDraft`; "Hire"
 *    hands it to CreateAgentDialog, which arrives filled in (name, role,
 *    persona, face, first prompts, and the C1 preset's skills + model). Bot
 *    creation keeps its one code path; nothing here writes a profile.
 *  - A Team Pack creates a whole team with open seats through the existing
 *    `bots_team.pack.import` door, then opens the Team page to fill them.
 *  - "Import a bot…" is the bundle import the old marketplace stub carried.
 */

import {
  Button,
  Codicon,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  host,
  Input,
  RowButton,
  SearchField,
  Textarea
} from '@hermes/plugin-sdk'
import { useMemo, useState } from 'react'

import { avatarColor, blobShapeString, BotFace } from './avatar'
import { importBot } from './bot-export'
import {
  BOT_STARTERS,
  type BotDraft,
  type BotStarter,
  draftFromDescription,
  STARTER_CATEGORIES,
  type StarterCategory,
  starterDraft
} from './bot-starters'
import { BOT_TEMPLATES } from './bot-templates'
import { useHireText } from './hire-i18n'
import { $selectedTeamId } from './team'
import { BUILTIN_TEAM_PACKS, type BuiltinTeamPack, importTeamPack } from './team-packs'

type Shelf = 'featured' | 'packs' | StarterCategory

type Pick = { draft: BotDraft; kind: 'bot' } | { kind: 'pack'; pack: BuiltinTeamPack }

interface HireGalleryProps {
  open: boolean
  onClose: () => void
  /** Continue into the create form: a filled draft, or null for a blank bot. */
  onHire: (draft: BotDraft | null) => void
}

const SHELF_CLASS =
  'flex h-7 w-full items-center justify-between rounded-md px-2 text-left text-xs text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) data-[active=true]:bg-(--ui-row-active-background) data-[active=true]:font-medium data-[active=true]:text-foreground'

const CARD_CLASS =
  'flex min-w-0 flex-col gap-1.5 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-card,transparent) p-3 text-left transition-colors hover:border-(--ui-stroke-primary) data-[picked=true]:border-(--ui-accent) data-[picked=true]:ring-1 data-[picked=true]:ring-(--ui-accent)'

function starterMatches(starter: BotStarter, query: string): boolean {
  const q = query.trim().toLowerCase()

  return !q || [starter.name, starter.title, starter.tagline].some(text => text.toLowerCase().includes(q))
}

/** The skills a preset hires with, as short tags (leaf names, at most four). */
function presetTags(draft: BotDraft): string[] {
  return (BOT_TEMPLATES[draft.preset]?.skills ?? []).slice(0, 4)
}

function Face({ name, blob, size }: { blob?: string; name: string; size: number }) {
  return (
    <BotFace
      color={avatarColor(null, name)}
      name={name}
      shape={blob ? blobShapeString('', blob) : 'blobatar'}
      size={size}
    />
  )
}

function StarterCard({ picked, onPick, starter }: { onPick: () => void; picked: boolean; starter: BotStarter }) {
  const tags = presetTags(starterDraft(starter))

  return (
    <RowButton className={CARD_CLASS} data-picked={picked} data-slot="hire-card" onClick={onPick}>
      <span className="flex min-w-0 items-center gap-2.5">
        <Face blob={starter.blob} name={starter.name} size={34} />
        <span className="min-w-0">
          <span className="block truncate text-[0.8125rem] font-semibold text-foreground">{starter.name}</span>
          <span className="block truncate text-[0.6875rem] text-(--ui-text-tertiary)">{starter.title}</span>
        </span>
      </span>
      <span className="line-clamp-2 text-xs leading-snug text-(--ui-text-secondary)">{starter.tagline}</span>
      {tags.length ? (
        <span className="flex flex-wrap gap-1">
          {tags.map(tag => (
            <span
              className="rounded bg-(--ui-inline-code-background) px-1.5 py-px text-[0.625rem] text-(--ui-text-tertiary)"
              key={tag}
            >
              {tag}
            </span>
          ))}
        </span>
      ) : null}
    </RowButton>
  )
}

function PackCard({ onPick, pack, picked }: { onPick: () => void; pack: BuiltinTeamPack; picked: boolean }) {
  return (
    <RowButton className={CARD_CLASS} data-picked={picked} data-slot="hire-pack" onClick={onPick}>
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="flex shrink-0 items-center gap-0.5">
          {pack.faces.map(face => (
            <Face key={face} name={face} size={22} />
          ))}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[0.8125rem] font-semibold text-foreground">{pack.pack.name}</span>
          <span className="block truncate text-[0.6875rem] text-(--ui-text-tertiary)">
            {pack.pack.seats.map(seat => seat.role).join(' · ')}
          </span>
        </span>
      </span>
    </RowButton>
  )
}

function BotDetail({ draft, onHire }: { draft: BotDraft; onHire: (draft: BotDraft) => void }) {
  const h = useHireText()
  const [name, setName] = useState(draft.name)
  const tags = presetTags(draft)
  const hired = { ...draft, name: name.trim() || draft.name }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-slot="hire-detail">
      <div className="flex items-center gap-3">
        <Face name={hired.name} size={44} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{hired.name}</div>
          <div className="truncate text-xs text-(--ui-text-tertiary)">{draft.title}</div>
        </div>
      </div>
      {draft.templateId ? null : <div className="text-[0.6875rem] text-(--ui-text-quaternary)">{h.drafted}</div>}
      <label className="grid gap-1.5">
        <span className="text-[0.6875rem] font-medium text-(--ui-text-tertiary)">{h.name}</span>
        <Input aria-label={h.name} onChange={event => setName(event.target.value)} value={name} />
      </label>
      <div className="grid gap-1">
        <span className="text-[0.6875rem] font-medium text-(--ui-text-tertiary)">{h.brain}</span>
        <span className="text-xs text-(--ui-text-secondary)">{h.brainDefault}</span>
        <span className="text-[0.6875rem] text-(--ui-text-quaternary)">{h.brainHint}</span>
      </div>
      {tags.length ? (
        <div className="grid gap-1.5">
          <span className="text-[0.6875rem] font-medium text-(--ui-text-tertiary)">{h.startsWith}</span>
          <span className="flex flex-wrap gap-1">
            {tags.map(tag => (
              <span
                className="rounded bg-(--ui-inline-code-background) px-1.5 py-px text-[0.625rem] text-(--ui-text-tertiary)"
                key={tag}
              >
                {tag}
              </span>
            ))}
          </span>
        </div>
      ) : null}
      {draft.starters.length ? (
        <div className="grid gap-1">
          <span className="text-[0.6875rem] font-medium text-(--ui-text-tertiary)">{h.firstThings}</span>
          <ul className="grid gap-0.5 text-xs text-(--ui-text-secondary)">
            {draft.starters.map(line => (
              <li className="truncate" key={line}>
                “{line}”
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-auto grid gap-2">
        <Button className="w-full justify-center" data-slot="hire-button" onClick={() => onHire(hired)}>
          {h.hire(hired.name)}
        </Button>
        <Button className="w-full justify-center" onClick={() => onHire(hired)} size="xs" variant="ghost">
          {h.customize}
        </Button>
      </div>
    </div>
  )
}

function PackDetail({ onDone, pack }: { onDone: () => void; pack: BuiltinTeamPack }) {
  const h = useHireText()
  const [busy, setBusy] = useState(false)

  const hire = () => {
    setBusy(true)
    void importTeamPack(pack.pack)
      .then(view => {
        $selectedTeamId.set(view.team.id)
        host.notify({ kind: 'success', message: h.packCreated(pack.pack.name) })
        onDone()
        void host.navigate('/team')
      })
      .catch(error => host.notifyError(error, h.packFailed))
      .finally(() => setBusy(false))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-slot="hire-detail">
      <div className="grid gap-1">
        <div className="text-sm font-semibold text-foreground">{pack.pack.name}</div>
        <div className="text-xs text-(--ui-text-secondary)">{pack.pack.mission}</div>
      </div>
      <ul className="grid gap-2">
        {pack.pack.seats.map(seat => (
          <li className="flex items-start gap-2.5" key={seat.slot}>
            <Codicon
              className="mt-0.5 shrink-0 text-(--ui-text-quaternary)"
              name={seat.lead ? 'star-full' : 'person'}
              size="0.8rem"
            />
            <span className="min-w-0">
              <span className="block text-xs font-medium text-foreground">{seat.role}</span>
              <span className="block text-[0.6875rem] text-(--ui-text-tertiary)">{seat.title}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-auto grid gap-2">
        <Button className="w-full justify-center" disabled={busy} onClick={hire}>
          {h.hirePack(pack.pack.name)}
        </Button>
        <p className="text-center text-[0.6875rem] text-(--ui-text-quaternary)">{h.packHint}</p>
      </div>
    </div>
  )
}

export function HireGallery({ open, onClose, onHire }: HireGalleryProps) {
  const h = useHireText()
  const [shelf, setShelf] = useState<Shelf>('featured')
  const [query, setQuery] = useState('')
  const [describe, setDescribe] = useState('')
  const [pick, setPick] = useState<null | Pick>(null)

  const starters = useMemo(
    () =>
      BOT_STARTERS.filter(
        starter => (shelf === 'featured' || shelf === starter.category) && starterMatches(starter, query)
      ),
    [query, shelf]
  )

  const showPacks = (shelf === 'featured' || shelf === 'packs') && !query.trim()
  const showStarters = shelf !== 'packs'

  const hire = (draft: BotDraft | null) => {
    onHire(draft)
    setPick(null)
    setDescribe('')
  }

  const draftIt = () => {
    const draft = draftFromDescription(describe)

    if (draft) {
      setPick({ kind: 'bot', draft })
    }
  }

  const pickedStarterId = pick?.kind === 'bot' ? pick.draft.templateId : undefined
  const pickedPackId = pick?.kind === 'pack' ? pick.pack.id : undefined

  return (
    <Dialog onOpenChange={next => !next && onClose()} open={open}>
      <DialogContent
        bodyClassName="p-0"
        className="h-[min(40rem,calc(100vh-4rem))] max-w-[min(68rem,calc(100vw-2rem))]"
        data-slot="hire-gallery"
      >
        <div className="flex items-center gap-3 border-b border-(--ui-stroke-tertiary) px-4 py-3 pr-12">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-sm">{h.title}</DialogTitle>
            <DialogDescription className="text-xs">{h.subtitle}</DialogDescription>
          </div>
          <SearchField
            aria-label={h.search}
            containerClassName="w-56 shrink-0"
            onChange={setQuery}
            placeholder={h.search}
            value={query}
            variant="box"
          />
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[11rem_minmax(0,1fr)_17rem]">
          <nav className="hidden min-h-0 flex-col gap-0.5 overflow-y-auto border-r border-(--ui-stroke-tertiary) p-2 md:flex">
            <button
              className={SHELF_CLASS}
              data-active={shelf === 'featured'}
              onClick={() => setShelf('featured')}
              type="button"
            >
              {h.featured}
            </button>
            {STARTER_CATEGORIES.map(category => {
              const count = BOT_STARTERS.filter(starter => starter.category === category).length

              return (
                <button
                  className={SHELF_CLASS}
                  data-active={shelf === category}
                  key={category}
                  onClick={() => setShelf(category)}
                  type="button"
                >
                  {h.category[category]}
                  <span className="text-[0.6875rem] text-(--ui-text-quaternary)">{count}</span>
                </button>
              )
            })}
            <div className="px-2 pt-3 pb-1 text-[0.6875rem] font-medium text-(--ui-text-quaternary)">{h.packsNav}</div>
            <button
              className={SHELF_CLASS}
              data-active={shelf === 'packs'}
              onClick={() => setShelf('packs')}
              type="button"
            >
              <span className="flex items-center gap-1.5">
                <Codicon name="organization" size="0.75rem" />
                {h.packsNav}
              </span>
              <span className="text-[0.6875rem] text-(--ui-text-quaternary)">{BUILTIN_TEAM_PACKS.length}</span>
            </button>
            <div className="px-2 pt-3 pb-1 text-[0.6875rem] font-medium text-(--ui-text-quaternary)">{h.yours}</div>
            <button
              className={SHELF_CLASS}
              onClick={() => {
                void importBot().then(name => {
                  if (name) {
                    onClose()
                  }
                })
              }}
              type="button"
            >
              <span className="flex items-center gap-1.5">
                <Codicon name="cloud-download" size="0.75rem" />
                {h.importBot}
              </span>
            </button>
          </nav>
          {/* Narrow windows stack one column: a pick swaps the cards for its
              detail (with a way back) instead of hiding the Hire button. */}
          <div className={pick ? 'hidden min-h-0 overflow-y-auto p-4 md:block' : 'min-h-0 overflow-y-auto p-4'}>
            <div className="mb-5 grid gap-1.5">
              <span className="text-[0.6875rem] font-medium text-(--ui-text-tertiary)">{h.describeLabel}</span>
              <div className="flex items-start gap-2">
                <Textarea
                  className="min-h-9 flex-1 resize-none text-xs"
                  data-slot="hire-describe"
                  onChange={event => setDescribe(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      draftIt()
                    }
                  }}
                  placeholder={h.describePlaceholder}
                  rows={1}
                  value={describe}
                />
                <Button disabled={!describe.trim()} onClick={draftIt} size="sm" variant="secondary">
                  <Codicon name="sparkle" size="0.75rem" />
                  {h.describeAction}
                </Button>
              </div>
            </div>
            {showPacks ? (
              <section className="mb-5 grid gap-2">
                <h3 className="text-[0.6875rem] font-medium text-(--ui-text-tertiary)">{h.packsHeading}</h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {BUILTIN_TEAM_PACKS.map(pack => (
                    <PackCard
                      key={pack.id}
                      onPick={() => setPick({ kind: 'pack', pack })}
                      pack={pack}
                      picked={pickedPackId === pack.id}
                    />
                  ))}
                </div>
              </section>
            ) : null}
            {showStarters ? (
              <section className="grid gap-2">
                <h3 className="text-[0.6875rem] font-medium text-(--ui-text-tertiary)">{h.teammatesHeading}</h3>
                {starters.length === 0 ? (
                  <p className="py-6 text-center text-xs text-(--ui-text-tertiary)">{h.noMatch(query.trim())}</p>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {starters.map(starter => (
                      <StarterCard
                        key={starter.id}
                        onPick={() => setPick({ kind: 'bot', draft: starterDraft(starter) })}
                        picked={pickedStarterId === starter.id}
                        starter={starter}
                      />
                    ))}
                    <RowButton
                      className={`${CARD_CLASS} border-dashed`}
                      data-slot="hire-blank"
                      onClick={() => hire(null)}
                    >
                      <span className="flex items-center gap-2.5">
                        <span className="grid size-[34px] place-items-center rounded-lg border border-dashed border-(--ui-stroke-secondary) text-(--ui-text-tertiary)">
                          <Codicon name="add" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[0.8125rem] font-semibold text-foreground">{h.blankTitle}</span>
                          <span className="block truncate text-[0.6875rem] text-(--ui-text-tertiary)">
                            {h.blankBody}
                          </span>
                        </span>
                      </span>
                    </RowButton>
                  </div>
                )}
              </section>
            ) : null}
          </div>
          <aside
            className={
              pick
                ? 'flex min-h-0 flex-col overflow-y-auto p-4 md:border-l md:border-(--ui-stroke-tertiary)'
                : 'hidden min-h-0 flex-col overflow-y-auto border-l border-(--ui-stroke-tertiary) p-4 md:flex'
            }
          >
            {pick ? (
              <Button className="mb-3 self-start md:hidden" onClick={() => setPick(null)} size="xs" variant="ghost">
                <Codicon name="chevron-left" size="0.75rem" />
                {h.back}
              </Button>
            ) : null}
            {pick?.kind === 'bot' ? (
              <BotDetail draft={pick.draft} key={pick.draft.templateId || pick.draft.name} onHire={hire} />
            ) : pick?.kind === 'pack' ? (
              <PackDetail onDone={onClose} pack={pick.pack} />
            ) : (
              <div className="grid flex-1 place-items-center text-center text-xs text-(--ui-text-tertiary)">
                {h.pickOne}
              </div>
            )}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  )
}
