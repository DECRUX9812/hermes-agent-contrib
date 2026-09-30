/**
 * "Share <bot>" — the shareable profile: a card picture (face, name, role,
 * what it does, what to ask, and a QR to its messaging address when it has
 * one), an invite to paste, and the bot file for someone to run their own
 * copy. The preview IS the exported PNG, so what you see is what they get.
 */

import {
  Button,
  Codicon,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  fetchReachTargets,
  GlyphSpinner,
  host,
  renderQr
} from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
import { exportBot } from './bot-export'
import { chatStarters } from './bot-starters'
import { botRole, displayName } from './labels'
import { drawShareCard, inviteText, svgFaceUrl } from './share-card'
import { useShareText } from './share-i18n'
import type { BotMeta, RosterRow } from './types'

export function ShareBotDialog({
  bot,
  meta,
  onOpenChange,
  open
}: {
  bot: RosterRow
  meta: BotMeta | null
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const s = useShareText()
  const faceRef = useRef<HTMLDivElement>(null)
  const [png, setPng] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [link, setLink] = useState<null | string>(null)
  const name = displayName(bot, meta)
  const role = botRole(bot, meta)
  const description = meta?.description?.trim() || ''
  const { color, image, shape } = botAppearance(bot.name, meta)
  const accent = avatarColor(color, bot.name)
  const photo = image && !isBackfilledFacePng(image) ? image : null

  useEffect(() => {
    if (!open) {
      return
    }

    let live = true
    let url = ''
    setPng(null)
    setPreviewUrl('')

    const build = async () => {
      const targets = bot.remoteSource ? [] : await fetchReachTargets(bot.name)
      const target = targets[0] ?? null
      const qrUrl = target ? await renderQr(target.qrLink).catch(() => null) : null
      // The face is the live SVG the dialog just rendered (so it carries the
      // bot's real shape/colour), or its photo/pet.
      const faceUrl = photo ?? svgFaceUrl(faceRef.current?.querySelector('svg') ?? null)

      const canvas = await drawShareCard({
        accent,
        description,
        faceUrl,
        footer: s.footer,
        name,
        qrCaption: s.scanToChat,
        qrUrl,
        role,
        starters: chatStarters(meta),
        startersLabel: s.askMe
      })

      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))

      if (!live || !blob) {
        return
      }

      url = URL.createObjectURL(blob)
      setLink(target?.openLink ?? null)
      setPng(blob)
      setPreviewUrl(url)
    }

    // One frame so the hidden face has mounted before it is serialised.
    const frame = requestAnimationFrame(() => {
      build().catch(error => live && host.notifyError(error, s.failed))
    })

    return () => {
      live = false
      cancelAnimationFrame(frame)

      if (url) {
        URL.revokeObjectURL(url)
      }
    }
    // Rebuild on open or when the bot's identity changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bot.name, name, role, description, accent, photo, shape])

  const copyImage = async () => {
    if (!png) {
      return
    }

    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
      host.notify({ kind: 'success', message: s.copiedImage })
    } catch (error) {
      host.notifyError(error, s.failed)
    }
  }

  const saveImage = () => {
    if (!previewUrl) {
      return
    }

    const anchor = document.createElement('a')
    anchor.href = previewUrl
    anchor.download = `${bot.name}-card.png`
    anchor.click()
  }

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteText({ description, link, name, role }))
      host.notify({ kind: 'success', message: s.copiedInvite })
    } catch (error) {
      host.notifyError(error, s.failed)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{s.title(name)}</DialogTitle>
          <DialogDescription>{s.subtitle}</DialogDescription>
        </DialogHeader>

        {/* The face the card is drawn from: rendered off-screen so the PNG
            carries the bot's real shape, colour and eyes. */}
        <div aria-hidden className="pointer-events-none fixed -left-[9999px] top-0" ref={faceRef}>
          {!photo && <BotFace color={accent} name={bot.name} shape={shape} size={200} />}
        </div>

        <div
          className="grid aspect-[1200/630] w-full place-items-center overflow-hidden rounded-xl bg-(--ui-bg-tertiary) shadow-[0_1px_0_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(0,0,0,0.25)]"
          data-slot="share-card-preview"
        >
          {previewUrl ? <img alt={s.title(name)} className="size-full" src={previewUrl} /> : <GlyphSpinner />}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button disabled={!png} onClick={() => void copyImage()} size="sm">
            <Codicon name="copy" />
            {s.copyImage}
          </Button>
          <Button disabled={!previewUrl} onClick={saveImage} size="sm" variant="secondary">
            <Codicon name="desktop-download" />
            {s.saveImage}
          </Button>
          <Button onClick={() => void copyInvite()} size="sm" variant="secondary">
            <Codicon name="mention" />
            {s.copyInvite}
          </Button>
          <Button className="ml-auto" onClick={() => void exportBot(bot, meta)} size="sm" variant="ghost">
            <Codicon name="package" />
            {s.exportFile}
          </Button>
        </div>
        <p className="-mt-1 text-[0.6875rem] text-(--ui-text-tertiary)">{s.exportHint}</p>
      </DialogContent>
    </Dialog>
  )
}
