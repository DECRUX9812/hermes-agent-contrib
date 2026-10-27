"""Pure tests for the Hermes Browser frame-policy parser (no network, no browser)."""
import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("wv", Path(__file__).resolve().parent.parent / "dashboard" / "web_view.py")
wv = importlib.util.module_from_spec(spec)
sys.modules["wv"] = wv
spec.loader.exec_module(wv)

T = "https://site.test/page"
V = "https://app.test"


def fp(headers, viewer=V, target=T):
    return wv.frame_policy(headers, target, viewer)


def test_no_headers_embeddable():
    assert fp([]) == (True, None)


def test_xfo_deny_and_sameorigin():
    assert fp([("X-Frame-Options", "DENY")]) == (False, "x-frame-options")
    assert fp([("x-frame-options", "SAMEORIGIN")]) == (False, "x-frame-options")
    assert fp([("x-frame-options", "SAMEORIGIN")], viewer="https://site.test") == (True, None)


def test_xfo_allow_from_is_ignored():
    assert fp([("X-Frame-Options", "ALLOW-FROM https://x.test")]) == (True, None)


def test_csp_none_self_star():
    assert fp([("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'")]) == (False, "csp")
    assert fp([("Content-Security-Policy", "frame-ancestors 'self'")]) == (False, "csp")
    assert fp([("Content-Security-Policy", "frame-ancestors 'self'")], viewer="https://site.test") == (True, None)
    assert fp([("Content-Security-Policy", "frame-ancestors *")]) == (True, None)


def test_csp_overrides_xfo():
    assert fp([("X-Frame-Options", "DENY"), ("Content-Security-Policy", "frame-ancestors https://app.test")]) == (True, None)


def test_csp_hosts_wildcards_ports_schemes():
    h = lambda v: [("Content-Security-Policy", f"frame-ancestors {v}")]
    assert fp(h("*.app.test"), viewer="https://x.app.test") == (True, None)
    assert fp(h("*.app.test"), viewer="https://app.test") == (False, "csp")
    assert fp(h("https:")) == (True, None)
    assert fp(h("https:"), viewer="http://app.test") == (False, "csp")
    assert fp(h("http://app.test:8080"), viewer="http://app.test:8080") == (True, None)
    assert fp(h("http://app.test"), viewer="http://app.test:8080") == (False, "csp")
    assert fp(h("app.test:*"), viewer="http://app.test:9") == (True, None)


def test_every_csp_policy_must_allow():
    headers = [("Content-Security-Policy", "frame-ancestors *"), ("Content-Security-Policy", "frame-ancestors 'none'")]
    assert fp(headers) == (False, "csp")


def test_no_viewer_origin():
    assert fp([("Content-Security-Policy", "frame-ancestors https://a.test")], viewer=None) == (False, "csp")


def test_loopback_and_url_check():
    assert wv.is_loopback("http://localhost:5173/")
    assert wv.is_loopback("http://127.0.0.1:3000")
    assert wv.is_loopback("http://[::1]:3000")
    assert not wv.is_loopback("https://example.com")
    for bad in ("file:///etc/passwd", "javascript:alert(1)", "ftp://x", ""):
        try:
            wv.checked_url(bad)
        except ValueError:
            continue
        raise AssertionError(bad)
