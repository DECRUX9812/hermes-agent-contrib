# Hermes design standard

The short rules every desktop screen follows. The full visual and interaction contract (tokens,
type scale, motion, components) is `apps/desktop/DESIGN.md`; this page is the bar a change is
reviewed against.

1. **Every screen answers three questions, in order:** what is happening, does it need me, and
   what do I do next.
2. **Three zones at most:** left nav, centre stage, right drawer, plus the slim plugin rail on the
   far left, which is always visible (never hidden behind Simple mode). Chat prose is at most
   about 72ch wide. The right context/computer drawer (about 380–440 px) is closed by default in a
   normal chat; it opens when a bot runs a live browser or terminal tool, or when the user clicks
   the bot or room header.
3. **Hierarchy through spacing and type, not boxes.** No card-in-card fills, no redundant borders,
   dividers or shadows. No hardcoded hex colours or arbitrary spacing: use the tokens.
4. **Numbers** (cost, tokens, durations, SHAs) use `font-mono tabular-nums`. **One status
   vocabulary** everywhere: running (accent pulse), queued (muted), needs approval (amber), done
   (green), error (red), drawn by one `StatusBadge`; one `ToolStepRow`; one `ApprovalCard`.
5. **Tool calls are one-line pills:** icon, name, live status, and a small thumbnail for browser
   steps. A finished run folds into "Used N tools · 3.4s". Clicking a pill opens the right drawer
   at that step.
6. **Questions are inline option chips** plus "Something else…". **Approvals are inline**
   [Allow once] [Always allow] [Deny] above the composer, and persisted. No blocking modals.
7. **No layout shift:** scroll anchoring so streaming and folding never jump the view. The
   composer never blocks: a message sent while the bot works queues (a queued pill) or steers the
   run. Keep the model picker, reasoning effort pill and mic in the composer.
8. **Team mode is a goal-first board:** a goal bar with total cost and a Needs-you filter; columns
   Queued, In progress, Needs approval, Done; cards with the bot, a live tool pill, Stop and
   Inspect. Inspect opens that bot's stream and computer in the right drawer without leaving the
   board.
