/**
 * The single composition point where the pane installs its default
 * `TaskExecutor`, `ConversationSource` and scripted demo feed (architecture §11).
 *
 * All three are dev-harness scaffolding and arrive with the
 * presence-and-hangout milestone. Until then the pane honestly boots with none
 * of them, which is why this stub has a deliberate empty body: nothing outside
 * `dev-harness/` may import the harness, so the seam exists before the content.
 */
export function installPane3dDefaults(): void {
  // Intentionally empty until the dev harness lands.
}
