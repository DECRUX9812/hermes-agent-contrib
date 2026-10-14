import { Badge } from '@/components/ui/badge'
import { RowButton } from '@/components/ui/row-button'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/i18n'
import { Check, ChevronRight, Terminal } from '@/lib/icons'
import { PROVIDER_DISPLAY_NAMES } from '@/lib/model-status-label'
import type { OAuthProvider } from '@/types/hermes'

// Titles live in PROVIDER_DISPLAY_NAMES (shared with the model pill); this is
// only the featured order. Both Anthropic entries sit at the bottom: the API-key
// path first, then the subscription OAuth path (only works with extra usage credits).
const PROVIDER_ORDER: Record<string, number> = {
  nous: 0,
  'openai-codex': 1,
  'minimax-oauth': 2,
  'qwen-oauth': 3,
  'xai-oauth': 4,
  anthropic: 5,
  'claude-code': 6
}

const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

export const providerTitle = (p: OAuthProvider) => PROVIDER_DISPLAY_NAMES[p.id] ?? p.name
const orderOf = (p: OAuthProvider) => PROVIDER_ORDER[p.id] ?? 99

export const sortProviders = (providers: OAuthProvider[]) =>
  [...providers].sort((a, b) => orderOf(a) - orderOf(b) || a.name.localeCompare(b.name))

export function FeaturedProviderRow({
  onSelect,
  provider
}: {
  onSelect: (provider: OAuthProvider) => void
  provider: OAuthProvider
}) {
  const { t } = useI18n()
  const freeTier = provider.status?.free_tier === true
  const loggedIn = provider.status?.logged_in && !freeTier

  return (
    <button
      className="group flex w-full items-center justify-between gap-4 rounded-card border border-line p-3 text-left transition-colors hover:bg-hover"
      onClick={() => onSelect(provider)}
      type="button"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <img alt="" className="size-5 shrink-0 rounded" src={assetPath('apple-touch-icon.png')} />
          <span className="text-ui-sm font-semibold">
            {freeTier ? t.freeTier.providerRowTitle : providerTitle(provider)}
          </span>
          {freeTier ? (
            <FreeTierTag />
          ) : loggedIn ? (
            <ConnectedTag />
          ) : (
            <Badge className="rounded-pill bg-brand/10 px-1.5 text-brand">{t.onboarding.recommended}</Badge>
          )}
        </div>
        <p className="mt-1 text-ui-xs text-fg-muted">
          {freeTier ? t.freeTier.providerRowPitch : t.onboarding.featuredPitch}
        </p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-fg-muted transition group-hover:text-fg" />
    </button>
  )
}

// The free tier is an identity without an account: never "Connected", never the account's name.
function FreeTierTag() {
  const { t } = useI18n()

  return <Badge className="rounded-pill bg-brand/10 px-1.5 text-brand">{t.onboarding.freeTier}</Badge>
}

function ConnectedTag() {
  const { t } = useI18n()

  return (
    <Badge className="rounded-pill bg-brand/10 px-1.5 text-brand">
      <Check className="size-3" />
      {t.onboarding.connected}
    </Badge>
  )
}

const PROVIDER_ROW_CLASS =
  'group flex w-full items-center justify-between gap-3 rounded-card border border-line p-3 text-left transition-colors hover:bg-hover'

/** Readiness-pending placeholder: one status line plus two skeleton provider rows. */
export function ProviderRowsSkeleton({ status }: { status: string }) {
  return (
    <div className="grid gap-2" role="status">
      <p className="text-ui-sm text-fg-muted">{status}</p>
      <Skeleton className="h-16 w-full rounded-card" />
      <Skeleton className="h-16 w-full rounded-card" />
    </div>
  )
}

/** Quick-key row for API-key providers (Fireworks leads the expanded list after Nous, OpenRouter further down). */
export function KeyProviderRow({ onClick, pitch, title }: { onClick: () => void; pitch: string; title: string }) {
  return (
    <RowButton className={PROVIDER_ROW_CLASS} onClick={onClick}>
      <div className="min-w-0">
        <span className="text-ui-sm font-semibold">{title}</span>
        <p className="mt-1 text-ui-xs text-fg-muted">{pitch}</p>
      </div>
      <ChevronRight className="size-4 text-fg-muted transition group-hover:text-fg" />
    </RowButton>
  )
}

export function FireworksProviderRow({ onClick }: { onClick: () => void }) {
  const { t } = useI18n()

  return <KeyProviderRow onClick={onClick} pitch={t.onboarding.fireworksPitch} title="Fireworks AI" />
}

/** Onboarding row for the managed local runtime: no account, no key — the
 *  destination is the Local Models pane where install/download live. */
export function LocalModelsProviderRow({ onClick }: { onClick: () => void }) {
  const { t } = useI18n()

  return (
    <KeyProviderRow onClick={onClick} pitch={t.onboarding.localModelsPitch} title={t.onboarding.localModelsTitle} />
  )
}

export function OpenRouterProviderRow({ onClick }: { onClick: () => void }) {
  const { t } = useI18n()

  return <KeyProviderRow onClick={onClick} pitch={t.onboarding.openRouterPitch} title="OpenRouter" />
}

export function ProviderRow({
  onSelect,
  provider
}: {
  onSelect: (provider: OAuthProvider) => void
  provider: OAuthProvider
}) {
  const { t } = useI18n()
  const freeTier = provider.status?.free_tier === true
  const loggedIn = provider.status?.logged_in && !freeTier
  const Trail = provider.flow === 'external' ? Terminal : ChevronRight

  return (
    <RowButton className={PROVIDER_ROW_CLASS} onClick={() => onSelect(provider)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-ui-sm font-semibold">
            {freeTier ? t.freeTier.providerRowTitle : providerTitle(provider)}
          </span>
          {freeTier ? <FreeTierTag /> : loggedIn ? <ConnectedTag /> : null}
        </div>
        <p className="mt-1 text-ui-xs text-fg-muted">{t.onboarding.flowSubtitles[provider.flow]}</p>
      </div>
      <Trail className="size-4 text-fg-muted transition group-hover:text-fg" />
    </RowButton>
  )
}
