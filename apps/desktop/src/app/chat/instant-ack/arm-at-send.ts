import { receiptFromPrompt } from './receipt'
import { armInstantAck } from './store'

/**
 * Arm the Part A receipt for a send that is about to start a turn.
 *
 * Deliberately synchronous and allocation-light: this runs inside the Enter
 * handler, on the same tick as the draft clear, so the row is on screen before
 * the gateway has been asked anything. A prompt with nothing restatable (an
 * attachment-only send, a bare URL) arms nothing — the ordinary spinner is more
 * honest than "Got it — ".
 *
 * Returns whether a receipt was armed, so a caller (or a test) can assert the
 * send path took it without reaching into the store.
 */
export function armReceiptForSend(key: string | null | undefined, text: string): boolean {
  const receipt = receiptFromPrompt(text)

  if (!receipt) {
    return false
  }

  return armInstantAck(key, receipt.text) !== null
}
