/**
 * Shared timeline meta-line: inter-agent delivery notes, steer/slash status,
 * collapsed replies. One class on the type scale instead of per-file copies
 * of the same arbitrary sizes; the expandable body inside drops the nested
 * border — hierarchy comes from spacing and type.
 */

/** The centered notice row itself. Call sites add their layout
 *  (flex direction, gap) and alignment on top. */
export const META_LINE_CLASS =
  'max-w-[min(86%,44rem)] self-center px-2 py-0.5 text-ui-2xs leading-5 text-muted-foreground/60'

/** The expandable body of a delivered inter-agent message: no border, spacing
 *  and type only. Call sites add the text treatment they need. */
export const META_LINE_BODY_CLASS = 'mt-1 max-w-[36rem] px-3 py-2 text-left text-ui-xs leading-5 text-foreground/85'
