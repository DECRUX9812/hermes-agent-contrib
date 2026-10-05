"""Agent-callable "ship it" — the one-button commit/push/PR flow for the agent.

``git_ship`` stages, branches (optionally), commits and pushes the session's
repo; ``open_pr`` opens a GitHub pull request via ``gh``. Both reuse
``hermes_cli/web_git.py`` — the same audited subprocess layer the desktop
review pane's REST routes drive (noninteractive env, hardened argv, bounded
stderr) — so the GUI and the agent share one code path.
"""

import json
import os

from hermes_cli import web_git as _wg
from tools.registry import registry, tool_error


def _resolve_cwd(path: str | None, task_id: str | None) -> str:
    explicit = (path or "").strip()
    if explicit:
        return os.path.expanduser(explicit)
    # Lazy: terminal_tool's import chain pulls the environments package; keep
    # discovery cheap in minimal installs.
    from tools.terminal_tool import get_session_cwd
    return get_session_cwd(task_id) or os.getcwd()


def git_ship(path: str | None = None, branch: str | None = None, message: str | None = None,
             push: bool = False, files: list[str] | None = None, task_id: str | None = None) -> str:
    """Stage → (optionally) branch → commit → (optionally) push."""
    try:
        result = _wg.ship_commit(
            _resolve_cwd(path, task_id),
            (message or "").strip() or None,
            (branch or "").strip() or None,
            [f for f in (files or []) if f] or None,
            bool(push),
        )
    except RuntimeError as exc:
        return tool_error(str(exc))
    return json.dumps(result, ensure_ascii=False)


def open_pr(path: str | None = None, title: str | None = None, body: str | None = None,
            base: str | None = None, draft: bool = False, task_id: str | None = None) -> str:
    """Push (best-effort) then ``gh pr create``."""
    try:
        result = _wg.open_pr(
            _resolve_cwd(path, task_id),
            (title or "").strip() or None,
            (body or "").strip() or None,
            (base or "").strip() or None,
            bool(draft),
        )
    except RuntimeError as exc:
        return tool_error(str(exc))
    return json.dumps(result, ensure_ascii=False)


GIT_SHIP_SCHEMA = {
    "name": "git_ship",
    "description": (
        "Commit the session repo's working tree and optionally push — the "
        "one-button 'ship it' flow. Stages everything (or only `files`), "
        "optionally creates and switches to `branch`, commits with `message` "
        "(a conventional-commit fallback is generated when omitted), and "
        "pushes to the upstream or `origin <branch>` when push=true. Returns "
        "the commit sha, branch, change stats and upstream. Fails cleanly on "
        "a non-repo directory, an existing branch name, or a clean tree."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Repo root. Defaults to the session's working directory.",
            },
            "branch": {
                "type": "string",
                "description": "Create and switch to this new branch before committing. Refused if it already exists.",
            },
            "message": {
                "type": "string",
                "description": "Commit message (conventional style recommended). Generated when omitted.",
            },
            "files": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Stage only these paths instead of the whole tree.",
            },
            "push": {
                "type": "boolean",
                "description": "Push after committing (default false).",
            },
        },
        "required": [],
    },
}

OPEN_PR_SCHEMA = {
    "name": "open_pr",
    "description": (
        "Open a GitHub pull request for the current branch using gh. Pushes "
        "first when needed (best-effort), then creates the PR — with `title`/"
        "`body` when given, or gh's commit-derived --fill otherwise. Supports "
        "`base` and `draft`. Returns the PR url and number, or a clear error "
        "when gh is missing/unauthenticated or the branch has no commits "
        "ahead of the base."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Repo root. Defaults to the session's working directory.",
            },
            "title": {"type": "string", "description": "PR title. gh --fill is used when omitted."},
            "body": {"type": "string", "description": "PR body markdown. gh --fill is used when omitted."},
            "base": {"type": "string", "description": "Base branch (defaults to the repo's default)."},
            "draft": {"type": "boolean", "description": "Open as a draft PR (default false)."},
        },
        "required": [],
    },
}

registry.register(
    name="git_ship",
    toolset="git",
    schema=GIT_SHIP_SCHEMA,
    handler=lambda args, **kw: git_ship(
        path=args.get("path"), branch=args.get("branch"), message=args.get("message"),
        push=args.get("push", False), files=args.get("files"), task_id=kw.get("task_id"),
    ),
)

registry.register(
    name="open_pr",
    toolset="git",
    schema=OPEN_PR_SCHEMA,
    handler=lambda args, **kw: open_pr(
        path=args.get("path"), title=args.get("title"), body=args.get("body"),
        base=args.get("base"), draft=args.get("draft", False), task_id=kw.get("task_id"),
    ),
)
