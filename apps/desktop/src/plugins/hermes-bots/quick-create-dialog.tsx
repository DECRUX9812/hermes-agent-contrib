/**
 * The minimal New Bot dialog — the "just work" door the toolbar's "+" and the
 * roster empty state open.
 *
 * Name is the only required field; the one-line description, the face, and
 * the starter chips are optional polish. A starter chip seeds the form with
 * that starter's persona/preset (visible before Create, still editable), so
 * "start from a template" is one tap plus one Create — and the empty-state
 * chips skip even that (they call `createQuickBot` directly).
 *
 * Everything deeper — clone source, model pin, skills, toolsets, a create on
 * another machine — stays in the heavyweight dialog behind the gallery link,
 * which is why this dialog never grows a "Create on" or capability picker.
 */

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  RowButton,
  useI18n
} from '@hermes/plugin-sdk'
import { useState } from 'react'

import { avatarColor, blobatarSvg, blobShapeString, BotFace } from './avatar'
import { AvatarPicker } from './avatar-picker'
import { type BotStarter, QUICK_STARTERS, starterDraft } from './bot-starters'
import type { BotTemplateId } from './bot-templates'
import { labeled } from './dialog-parts'
import { useBots } from './i18n'
import { botProfileIdentity } from './labels'
import { createQuickBot } from './quick-create'
import type { RosterRow } from './types'

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

interface QuickCreateDialogProps {
  onClose: () => void
  /** Model-setup door for a created bot whose provider check fails. */
  onConfigureModel?: (bot: RosterRow) => void
  /** Door into the Hire gallery, where the heavyweight dialog lives. Mounted
   *  surfaces pass it; the link hides where no gallery is mounted. */
  onBrowseGallery?: () => void
  open: boolean
  /** Active-source roster rows — the teammate list for the new SOUL and the
   *  taken-name check. */
  roster: RosterRow[]
}

export function QuickCreateDialog({
  open,
  onClose,
  onBrowseGallery,
  onConfigureModel,
  roster
}: QuickCreateDialogProps) {
  const { t } = useI18n()
  const b = useBots()
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  // Starter picks write these silently — the form never shows the persona or
  // the preset, like the heavyweight dialog reads them off its draft.
  const [persona, setPersona] = useState('')
  const [starters, setStarters] = useState<string[]>([])
  const [templateId, setTemplateId] = useState<null | string>(null)
  const [preset, setPreset] = useState<BotTemplateId>('custom')
  const [shape, setShape] = useState(blobatarSvg ? 'blobatar' : 'circle')
  const [color, setColor] = useState<null | string>(null)
  const [image, setImage] = useState<null | string>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<null | string>(null)

  const { slug, title: botTitle } = botProfileIdentity(name, title)
  const valid = slug.length > 0 && NAME_RE.test(slug)
  const taken = roster.some(b => !b.remoteSource && b.name === slug)

  const pickStarter = (starter: BotStarter) => {
    const draft = starterDraft(starter)

    setName(draft.name)
    setTitle(draft.title)
    setDescription(draft.description)
    setPersona(draft.persona)
    setStarters(draft.starters)
    setTemplateId(draft.templateId ?? null)
    setPreset(draft.preset)
    setShape(draft.shape)
  }

  const submit = async () => {
    if (!valid || taken || busy) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      const created = await createQuickBot(
        {
          name,
          title,
          description,
          persona,
          starters,
          shape,
          ...(templateId ? { templateId } : {}),
          preset
        },
        { color, image, onConfigureModel, roster }
      )

      if (!created) {
        setBusy(false)
        setError(b.bot.createFailed)

        return
      }

      onClose()
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Dialog
      onOpenChange={value => {
        if (!value && !busy) {
          onClose()
        }
      }}
      open={open}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{b.bot.newTitle}</DialogTitle>
          <DialogDescription>{b.quick.intro}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3.5">
          <div className="flex justify-center py-1">
            <BotFace
              color={avatarColor(color, slug || 'agent')}
              image={image}
              name={slug || 'agent'}
              shape={shape}
              size={56}
            />
          </div>
          <AvatarPicker
            color={color}
            generateSeed={{
              name: slug || 'agent',
              title: botTitle,
              description
            }}
            image={image}
            onColor={setColor}
            onImage={setImage}
            onShape={setShape}
            shape={shape}
          />
          {labeled(
            b.editor.name,
            <>
              <Input
                aria-label="Bot name"
                autoFocus
                onChange={event => setName(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    void submit()
                  }
                }}
                placeholder="Sage"
                value={name}
              />
              {slug ? (
                <div className="pt-1 text-[0.65rem] text-(--ui-text-quaternary)">{b.editor.savedAs(slug)}</div>
              ) : null}
            </>
          )}
          {taken ? <div className="text-xs text-(--ui-accent)">{b.editor.nameTaken(slug)}</div> : null}
          {labeled(
            b.editor.description,
            <Input
              onChange={event => setDescription(event.target.value)}
              placeholder={b.bot.helpPromptPlaceholder}
              value={description}
            />
          )}
          {labeled(
            b.quick.templates,
            <div className="flex flex-wrap items-center gap-1">
              {QUICK_STARTERS.map(starter => (
                <RowButton
                  aria-label={b.quick.starter(starter.name, starter.title)}
                  className="flex items-center gap-1.5 rounded-full border border-(--ui-stroke-secondary) px-2 py-1 text-[0.6875rem] text-(--ui-text-secondary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground"
                  key={starter.id}
                  onClick={() => pickStarter(starter)}
                >
                  <BotFace
                    color={avatarColor(null, starter.name)}
                    name={starter.name}
                    shape={blobShapeString('', starter.blob)}
                    size={14}
                  />
                  {starter.name}
                </RowButton>
              ))}
            </div>
          )}
          {error ? <div className="text-xs text-(--ui-accent)">{error}</div> : null}
        </div>
        <DialogFooter>
          {onBrowseGallery ? (
            <Button className="mr-auto" onClick={onBrowseGallery} size="sm" variant="ghost">
              {b.quick.browse}
            </Button>
          ) : null}
          <Button onClick={onClose} variant="ghost">
            {t.common.cancel}
          </Button>
          <Button disabled={!valid || taken || busy} onClick={() => void submit()}>
            {busy ? b.editor.creating : b.editor.createBot}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
