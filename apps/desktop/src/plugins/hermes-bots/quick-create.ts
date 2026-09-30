/**
 * The one-click create path behind "New bot" and the empty-state starter
 * chips.
 *
 * It is deliberately thin: every step is the heavyweight create dialog's own
 * plumbing (`profiles.create` + `composeSoul` + `saveBotMeta` +
 * `setup.runtime_check` + `createCanonicalChat`) with the defaults that dialog
 * mounts with — clone the main profile, share its auth pool, inherit the
 * launch model (no model/provider params ⇒ `mirror_credentials` fills it in),
 * blobatar face drawn from the name. The dialog and the chips only collect
 * optional polish: a description, a face, a starter's persona and preset.
 *
 * Remote creation is not this path's job: bots minted here live on the ACTIVE
 * gateway — the same source the roster's unscoped rows live on, the same
 * default the heavyweight dialog's "Create on" picker starts at. Creating on
 * another machine stays in the heavyweight dialog's remoteTarget branch,
 * reachable through the quick dialog's gallery link.
 */

import { host, queryClient } from '@hermes/plugin-sdk'

import { blobatarSvg } from './avatar'
import type { BotDraft } from './bot-starters'
import { $selectedBot } from './bot-state'
import { BOT_TEMPLATES, disabledSkillNames } from './bot-templates'
import { createCanonicalChat } from './canonical-chat'
import { ROSTER_KEY, saveBotMeta } from './data'
import { botsText } from './i18n'
import { botProfileIdentity, displayName } from './labels'
import type { ProfileDescribeResponse } from './profile-config'
import { composeSoul } from './soul'
import type { RosterRow } from './types'

export interface QuickCreateOptions {
  /** Swatch pick — `undefined` keeps the name's deterministic hue. */
  color?: null | string
  /** Uploaded/generated avatar — `undefined` keeps the shape face. */
  image?: null | string
  /** Model-setup door offered when the new bot's provider check fails. */
  onConfigureModel?: (bot: RosterRow) => void
  /** Active-source roster rows — the SOUL's teammate list and nothing else. */
  roster: RosterRow[]
}

/** Create a bot profile and its canonical Bot Chat in one flow. Returns the
 *  slug on success; throws on `profiles.create` failure (caller decides the
 *  surface — inline dialog error vs. a toast for the one-click chips). */
export async function createQuickBot(draft: BotDraft, options: QuickCreateOptions): Promise<null | string> {
  const b = botsText()
  const { slug, title: botTitle } = botProfileIdentity(draft.name, draft.title)

  if (!slug) {
    return null
  }

  const description = (draft.description || '').trim()
  const descriptionText = [botTitle, description].filter(Boolean).join(' — ')
  const preset = draft.preset && draft.preset !== 'custom' ? BOT_TEMPLATES[draft.preset] : null

  await host.request('profiles.create', {
    name: slug,
    description: descriptionText,
    clone_from: 'default',
    no_skills: false,
    share_auth: true,
    soul: composeSoul({
      name: slug,
      title: botTitle,
      description,
      persona: draft.persona,
      roster: options.roster
    }),
    ...(preset?.model && preset.provider
      ? {
          model: preset.model,
          provider: preset.provider
        }
      : {})
  })

  // A starter's preset curates the new profile's bundled skills — the same
  // describe-then-configure diff the heavyweight dialog runs, best-effort.
  if (preset?.skills.length) {
    try {
      const described = await host.request<ProfileDescribeResponse>('profiles.describe', {
        name: slug
      })

      const disabled = described?.skills ? disabledSkillNames(described.skills, preset) : null

      if (disabled) {
        await host.request('profiles.configure', {
          name: slug,
          disabled_skills: disabled
        })
      }
    } catch {
      /* Edit Profile can finish the curation later */
    }
  }

  // The ui_meta['hermes-bots'] marker — what makes the profile a roster bot.
  saveBotMeta(slug, {
    shape: draft.shape || (blobatarSvg ? 'blobatar' : 'circle'),
    color: options.color ?? undefined,
    image: options.image ?? null,
    imageKind: options.image ? 'photo' : 'shape',
    title: botTitle,
    template: draft.templateId ?? undefined,
    starters: draft.starters?.length ? draft.starters : undefined,
    created: Date.now()
  })

  queryClient.invalidateQueries({
    queryKey: ROSTER_KEY
  })

  // Same readiness probe as the heavyweight submit: a bot whose profile has
  // no usable provider still gets created, but its intro turn is skipped and
  // the toast offers model setup instead of a doomed first run.
  const readiness = await host
    .request<{ error?: string; ok?: boolean }>('setup.runtime_check', {
      profile: slug
    })
    .catch(() => null)

  const needsModel = readiness?.ok === false
  const who = displayName({ name: slug, title: botTitle })
  const bot: RosterRow = { name: slug, description: descriptionText, title: botTitle }

  host.notify(
    needsModel
      ? {
          kind: 'warning',
          title: b.editor.created(who),
          message: b.editor.needsModel,
          detail: readiness?.error,
          ...(options.onConfigureModel
            ? {
                action: {
                  label: b.editor.configureModel,
                  onClick: () => options.onConfigureModel!(bot)
                }
              }
            : {})
        }
      : { kind: 'success', message: b.editor.created(who) }
  )

  $selectedBot.set(slug)

  // Birth the forever chat right away — genuine creation is the one caller
  // allowed to request the intro turn (the click path mints silently).
  try {
    const sid = await createCanonicalChat(slug, {
      kickoff: !needsModel
    })

    if (!sid && typeof host.newChat === 'function') {
      host.newChat(slug)
    }
  } catch {
    if (typeof host.newChat === 'function') {
      host.newChat(slug)
    }
  }

  return slug
}
