import { useStore } from '@nanostores/react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import { COMPLETION_SOUND_VARIANTS, previewCompletionSound } from '@/lib/completion-sound'
import { triggerHaptic } from '@/lib/haptics'
import { Bell, Play } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { $completionSoundVariantId, setCompletionSoundVariantId } from '@/store/completion-sound'
import {
  $nativeNotifyPrefs,
  NATIVE_NOTIFICATION_KINDS,
  sendTestNativeNotification,
  setNativeNotifyEnabled,
  setNativeNotifyKind
} from '@/store/native-notifications'
import {
  $notificationRules,
  setDigestEnabled,
  setQuietHoursEnabled,
  setQuietHoursWindow
} from '@/store/notification-rules'
import { notify } from '@/store/notifications'
import { $sessions, sessionMatchesStoredId } from '@/store/session'
import { $mutedSessionIds, toggleSessionMuted } from '@/store/session-mute'

import { CONTROL_TEXT } from './constants'
import { ListRow, SectionHeading, SettingsContent, ToggleRow } from './primitives'
import { notificationKindSettingId, SETTING_IDS, settingElementId } from './settings-manifest'
import { useSettingDeepLink } from './use-setting-deep-link'

const CAPTION = 'text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)'

function Caption({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn(CAPTION, className)}>{children}</p>
}

interface NotificationsSettingsProps {
  subpage?: string
}

export function NotificationsSettings({ subpage }: NotificationsSettingsProps = {}) {
  const { t } = useI18n()
  const prefs = useStore($nativeNotifyPrefs)
  const rules = useStore($notificationRules)
  const mutedSessionIds = useStore($mutedSessionIds)
  const sessions = useStore($sessions)
  const completionSoundVariantId = useStore($completionSoundVariantId)
  const copy = t.settings.notifications
  const showAlerts = subpage === undefined || subpage === 'alerts'
  const showSounds = subpage === undefined || subpage === 'sounds'

  useSettingDeepLink('notifications', page => subpage === undefined || page === subpage)

  const runTest = async () => {
    triggerHaptic('open')
    const ok = await sendTestNativeNotification(copy.testTitle, copy.testBody)
    notify({ kind: ok ? 'info' : 'error', message: ok ? copy.testSent : copy.testUnsupported })
  }

  return (
    <SettingsContent>
      {showAlerts && (
        <>
          {subpage === undefined && <SectionHeading icon={Bell} title={copy.title} />}
          <Caption className="mb-2 leading-(--conversation-caption-line-height)">{copy.intro}</Caption>

          <ToggleRow
            checked={prefs.enabled}
            description={copy.enableAllDesc}
            id={settingElementId(SETTING_IDS.notifications.enableAll)}
            label={copy.enableAll}
            onChange={setNativeNotifyEnabled}
          />

          {NATIVE_NOTIFICATION_KINDS.map(kind => (
            <ToggleRow
              checked={prefs.enabled && prefs.kinds[kind]}
              description={copy.kinds[kind].description}
              disabled={!prefs.enabled}
              id={settingElementId(notificationKindSettingId(kind))}
              key={kind}
              label={copy.kinds[kind].label}
              onChange={on => setNativeNotifyKind(kind, on)}
            />
          ))}

          {/* Rules (#39): quiet hours and the hourly digest only ever hold
              ambient kinds — approvals, questions, and failures always break
              through. Per-session mutes are managed below as one list. */}
          <ToggleRow
            checked={rules.quietHours.enabled}
            description={copy.quietHoursDesc}
            id={settingElementId(SETTING_IDS.notifications.quietHours)}
            label={copy.quietHoursTitle}
            onChange={setQuietHoursEnabled}
          />

          {rules.quietHours.enabled && (
            <ListRow
              action={
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={copy.quietHoursFrom}
                    className="w-28"
                    onChange={event => setQuietHoursWindow(event.target.value, rules.quietHours.end)}
                    type="time"
                    value={rules.quietHours.start}
                  />
                  <span className={CAPTION}>{copy.quietHoursTo}</span>
                  <Input
                    aria-label={copy.quietHoursTo}
                    className="w-28"
                    onChange={event => setQuietHoursWindow(rules.quietHours.start, event.target.value)}
                    type="time"
                    value={rules.quietHours.end}
                  />
                </div>
              }
              description={copy.quietHoursWindowDesc}
              id={settingElementId(SETTING_IDS.notifications.quietHoursWindow)}
              title={copy.quietHoursWindowTitle}
            />
          )}

          <ToggleRow
            checked={rules.digest}
            description={copy.digestDesc}
            id={settingElementId(SETTING_IDS.notifications.digest)}
            label={copy.digestTitle}
            onChange={setDigestEnabled}
          />

          <div className="mt-2" id={settingElementId(SETTING_IDS.notifications.sessionOverrides)}>
            <ListRow description={copy.sessionOverridesDesc} title={copy.sessionOverridesTitle} />
            {mutedSessionIds.length === 0 ? (
              <Caption className="mt-1">{copy.sessionOverridesEmpty}</Caption>
            ) : (
              <ul className="mt-1">
                {mutedSessionIds.map(storedId => {
                  const session = sessions.find(s => sessionMatchesStoredId(s, storedId))
                  const label = session?.title?.trim() || session?.preview?.trim() || `#${storedId.slice(-6)}`

                  return (
                    <ListRow
                      action={
                        <Button
                          className="gap-1.5"
                          onClick={() => toggleSessionMuted(storedId)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          <Bell className="size-3.5" />
                          {t.sidebar.row.unmuteNotifications}
                        </Button>
                      }
                      key={storedId}
                      title={label}
                    />
                  )
                })}
              </ul>
            )}
          </div>
        </>
      )}

      {showSounds && (
        <ListRow
          action={
            <>
              <Select
                onValueChange={value => {
                  const variantId = Number.parseInt(value, 10)

                  setCompletionSoundVariantId(variantId)
                  previewCompletionSound(variantId)
                  triggerHaptic('selection')
                }}
                value={String(completionSoundVariantId)}
              >
                <SelectTrigger className={cn('min-w-56', CONTROL_TEXT)}>
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  {COMPLETION_SOUND_VARIANTS.map(variant => (
                    <SelectItem key={variant.id} value={String(variant.id)}>
                      {variant.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                className="gap-1.5"
                onClick={() => {
                  previewCompletionSound()
                  triggerHaptic('crisp')
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                <Play className="size-3.5" />
                {copy.completionSoundPreview}
              </Button>
            </>
          }
          description={copy.completionSoundDesc}
          id={settingElementId(SETTING_IDS.notifications.completionSound)}
          title={copy.completionSoundTitle}
        />
      )}

      {showAlerts && (
        <div className="mt-4 flex flex-col gap-2">
          <Button className="self-start" onClick={() => void runTest()} size="sm" type="button" variant="outline">
            <Bell />
            {copy.test}
          </Button>
          <Caption>{copy.focusedHint}</Caption>
        </div>
      )}
    </SettingsContent>
  )
}
