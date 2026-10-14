import { resolveBrandIcon } from './brand-icon'

/** The brand mark for a host, or nothing. Lives apart from external-link so the
 *  ~150-icon table loads with the first link that needs it, not at boot. */
export function BrandGlyph({ className, host }: { className?: string; host: string }) {
  const Icon = resolveBrandIcon(host)

  // `title=""` is load-bearing: see LinkBrandIcon in ./external-link.
  return Icon ? <Icon aria-hidden className={className} title="" /> : null
}
