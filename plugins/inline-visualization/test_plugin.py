#!/usr/bin/env python3
"""Functional test for the inline-visualization plugin (no Hermes host needed)."""
import importlib.util, json, os, sys, tempfile, types

PLUG = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("HERMES_CORE") or os.path.expanduser("~/Code/hermes-overlay-core")
tmp = tempfile.mkdtemp(prefix="viztest-")
os.environ["HERMES_HOME"] = os.path.join(tmp, "home")
sys.path.insert(0, REPO)

pkg = types.ModuleType("inline_viz")
pkg.__path__ = [PLUG]
sys.modules["inline_viz"] = pkg
spec = importlib.util.spec_from_file_location("inline_viz", os.path.join(PLUG, "__init__.py"))
mod = importlib.util.module_from_spec(spec)
mod.__path__ = [PLUG]
sys.modules["inline_viz"] = mod
spec.loader.exec_module(mod)

ok = []
def check(label, cond):
    ok.append(cond); print(("  PASS  " if cond else "  FAIL  ") + label)

print("--- 1. happy path: tool creates a frame, hook attaches the directive ---")
res = json.loads(mod.create_visualization("<html><body><h1>hi</h1></body></html>",
                                          "Test Chart", session_id="s1"))
check("tool reports success", res.get("success") is True)
check("frame exists on disk", os.path.exists(res.get("file", "")))
out = mod.on_transform_llm_output(response_text="Here is the data.", session_id="s1")
check("hook appended a ::preview directive", out is not None and '::preview{file="' in out)
check("agent text preserved verbatim", out.startswith("Here is the data.") if out else False)
check("directive points at the frame", res["file"] in out if out else False)

print("--- 2. a turn with no card is left byte-identical (None) ---")
check("untouched turn -> None", mod.on_transform_llm_output(response_text="just prose", session_id="other") is None)

print("--- 3. second drain does not duplicate ---")
mod.create_visualization("<html><body>x</body></html>", "Second", session_id="s2")
first = mod.on_transform_llm_output(response_text="r", session_id="s2")
check("first drain attaches", first is not None)
check("second drain -> None", mod.on_transform_llm_output(response_text="r", session_id="s2") is None)

print("--- 4. validation ---")
for label, html, want_ok in [
    ("network fetch rejected", "<html><script>fetch('/x')</script></html>", False),
    ("frame-busting rejected", "<html><script>top.location='http://x'</script></html>", False),
    ("evil script host rejected", '<html><script src="https://evil.example/x.js"></script></html>', False),
    ("unquoted src rejected (!)", "<html><script src=https://evil.example/x.js></script></html>", False),
    ("jsdelivr allowed", '<html><script src="https://cdn.jsdelivr.net/npm/chart.js"></script></html>', True),
    ("cookie access rejected", "<html><script>document.cookie</script></html>", False),
    ("plain html allowed", "<html><body>ok</body></html>", True),
]:
    cfg = mod.settings()
    got_ok = mod.validate_html(html, cfg) is None
    check(f"{label}", got_ok == want_ok)

print("--- 5. ledger ---")
from inline_viz import viz_frames
recs = viz_frames.tail(10, os.environ["HERMES_HOME"] and "")
check("ledger has records", len(recs) >= 1)
check("ledger recorded the creation", any(r.get("event") == "created" for r in recs))

print(f"\n{sum(ok)}/{len(ok)} checks passed")
sys.exit(0 if all(ok) else 1)
