import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useState } from 'react'

import { getProfiles } from '@/api/profiles'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  dropdownMenuRow,
  dropdownMenuSectionLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { seedAgentReview } from '@/store/agent-review'
import { notify } from '@/store/notifications'
import { $reviewFiles, $reviewLoading } from '@/store/review'
import type { ProfileInfo } from '@/types/hermes'

/** Display name for a profile row — bot title, then display_name, then name. */
const profileLabel = (profile: ProfileInfo): string =>
  (profile.bot_title || profile.display_name || profile.name).trim() || profile.name

/**
 * "Have <profile> review this diff" — a compact profile picker on the review
 * pane's header. Picking one seeds a FRESH session draft on that profile
 * carrying the diff as a `@file:` attachment (see store/agent-review.ts); the
 * user still presses send — nothing auto-submits.
 */
export function AgentReviewMenu() {
  const { t } = useI18n()
  const c = t.statusStack.coding
  const hasFiles = useStore($reviewFiles).length > 0
  const loading = useStore($reviewLoading)
  const [open, setOpen] = useState(false)
  const [profiles, setProfiles] = useState<ProfileInfo[]>([])

  // The roster is a small REST read; only fetch while the menu is open so a
  // closed pane costs nothing.
  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false

    void getProfiles()
      .then(result => {
        if (!cancelled) {
          setProfiles(result.profiles ?? [])
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProfiles([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [open])

  const pick = useCallback(
    (profile: ProfileInfo) => {
      void seedAgentReview(profile.name, profileLabel(profile)).then(seeded => {
        if (!seeded) {
          notify({ kind: 'warning', message: c.agentReviewUnavailable, title: c.agentReview })
        }
      })
    },
    [c.agentReview, c.agentReviewUnavailable]
  )

  return (
    <DropdownMenu onOpenChange={setOpen} open={open}>
      <Tip label={c.agentReview}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={c.agentReview}
            className="size-5"
            disabled={!hasFiles || loading}
            size="icon-xs"
            variant="ghost"
          >
            <Codicon name="hubot" size="0.8125rem" />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" collisionPadding={8} side="bottom">
        <DropdownMenuLabel className={dropdownMenuSectionLabel}>{c.agentReviewPick}</DropdownMenuLabel>
        {profiles.length === 0 ? (
          <div className="px-3 py-2 text-center text-xs text-(--ui-text-tertiary)" role="status">
            {c.agentReviewNoProfiles}
          </div>
        ) : (
          profiles.map(profile => (
            <DropdownMenuItem className={dropdownMenuRow} key={profile.name} onSelect={() => pick(profile)}>
              <span className="min-w-0 flex-1 truncate">{profileLabel(profile)}</span>
              <span className="shrink-0 text-[0.625rem] text-(--ui-text-quaternary)">{profile.name}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
