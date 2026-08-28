"""Measure campaign-target schema and prompt components on a checkout ref.

This intentionally measures the compact JSON sent to a model with the
``o200k_base`` tokenizer. It does not use credentials or call a provider.
"""
from __future__ import annotations

import argparse
import inspect
import json
import subprocess
import sys
from pathlib import Path

import tiktoken


def _wire(raw: dict) -> dict:
    if raw.get("type") == "function" and "function" in raw:
        return raw
    return {
        "type": "function",
        "function": {
            "name": raw["name"],
            "description": raw["description"],
            "parameters": raw["parameters"],
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("tree")
    args = parser.parse_args()
    tree = Path(args.tree).resolve()
    sys.path.insert(0, str(tree))

    from tools.clarify_tool import CLARIFY_SCHEMA
    from tools.computer_use.schema import COMPUTER_USE_SCHEMA
    from tools.cronjob_tools import CRONJOB_SCHEMA
    from tools.session_search_tool import SESSION_SEARCH_SCHEMA
    from tools.skill_manager_tool import SKILL_MANAGE_SCHEMA
    from tools.tool_search import bridge_tool_schemas

    schemas = {
        "cronjob": CRONJOB_SCHEMA,
        "computer_use": COMPUTER_USE_SCHEMA,
        "session_search": SESSION_SEARCH_SCHEMA,
        "skill_manage": SKILL_MANAGE_SCHEMA,
        "clarify": CLARIFY_SCHEMA,
    }
    try:
        bridge = bridge_tool_schemas([], config=None)
    except TypeError:
        bridge = bridge_tool_schemas([])
    for item in bridge:
        schemas[item["function"]["name"]] = item

    try:
        from tools.flux3_video_tool import (
            GET_RESULT_SCHEMA,
            IMAGE_TO_VIDEO_SCHEMA,
            KEYFRAMES_TO_VIDEO_SCHEMA,
            PROMPTING_GUIDE_SCHEMA,
            TEXT_TO_VIDEO_SCHEMA,
            VIDEO_CONTINUATION_SCHEMA,
        )
    except ImportError:
        pass
    else:
        schemas.update({
            "bfl_flux3_text_to_video": TEXT_TO_VIDEO_SCHEMA,
            "bfl_flux3_image_to_video": IMAGE_TO_VIDEO_SCHEMA,
            "bfl_flux3_keyframes_to_video": KEYFRAMES_TO_VIDEO_SCHEMA,
            "bfl_flux3_video_continuation": VIDEO_CONTINUATION_SCHEMA,
            "bfl_flux3_get_result": GET_RESULT_SCHEMA,
            "bfl_flux3_prompting_guide": PROMPTING_GUIDE_SCHEMA,
        })

    enc = tiktoken.get_encoding("o200k_base")
    rows = []
    for name, raw in schemas.items():
        wire = _wire(raw)
        encoded = json.dumps(wire, ensure_ascii=False, separators=(",", ":"))
        rows.append({"name": name, "tokens": len(enc.encode(encoded)), "chars": len(encoded)})

    prompt_tokens = 0
    prompt_chars = 0
    prompt_component = "absent"
    try:
        from agent.prompt_builder import computer_use_guidance
    except ImportError:
        pass
    else:
        prompt = computer_use_guidance("linux")
        prompt_tokens = len(enc.encode(prompt))
        prompt_chars = len(prompt)
        prompt_component = "computer_use_guidance"

    commit = subprocess.run(
        ["git", "-C", str(tree), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    print(json.dumps({
        "tree": str(tree),
        "commit": commit,
        "tokenizer": "o200k_base",
        "schema_rows": rows,
        "schema_total_tokens": sum(r["tokens"] for r in rows),
        "bridge_schema_tokens": sum(
            r["tokens"] for r in rows
            if r["name"] in {"tool_search", "tool_describe", "tool_call"}
        ),
        "campaign_schema_tokens": sum(
            r["tokens"] for r in rows
            if r["name"] not in {"tool_search", "tool_describe", "tool_call"}
        ),
        "system_prompt_component": prompt_component,
        "system_prompt_component_tokens": prompt_tokens,
        "system_prompt_component_chars": prompt_chars,
        "conditional_nous_subscription_block": "not measured; entitlement requires a live account",
    }, indent=2))


if __name__ == "__main__":
    main()
