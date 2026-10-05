import { useEffect, useState } from 'react'

import type { ProfileScope } from '@/api/client'
import { CodeEditor } from '@/components/chat/code-editor'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ProfileGlyph } from '@/components/ui/profile-glyph'
import { Tip } from '@/components/ui/tooltip'
import { getProfileSoul, updateProfileSoul } from '@/hermes'
import { useI18n } from '@/i18n'
import { resolveProfileColor } from '@/lib/profile-color'
import { notify, notifyError } from '@/store/notifications'
import { normalizeProfileKey, prewarmProfilePick, profileLabel } from '@/store/profile'
import { runImportProfileFlow } from '@/store/profile-share'
import type { ProfileInfo } from '@/types/hermes'

import { FleetGatewayMenuGroup } from './fleet-gateway-menu-group'
import { type FleetAgent, type FleetGroup } from './fleet-rail'
import { ProfileLaunchContextMenu } from './profile-launch-menu'
import { ProfileStatusDot, profileStatusLabel, useProfileStatus } from './profile-switcher-status'
import { useProfilePrewarm } from './use-profile-prewarm'

// Right-click → Edit SOUL.md for a sidebar profile — the same in-app markdown
// editor as the memory-graph node edit, so a profile's persona is editable
// without opening the Manage overlay.
export function EditSoulDialog({
  gatewayLabel,
  onClose,
  profileName,
  scope
}: {
  gatewayLabel?: string
  onClose: () => void
  profileName: null | string
  scope?: ProfileScope
}) {
  const { t } = useI18n()
  const p = t.profiles
  const [content, setContent] = useState('')
  const [missing, setMissing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!profileName) {
      return
    }

    let cancelled = false
    setLoading(true)
    setContent('')
    setMissing(false)

    getProfileSoul(profileName, scope)
      .then(soul => {
        if (!cancelled) {
          setContent(soul.content)
          setMissing(soul.exists === false)
        }
      })
      .catch(err => !cancelled && notifyError(err, p.failedLoadSoul))
      .finally(() => !cancelled && setLoading(false))

    return () => void (cancelled = true)
  }, [p, profileName, scope])

  const save = async () => {
    if (!profileName) {
      return
    }

    setSaving(true)

    try {
      await updateProfileSoul(profileName, content, scope)
      notify({ kind: 'success', title: p.soulSaved, message: profileName })
      onClose()
    } catch (err) {
      notifyError(err, p.failedSaveSoul)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog onOpenChange={open => !open && !saving && onClose()} open={profileName !== null}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {gatewayLabel && profileName ? p.fleet.onGateway(profileName, gatewayLabel) : profileName} · SOUL.md
          </DialogTitle>
        </DialogHeader>
        {missing && <p className="text-xs text-muted-foreground">{p.soulMissing}</p>}
        <div className="h-80">
          {!loading && profileName && (
            <CodeEditor
              filePath="SOUL.md"
              framed
              initialValue={content}
              key={profileName}
              onCancel={() => !saving && onClose()}
              onChange={setContent}
              onSave={() => void save()}
            />
          )}
        </div>
        <DialogFooter>
          <Button disabled={saving} onClick={onClose} type="button" variant="ghost">
            {t.common.cancel}
          </Button>
          <Button disabled={saving || loading} onClick={() => void save()}>
            {saving ? p.saving : p.saveSoul}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// The "+" create button, shared by both rail render paths.
export function AddProfileButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tip label={label}>
      <button
        aria-label={label}
        className="grid size-5 shrink-0 place-items-center rounded-(--control-icon-radius) text-(--ui-text-tertiary) opacity-55 transition hover:bg-(--ui-control-hover-background) hover:text-foreground hover:opacity-100"
        onClick={onClick}
        type="button"
      >
        <Codicon name="add" size="0.75rem" />
      </button>
    </Tip>
  )
}

// Import-archive door beside the "+": adopt a shared profile bundle (theme,
// skills, layout) as a new profile. Same chrome as AddProfileButton; the whole
// flow (picker → import → apply overlay → switch) lives in the store.
export function ImportProfileButton({ label }: { label: string }) {
  return (
    <Tip label={label}>
      <button
        aria-label={label}
        className="grid size-5 shrink-0 place-items-center rounded-(--control-icon-radius) text-(--ui-text-tertiary) opacity-55 transition hover:bg-(--ui-control-hover-background) hover:text-foreground hover:opacity-100"
        onClick={() => void runImportProfileFlow()}
        type="button"
      >
        <Codicon name="cloud-download" size="0.75rem" />
      </button>
    </Tip>
  )
}

// The condensed rail: the active gateway's profiles in one compact menu. The
// trigger shows the active profile (tinted initial, or home for the default);
// on all scope — or on a default the left toggle pill carries — it falls back
// to the placeholder.
export function ProfileDropdown({
  activeKey,
  colors,
  connectionId,
  homeConnectionId,
  onCreate,
  onImport,
  onSelect,
  onSelectRest,
  profiles,
  restGroups
}: {
  activeKey: null | string
  colors: Record<string, string>
  connectionId: null | string
  /** The default row's route, like the home pill's: the active connection. */
  homeConnectionId: null | string
  onCreate: () => void
  onImport: () => void
  onSelect: (name: string) => void
  onSelectRest: (agent: FleetAgent) => void
  profiles: ProfileInfo[]
  // Fleet: the other gateways' agents, each under its own section header.
  restGroups: readonly FleetGroup[]
}) {
  const { t } = useI18n()
  const p = t.profiles

  const value = activeKey ? (profiles.find(profile => normalizeProfileKey(profile.name) === activeKey)?.name ?? '') : ''
  const activeProfile = profiles.find(profile => profile.name === value)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={p.title}
          className="min-w-0 flex-1 justify-between overflow-hidden px-1 text-(--ui-text-secondary) data-[state=open]:bg-(--ui-control-active-background) data-[state=open]:text-foreground"
          data-slot="profile-dropdown"
          size="xs"
          type="button"
          variant="ghost"
        >
          <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            {activeProfile ? (
              <>
                <ProfileGlyph
                  aria-hidden="true"
                  color={resolveProfileColor(activeProfile.name, colors)}
                  isDefault={activeProfile.is_default}
                  name={activeProfile.name}
                />
                <span className="truncate">{profileLabel(activeProfile)}</span>
              </>
            ) : (
              <span className="truncate">{p.title}</span>
            )}
          </span>
          <Codicon aria-hidden="true" className="shrink-0 opacity-60" name="chevron-down" size="0.875rem" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48 max-w-72" collisionPadding={8} side="top">
        <DropdownMenuItem onSelect={onCreate}>
          <Codicon aria-hidden="true" name="add" size="0.875rem" />
          <span className="truncate">{p.newProfile}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onImport}>
          <Codicon aria-hidden="true" name="cloud-download" size="0.875rem" />
          <span className="truncate">{p.importProfile}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup onValueChange={name => name && onSelect(name)} value={value}>
          {profiles.map(profile => (
            <ProfileDropdownItem
              color={resolveProfileColor(profile.name, colors)}
              connectionId={profile.is_default ? homeConnectionId : connectionId}
              hideStatus={profile.name === value}
              isDefault={profile.is_default}
              key={profile.name}
              label={profileLabel(profile)}
              name={profile.name}
            />
          ))}
        </DropdownMenuRadioGroup>
        {restGroups.map(group => (
          <FleetGatewayMenuGroup
            group={group}
            key={group.connectionId}
            onSelect={onSelectRest}
            slot="profile-dropdown-gateway"
            wrapRow={(row, agent, label) => (
              <ProfileLaunchContextMenu
                connectionId={agent.connectionId}
                key={agent.profile}
                label={label}
                profile={agent.profile}
              >
                {row}
              </ProfileLaunchContextMenu>
            )}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// One dropdown row per profile — its own component so each row can own a
// hover-intent prewarm timer (see useProfilePrewarm).
export function ProfileDropdownItem({
  color,
  connectionId,
  hideStatus,
  isDefault,
  label,
  name
}: {
  color: null | string
  connectionId: null | string
  /** The dropdown's own selected row: its sessions are on screen in the
   *  sidebar, so its rollup is suppressed like the active square (#91710). */
  hideStatus?: boolean
  isDefault: boolean
  label: string
  name: string
}) {
  const { t } = useI18n()
  const p = t.profiles
  const { cancelPrewarm, notePointerMove, startPrewarm } = useProfilePrewarm(name, prewarmProfilePick)
  const summary = useProfileStatus(name, connectionId)
  const statusText = summary && !hideStatus ? profileStatusLabel(p, summary) : null

  return (
    <ProfileLaunchContextMenu connectionId={connectionId} label={label} profile={name}>
      <DropdownMenuRadioItem
        className="min-w-0"
        onPointerEnter={startPrewarm}
        onPointerLeave={cancelPrewarm}
        onPointerMove={notePointerMove}
        value={name}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <ProfileGlyph aria-hidden="true" color={color} isDefault={isDefault} name={name} />
          <span className="truncate">{label}</span>
          {summary && !hideStatus && <ProfileStatusDot summary={summary} />}
        </span>
        {statusText && <span className="sr-only">{`, ${statusText}`}</span>}
      </DropdownMenuRadioItem>
    </ProfileLaunchContextMenu>
  )
}

// One at-rest gateway's profile row in the condensed dropdown — the dropdown
// twin of RestSquare, carrying the same rollup (#91710).
export function RestDropdownItem({
  agent,
  colors,
  gatewayLabel,
  onSelect
}: {
  agent: FleetAgent
  colors: Record<string, string>
  gatewayLabel: string
  onSelect: (agent: FleetAgent) => void
}) {
  const { t } = useI18n()
  const p = t.profiles
  const label = p.fleet.onGateway(agent.profile, gatewayLabel)
  const summary = useProfileStatus(agent.profile, agent.connectionId)
  const statusText = summary ? profileStatusLabel(p, summary) : null

  return (
    <ProfileLaunchContextMenu connectionId={agent.connectionId} label={label} profile={agent.profile}>
      <DropdownMenuItem
        aria-label={statusText ? `${label}, ${statusText}` : label}
        className="min-w-0"
        onSelect={() => onSelect(agent)}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <ProfileGlyph
            aria-hidden="true"
            color={resolveProfileColor(agent.profile, colors)}
            isDefault={agent.isDefault}
            name={agent.profile}
          />
          <span className="truncate">{agent.profile}</span>
          {summary && <ProfileStatusDot summary={summary} />}
        </span>
      </DropdownMenuItem>
    </ProfileLaunchContextMenu>
  )
}
