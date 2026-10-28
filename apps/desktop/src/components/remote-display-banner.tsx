// The remote-display notice is retired. It surfaced as a toast at bottom-right
// ("Software rendering active — remote display…") that sat on top of the
// composer and read as a burned-in watermark over an empty chat.
//
// The component stays exported because the app shell mounts it; it renders and
// announces nothing.
export function RemoteDisplayBanner() {
  return null
}
