/**
 * Render-failure containment for Bot Mode surfaces.
 *
 * The plugin registered no boundary anywhere: one throw inside the context
 * panel, a room row or the group workspace blanked the surface and left the
 * user with an empty pane and no next action. A boundary here keeps the
 * failure inside the surface that caused it — the rail, the roster and the
 * rest of the window keep rendering — and hands back a Retry that rebuilds
 * just that subtree.
 *
 * Retry works on React's own terms: clearing `error` re-mounts the children
 * from scratch, which is the only recovery React offers a class boundary.
 * The fallback is the app's canonical `ErrorState`, so a Bot Mode failure
 * looks like every other failure in the product rather than a blank box.
 */

import { Button, ErrorState, useI18n } from '@hermes/plugin-sdk'
import { Component, type ErrorInfo, type ReactNode } from 'react'

import { useBots } from './i18n'

interface BoundaryProps {
  children: ReactNode
  /** The surface name for the trace line — never rendered. */
  surface: string
}

interface BoundaryState {
  error: Error | null
}

class Boundary extends Component<BoundaryProps & { copy: { body: string; retry: string; title: string } }, BoundaryState> {
  state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Evidence first: the trace names the surface so a report from a user can
    // be matched to a boundary instead of "the bots tab is empty".
    console.error(`[hermes-bots] ${this.props.surface} failed to render`, error, info.componentStack)
  }

  private reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state

    if (!error) {
      return this.props.children
    }

    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center p-4">
        <ErrorState description={this.props.copy.body} title={this.props.copy.title}>
          <Button onClick={this.reset} variant="secondary">
            {this.props.copy.retry}
          </Button>
        </ErrorState>
      </div>
    )
  }
}

/** Hook face of the boundary — `useBots()` and core's Retry label resolved
 *  once, so call sites stay one line. */
export function BotModeBoundary({ children, surface }: BoundaryProps) {
  const b = useBots()
  const { t } = useI18n()

  return (
    <Boundary copy={{ body: b.errors.body, retry: t.common.retry, title: b.errors.title }} surface={surface}>
      {children}
    </Boundary>
  )
}
