"""Contract tests for tools/visualization_tool.py (inline visualization cards)."""

import json

from tools.visualization_tool import _handle_create_visualization


def _result(args):
    return json.loads(_handle_create_visualization(args))


def test_accepts_inline_html_and_cdn_script():
    html = (
        '<html><head><script src="https://cdn.jsdelivr.net/npm/echarts/dist/echarts.min.js"></script>'
        '</head><body><div id="c"></div></body></html>'
    )
    out = _result({"html": html, "title": "Chart"})
    assert out["success"] is True
    assert out["visualization"]["html"] == html
    assert out["visualization"]["title"] == "Chart"


def test_rejects_non_cdn_script_src_quoted_or_bare():
    for src in ('src="https://evil.example/x.js"', "src='https://evil.example/x.js'", "src=https://evil.example/x.js"):
        out = _result({"html": f"<script {src}></script>"})
        assert "error" in out and "cdn" in out["error"], src


def test_rejects_network_calls_and_frame_busting():
    for html in ("<script>fetch('/x')</script>", "<script>new WebSocket('wss://x')</script>",
                 "<script>top.location='https://x'</script>"):
        assert "error" in _result({"html": html}), html


def test_rejects_empty_and_oversized_html():
    assert "error" in _result({"html": "  "})
    assert "error" in _result({"html": "x" * 200_001})
