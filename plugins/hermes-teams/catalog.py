"""Roles and team templates: built-ins plus user YAML under ``<root>/teams/``.

Both live in the install root, not a profile home: like the Kanban board, a team spans profiles.

``teams/roles/<id>.yaml``::

    name: Security reviewer
    emoji: "🛡"
    summary: Reviews changes for vulnerabilities.
    soul: |
      You are ...
    model: anthropic/claude-sonnet-4.6   # optional, pins the worker model
    provider: openrouter                  # optional, needs model

``teams/templates/<id>.yaml``::

    name: Feature
    summary: Plan, build and test, then review.
    steps:
      - {key: plan, role: analyst, title: Plan the change}
      - {key: build, role: developer, needs: [plan]}
      - {key: review, role: reviewer, needs: [build], final: true}

A user file with a built-in's id replaces it.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Optional

PROFILE_PREFIX = "team-"


class TeamsError(ValueError):
    """A refusal the client can show verbatim."""


@dataclass(frozen=True)
class Role:
    id: str
    name: str
    emoji: str
    summary: str
    soul: str
    model: Optional[str] = None
    provider: Optional[str] = None
    builtin: bool = True

    @property
    def profile(self) -> str:
        return f"{PROFILE_PREFIX}{self.id}"

    def view(self) -> dict[str, Any]:
        out = asdict(self)
        out["profile"] = self.profile
        return out


@dataclass(frozen=True)
class Step:
    key: str
    role: str
    title: str
    instructions: str = ""
    needs: tuple[str, ...] = ()
    final: bool = False


@dataclass(frozen=True)
class Template:
    id: str
    name: str
    summary: str
    steps: tuple[Step, ...]
    builtin: bool = True

    def view(self) -> dict[str, Any]:
        return {
            "id": self.id, "name": self.name, "summary": self.summary, "builtin": self.builtin,
            "steps": [asdict(s) | {"needs": list(s.needs)} for s in self.steps],
        }


def _soul(title: str, mission: str, rules: list[str]) -> str:
    bullets = "\n".join(f"- {r}" for r in rules)
    return f"# {title}\n\n{mission}\n\n## How you work\n{bullets}\n"


_HANDOFF = "Finish with a short handoff: what you did, what is left, and anything the next teammate must know."

BUILTIN_ROLES: dict[str, Role] = {r.id: r for r in (
    Role("analyst", "Analyst", "🧭", "Turns a goal into a concrete plan with acceptance criteria.", _soul(
        "Analyst", "You turn a goal into a plan someone else can build without asking you questions.",
        ["Read the code and context before planning.", "List the files to touch and the acceptance criteria.",
         "Call out risks and open questions instead of guessing.", _HANDOFF])),
    Role("developer", "Developer", "🛠", "Implements the plan and keeps the change small.", _soul(
        "Developer", "You implement the plan you are handed, completely and with the smallest diff that does it.",
        ["Follow the repository's conventions and instructions files.", "Run the relevant tests and fix what fails.",
         "Do not widen scope; note follow-ups instead.", _HANDOFF])),
    Role("qa", "QA", "🧪", "Writes and runs tests that prove the change works.", _soul(
        "QA engineer", "You prove the change works, and find where it does not.",
        ["Write behaviour tests for the acceptance criteria.", "Exercise edge cases and failure paths.",
         "Report failures with exact reproduction steps.", _HANDOFF])),
    Role("reviewer", "Reviewer", "🔍", "Reviews the finished work and gates it.", _soul(
        "Reviewer", "You review the team's finished work and decide whether it is ready.",
        ["Check correctness first, then tests, then style.", "Only flag issues you can point to in the code.",
         "Approve, or block with the exact work still missing.", _HANDOFF])),
    Role("researcher", "Researcher", "📚", "Finds and verifies sources.", _soul(
        "Researcher", "You find what is true, with sources a reader can check.",
        ["Prefer primary sources and say how fresh they are.", "Separate facts, claims and your own inference.",
         "Quote sparingly and link everything.", _HANDOFF])),
    Role("writer", "Writer", "✍", "Turns research into a clear brief.", _soul(
        "Writer", "You turn your teammates' findings into a brief a busy reader can act on.",
        ["Lead with the answer.", "Keep only what the reader needs; cite sources inline.",
         "Flag disagreements between sources instead of hiding them.", _HANDOFF])),
)}

BUILTIN_TEMPLATES: dict[str, Template] = {t.id: t for t in (
    Template("feature", "Feature", "Plan, build and test in parallel, then review.", (
        Step("plan", "analyst", "Plan the change"),
        Step("build", "developer", "Build it", needs=("plan",)),
        Step("tests", "qa", "Test it", needs=("plan",)),
        Step("review", "reviewer", "Review and gate", needs=("build", "tests"), final=True),
    )),
    Template("research-brief", "Research brief", "Two researchers in parallel, then one brief.", (
        Step("primary", "researcher", "Primary sources",
             "Find primary sources: papers, specs, official docs, data."),
        Step("practice", "researcher", "Practice and field reports",
             "Find how practitioners use it: case studies, issues, talks, benchmarks."),
        Step("brief", "writer", "Write the brief", needs=("primary", "practice"), final=True),
    )),
)}


def teams_root() -> Path:
    from hermes_constants import get_default_hermes_root

    return get_default_hermes_root() / "teams"


def _yaml_files(kind: str) -> list[Path]:
    folder = teams_root() / kind
    return sorted(folder.glob("*.yaml")) if folder.is_dir() else []


def _load(path: Path) -> dict:
    from utils import load_yaml_file_readonly

    try:
        data = load_yaml_file_readonly(path) or {}
    except Exception as exc:  # the parser's error types are the YAML backend's own
        raise TeamsError(f"{path.name}: {exc}") from exc
    if not isinstance(data, dict):
        raise TeamsError(f"{path.name}: expected a mapping")
    return data


def _text(data: dict, key: str, where: str, default: Optional[str] = None) -> str:
    value = data.get(key, default)
    if not isinstance(value, str) or not value.strip():
        raise TeamsError(f"{where}: '{key}' is required")
    return value.strip()


def role_from_dict(role_id: str, data: dict, *, builtin: bool = False) -> Role:
    where = f"role {role_id}"
    model, provider = data.get("model") or None, data.get("provider") or None
    if provider and not model:
        raise TeamsError(f"{where}: 'provider' needs 'model'")
    return Role(role_id, _text(data, "name", where), str(data.get("emoji") or "🤖"),
                str(data.get("summary") or ""), _text(data, "soul", where), model, provider, builtin)


def template_from_dict(template_id: str, data: dict, *, builtin: bool = False) -> Template:
    where = f"template {template_id}"
    raw = data.get("steps")
    if not isinstance(raw, list) or not raw:
        raise TeamsError(f"{where}: 'steps' must be a non-empty list")
    steps = []
    for i, item in enumerate(raw, start=1):
        if not isinstance(item, dict):
            raise TeamsError(f"{where}: step {i} must be a mapping")
        key = _text(item, "key", f"{where} step {i}")
        needs = item.get("needs") or []
        if not isinstance(needs, list) or not all(isinstance(n, str) for n in needs):
            raise TeamsError(f"{where} step {key}: 'needs' must be a list of step keys")
        steps.append(Step(key, _text(item, "role", f"{where} step {key}"), str(item.get("title") or key),
                          str(item.get("instructions") or ""), tuple(needs), bool(item.get("final"))))
    template = Template(template_id, _text(data, "name", where), str(data.get("summary") or ""), tuple(steps), builtin)
    validate_template(template)
    return template


def validate_template(template: Template) -> None:
    """Unique keys, known ``needs``, no cycles, exactly one final step."""
    where = f"template {template.id}"
    keys = [s.key for s in template.steps]
    if len(set(keys)) != len(keys):
        raise TeamsError(f"{where}: step keys must be unique")
    known = set(keys)
    for step in template.steps:
        unknown = [n for n in step.needs if n not in known]
        if unknown:
            raise TeamsError(f"{where} step {step.key}: unknown needs {unknown}")
    finals = [s.key for s in template.steps if s.final]
    if len(finals) != 1:
        raise TeamsError(f"{where}: exactly one step must be final (found {len(finals)})")
    topo_order(template)


def topo_order(template: Template) -> list[Step]:
    by_key = {s.key: s for s in template.steps}
    done: dict[str, bool] = {}
    order: list[Step] = []

    def visit(key: str, trail: tuple[str, ...]) -> None:
        if done.get(key):
            return
        if key in trail:
            raise TeamsError(f"template {template.id}: steps form a cycle through {' -> '.join(trail + (key,))}")
        for need in by_key[key].needs:
            visit(need, trail + (key,))
        done[key] = True
        order.append(by_key[key])

    for step in template.steps:
        visit(step.key, ())
    return order


def roles() -> dict[str, Role]:
    out = dict(BUILTIN_ROLES)
    for path in _yaml_files("roles"):
        out[path.stem] = role_from_dict(path.stem, _load(path))
    return out


def templates() -> dict[str, Template]:
    out = dict(BUILTIN_TEMPLATES)
    for path in _yaml_files("templates"):
        out[path.stem] = template_from_dict(path.stem, _load(path))
    return out


def get_role(role_id: str) -> Role:
    found = roles().get(role_id)
    if found is None:
        raise TeamsError(f"no role '{role_id}'")
    return found


def get_template(template_id: str) -> Template:
    found = templates().get(template_id)
    if found is None:
        raise TeamsError(f"no team template '{template_id}'")
    return found


def ensure_role_bot(role: Role, *, clone_from: Optional[str] = None) -> tuple[str, bool]:
    """Create the role's profile if missing; returns ``(profile, created)``.

    The profile clones the source profile's config so it inherits a working model and keys (never
    its messaging channels, which ``create_profile`` strips), then takes the role's SOUL.md.
    """
    from hermes_cli.profiles import create_profile, profile_exists

    if profile_exists(role.profile):
        return role.profile, False
    create_profile(role.profile, clone_from=clone_from, clone_config=True, soul=role.soul,
                   description=f"{role.name} — {role.summary}" if role.summary else role.name)
    return role.profile, True
