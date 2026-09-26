import { useStore } from '@nanostores/react'

import { FileDiffPanel } from '@/components/chat/diff-lines'
import { DiffSkeleton, TreeSkeleton } from '@/components/chat/skeletons'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DiffCount } from '@/components/ui/diff-count'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Tip } from '@/components/ui/tooltip'
import { useDelayedTrue } from '@/hooks/use-delayed-true'
import { useI18n } from '@/i18n'
import { displayPath } from '@/lib/display-path'
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview'
import { cn } from '@/lib/utils'
import { $panesFlipped } from '@/store/layout'
import { notify, notifyError } from '@/store/notifications'
import { openPreview } from '@/store/preview'
import {
  $reviewDiff,
  $reviewDiffLoading,
  $reviewFiles,
  $reviewIsRepo,
  $reviewLoading,
  $reviewRevertTarget,
  $reviewScopeMode,
  $reviewSelectedPath,
  $reviewTreeMode,
  cancelRevert,
  clearReviewSelection,
  closeReview,
  confirmRevert,
  draftDiffComment,
  formatDiffComment,
  refreshReview,
  requestRevert,
  type ReviewScopeMode,
  setReviewScopeMode,
  stageReviewFile,
  toggleReviewTreeMode,
  unstageReviewFile
} from '@/store/review'
import {
  $selfReview,
  $selfReviewRunning,
  clearSelfReview,
  runSelfReview,
  selfReviewForFile
} from '@/store/self-review'

import { SidebarPanelLabel } from '../../shell/sidebar-label'
import { PaneEmptyState, RightSidebarSectionHeader } from '../index'

import { AgentReviewMenu } from './agent-review-menu'
import { absolutePath, ReviewFileTree } from './file-tree'
import { ReviewShipBar } from './ship-bar'

// Compact header/diff action buttons — micro hit targets packed tight, matching
// the rest of the app's icon-action rows.
const ACTION_BTN = 'size-5'

export function ReviewPane() {
  const { t } = useI18n()
  const c = t.statusStack.coding
  const panesFlipped = useStore($panesFlipped)
  const files = useStore($reviewFiles)
  const loading = useStore($reviewLoading)
  const isRepo = useStore($reviewIsRepo)
  const selectedPath = useStore($reviewSelectedPath)
  const diff = useStore($reviewDiff)
  const diffLoading = useStore($reviewDiffLoading)
  const revertTarget = useStore($reviewRevertTarget)
  const treeMode = useStore($reviewTreeMode)
  const selfReview = useStore($selfReview)
  const selfReviewRunning = useStore($selfReviewRunning)
  const scopeMode = useStore($reviewScopeMode)
  const sessionScope = scopeMode === 'session'

  const selectedFile = files.find(file => file.path === selectedPath)
  const selectedComments = selectedFile ? selfReviewForFile(selectedFile.path, diff) : []

  const selfReviewTotal = Object.values(selfReview.files).reduce(
    (total, entry) => total + entry.comments.length,
    0
  )

  const hasFiles = files.length > 0
  // `{ path: null }` → revert all; `{ path: '…' }` → revert one file.
  const revertingAll = revertTarget?.path == null
  // Delay the skeletons so fast loads (most project switches) just blank → content
  // instead of flashing a jarring loading state.
  const showTreeSkeleton = useDelayedTrue(loading && !hasFiles)
  const showDiffSkeleton = useDelayedTrue(diffLoading)

  return (
    <aside
      aria-label={c.review}
      className={cn(
        'before:pointer-events-none relative flex h-full w-full min-w-0 flex-col overflow-hidden border-(--ui-stroke-secondary) bg-(--ui-sidebar-surface-background) pt-(--titlebar-height) text-(--ui-text-tertiary)',
        panesFlipped
          ? 'border-r shadow-[inset_-0.0625rem_0_0_color-mix(in_srgb,white_18%,transparent)]'
          : 'border-l shadow-[inset_0.0625rem_0_0_color-mix(in_srgb,white_18%,transparent)]'
      )}
    >
      {(loading || isRepo) && (
        <RightSidebarSectionHeader data-suppress-pane-reveal-side="">
          <div className="flex min-w-0 flex-1">
            {/* Pure self-naming label — redundant under a zone tab that already
                says "review", so the zone header hides it (styles.css). */}
            <SidebarPanelLabel data-pane-self-label="">{c.review}</SidebarPanelLabel>
          </div>
          <Tip label={treeMode === 'tree' ? c.viewAsList : c.viewAsTree}>
            <Button
              aria-label={treeMode === 'tree' ? c.viewAsList : c.viewAsTree}
              className={ACTION_BTN}
              disabled={!hasFiles}
              onClick={toggleReviewTreeMode}
              size="icon-xs"
              variant="ghost"
            >
              <Codicon name={treeMode === 'tree' ? 'list-flat' : 'list-tree'} size="0.8125rem" />
            </Button>
          </Tip>
          {/* Whole-tree actions stay on the working-tree scope: "stage all"
              against a session-filtered list would quietly stage files the
              view isn't showing. Agent review ships the whole-tree diff
              (commitContext), so it hides here too rather than lying about
              its scope. The self-review pass reviews the same working-tree
              diff, so it follows the same rule. */}
          {!sessionScope && (
            <>
              {/* Self-review: a one-shot utility-model pass over the working-tree
                  diff that lands comments inline on the diff below — a different
                  surface than AgentReviewMenu, which seeds a full agent session. */}
              <Tip label={selfReviewRunning ? c.selfReviewRunning : c.selfReview}>
                <Button
                  aria-label={c.selfReview}
                  className={ACTION_BTN}
                  disabled={!hasFiles || loading || selfReviewRunning}
                  onClick={() =>
                    void runSelfReview()
                      .then(() => {
                        const reviewed = $selfReview.get()

                        const total = Object.values(reviewed.files).reduce(
                          (count, entry) => count + entry.comments.length,
                          0
                        )

                        if (total === 0) {
                          notify({ kind: 'info', message: c.selfReviewClean })
                        }
                      })
                      .catch(error => notifyError(error, c.selfReview))
                  }
                  size="icon-xs"
                  variant="ghost"
                >
                  <Codicon name="sparkle" size="0.8125rem" spinning={selfReviewRunning} />
                </Button>
              </Tip>
              <AgentReviewMenu />
              <Tip label={c.stageAll}>
                <Button
                  aria-label={c.stageAll}
                  className={ACTION_BTN}
                  disabled={!hasFiles}
                  onClick={() => void stageReviewFile(null).catch(err => notifyError(err, c.stageAll))}
                  size="icon-xs"
                  variant="ghost"
                >
                  <Codicon name="add" size="0.8125rem" />
                </Button>
              </Tip>
              <Tip label={c.revertAll}>
                <Button
                  aria-label={c.revertAll}
                  className={ACTION_BTN}
                  disabled={!hasFiles}
                  onClick={() => requestRevert(null)}
                  size="icon-xs"
                  variant="ghost"
                >
                  <Codicon name="discard" size="0.8125rem" />
                </Button>
              </Tip>
            </>
          )}
          <Tip label={t.rightSidebar.refreshTree}>
            <Button
              aria-label={t.rightSidebar.refreshTree}
              className={ACTION_BTN}
              onClick={() => void refreshReview({ rescanSession: true })}
              size="icon-xs"
              variant="ghost"
            >
              <Codicon name="refresh" size="0.8125rem" spinning={loading} />
            </Button>
          </Tip>
          <Button aria-label={c.close} className={ACTION_BTN} onClick={closeReview} size="icon-xs" variant="ghost">
            <Codicon name="close" size="0.8125rem" />
          </Button>
        </RightSidebarSectionHeader>
      )}

      {/* Scope switch (#28): the whole working tree vs the session's own
          touched set. */}
      {(loading || isRepo) && (
        <div className="flex items-center px-2.5 pb-1" data-suppress-pane-reveal-side="">
          <SegmentedControl<ReviewScopeMode>
            onChange={setReviewScopeMode}
            options={[
              { id: 'uncommitted', label: c.scopeUncommitted },
              { id: 'session', label: c.scopeSession }
            ]}
            value={scopeMode}
          />
        </div>
      )}

      {loading || isRepo ? (
        hasFiles ? (
          <ReviewFileTree />
        ) : showTreeSkeleton ? (
          <TreeSkeleton />
        ) : loading ? (
          <div className="min-h-0 flex-1" />
        ) : (
          <PaneEmptyState label={sessionScope ? c.sessionEmpty : t.rightSidebar.noDiffs} />
        )
      ) : (
        // No repo at all → same terse empty state, just without the chrome.
        <PaneEmptyState label={t.rightSidebar.noDiffs} />
      )}

      {/* Selected file's diff — reuses the shiki-highlighted FileDiffPanel.
          `h-[55%]`, not `max-h-[55%]`: the panel below is virtualized, so it
          renders `absolute inset-0` and contributes no intrinsic height. With
          only a maximum this `shrink-0` box sized to its content — a 37px
          header plus a `flex-1` body whose basis is zero — and the diff
          collapsed to nothing. A definite height is what the windowed panel
          resolves its `h-full` against. */}
      {selectedFile && (
        <div className="flex h-[55%] shrink-0 flex-col border-t border-(--ui-stroke-secondary)">
          <div className="flex items-center gap-1 px-2.5 py-1.5" data-suppress-pane-reveal-side="">
            <span
              className="min-w-0 flex-1 truncate font-mono text-[0.66rem] text-(--ui-text-secondary)"
              title={displayPath(selectedFile.path)}
            >
              {displayPath(selectedFile.path)}
            </span>
            {(selectedComments.length > 0 || selfReviewTotal > 0) && (
              <Tip label={c.selfReviewClear}>
                <button
                  aria-label={c.selfReviewClear}
                  className="flex h-4 items-center gap-1 rounded-sm px-1 text-[0.62rem] text-(--ui-accent-secondary) hover:bg-(--ui-control-hover-background)"
                  onClick={clearSelfReview}
                  type="button"
                >
                  <Codicon name="comment" size="0.6875rem" />
                  {c.selfReviewComments(selectedComments.length || selfReviewTotal)}
                </button>
              </Tip>
            )}
            <DiffCount added={selectedFile.added} className="text-[0.64rem] leading-4" removed={selectedFile.removed} />
            {/* Open-in-editor: the file itself in the preview pane. */}
            <Tip label={c.openFile}>
              <Button
                aria-label={c.openFile}
                className={ACTION_BTN}
                onClick={() => {
                  void (async () => {
                    try {
                      const preview = await normalizeOrLocalPreviewTarget(absolutePath(selectedFile.path))

                      if (preview) {
                        openPreview(preview)
                      }
                    } catch (err) {
                      notifyError(err, t.rightSidebar.previewUnavailable)
                    }
                  })()
                }}
                size="icon-xs"
                variant="ghost"
              >
                <Codicon name="go-to-file" size="0.8rem" />
              </Button>
            </Tip>
            <Tip label={selectedFile.staged ? c.unstage : c.stage}>
              <Button
                aria-label={selectedFile.staged ? c.unstage : c.stage}
                className={ACTION_BTN}
                onClick={() =>
                  void (
                    selectedFile.staged ? unstageReviewFile(selectedFile.path) : stageReviewFile(selectedFile.path)
                  ).catch(err => notifyError(err, c.stage))
                }
                size="icon-xs"
                variant="ghost"
              >
                <Codicon name={selectedFile.staged ? 'remove' : 'add'} size="0.8rem" />
              </Button>
            </Tip>
            <Button
              aria-label={c.close}
              className={ACTION_BTN}
              onClick={clearReviewSelection}
              size="icon-xs"
              variant="ghost"
            >
              <Codicon name="close" size="0.8rem" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-1 pb-1">
            {diffLoading ? (
              showDiffSkeleton ? (
                <DiffSkeleton />
              ) : null
            ) : diff ? (
              <FileDiffPanel
                className="mx-0 mb-0 h-full max-h-none"
                comments={selectedComments}
                diff={diff}
                onDiffComment={({ endLine, startLine, text }) => {
                  // Comment lands as a composer draft for the scoped session —
                  // nothing is ever sent from here (#29).
                  void draftDiffComment(formatDiffComment(selectedFile.path, startLine, endLine, text)).then(ok => {
                    if (ok) {
                      notify({ kind: 'info', message: c.commentSeeded })
                    }
                  })
                }}
                path={selectedFile.path}
                virtualized
              />
            ) : (
              <div className="py-6 text-center text-[0.66rem] text-muted-foreground/60">{c.noDiff}</div>
            )}
          </div>
        </div>
      )}

      <ReviewShipBar />

      <ConfirmDialog
        confirmLabel={revertingAll ? c.revertAll : c.revert}
        description={
          <>
            {revertingAll ? c.revertAllConfirm : c.revertConfirm}
            {!revertingAll && revertTarget?.path && (
              <span
                className="mt-2 block truncate font-mono text-[0.7rem] text-(--ui-text-secondary)"
                title={displayPath(revertTarget.path)}
              >
                {displayPath(revertTarget.path)}
              </span>
            )}
          </>
        }
        destructive
        // confirmRevert closes the dialog itself, then reverts in the
        // background — so the failure lands in a toast, not inline.
        dismissOnConfirm
        onClose={cancelRevert}
        onConfirm={() => confirmRevert().catch(err => void notifyError(err, c.revert))}
        open={revertTarget !== undefined}
        title={revertingAll ? c.revertAll : c.revert}
      />
    </aside>
  )
}
