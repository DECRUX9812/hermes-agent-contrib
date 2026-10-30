import { Favicon } from '@/components/ui/favicon'
import { useMediaImage } from '@/hooks/use-media-image'

import { isPublicHost } from './public-host'

/** A site's icon, inline at 14px. Renders nothing for private hosts so the
 *  lookup never touches the LAN; the fixed empty fallback keeps local names
 *  from flashing a spinner. */
export function SiteFavicon({ host, url }: { host: string; url: string }) {
  if (!isPublicHost(host)) {
    return null
  }

  return (
    <span className="inline-grid size-3.5 shrink-0 place-items-center">
      <Favicon fallback={<span className="block size-full" />} url={url} />
    </span>
  )
}

/** A fixed-size screenshot tile: the box is always the same geometry so the
 *  row never reflows when the image resolves, and it vanishes on failure. */
export function ScreenshotThumb({ src }: { src: string }) {
  const image = useMediaImage(src, 16 / 10)

  if (image.failed) {
    return null
  }

  return (
    <span className="h-10 w-16 shrink-0 overflow-hidden rounded-control border border-line bg-surface-sunken">
      {image.src ? (
        <img
          alt=""
          aria-hidden
          className="h-full w-full object-cover object-top"
          onError={image.onError}
          onLoad={event => image.onLoad(event.currentTarget)}
          src={image.src}
        />
      ) : null}
    </span>
  )
}
