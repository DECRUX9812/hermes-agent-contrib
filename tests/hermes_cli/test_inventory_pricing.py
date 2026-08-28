"""Tests for inventory._apply_pricing — the pricing/tier enrichment that

feeds the desktop GUI model picker (and onboarding) so it can show $/Mtok
columns + Free/Pro badges and gate paid models on free Nous accounts, the
same way the `hermes model` CLI picker does.
"""

import hermes_cli.inventory as inv
import hermes_cli.models as models_mod


def _patch_pricing(monkeypatch, *, free_tier, pricing, unavailable=None):
    monkeypatch.setattr(models_mod, "get_pricing_for_provider", lambda slug, **kw: pricing.get(slug, {}))
    monkeypatch.setattr(models_mod, "check_nous_free_tier", lambda *, force_fresh=False: free_tier)
    monkeypatch.setattr(
        models_mod, "partition_nous_models_by_tier",
        lambda ids, pr, free_tier: (
            [m for m in ids if m not in (unavailable or [])],
            list(unavailable or []),
        ),
    )


def test_apply_pricing_formats_per_model_prices(monkeypatch):
    """Each model gets formatted input/output/cache + a free flag."""
    _patch_pricing(
        monkeypatch,
        free_tier=False,
        pricing={
            "openrouter": {
                "a/paid": {"prompt": "0.000003", "completion": "0.000015", "input_cache_read": "0.0000003"},
                "b/free": {"prompt": "0", "completion": "0"},
            }
        },
    )
    rows = [{"slug": "openrouter", "models": ["a/paid", "b/free"]}]
    inv._apply_pricing(rows)

    pricing = rows[0]["pricing"]
    assert pricing["a/paid"] == {"input": "$3.00", "output": "$15.00", "cache": "$0.30", "free": False}
    assert pricing["b/free"]["free"] is True
    assert pricing["b/free"]["input"] == "free"


def test_apply_pricing_free_models_get_flat_100_percent_sale(monkeypatch):
    """Free models show -100% chrome; was_* only when original was served."""
    _patch_pricing(
        monkeypatch,
        free_tier=False,
        pricing={
            "nous": {
                "a/free": {
                    "prompt": "0",
                    "completion": "0",
                    "original": {
                        "prompt": "0.000002",
                        "completion": "0.00001",
                    },
                },
                "b/natively-free": {
                    "prompt": "0",
                    "completion": "0",
                },
            }
        },
    )
    rows = [{"slug": "nous", "models": ["a/free", "b/natively-free"]}]
    inv._apply_pricing(rows)
    free = rows[0]["pricing"]["a/free"]
    assert free["free"] is True
    assert free["discount_percent"] == 100
    assert free["was_input"] == "$2.00"
    assert free["was_output"] == "$10.00"
    native = rows[0]["pricing"]["b/natively-free"]
    assert native["free"] is True
    assert native["discount_percent"] == 100
    # No gateway original → no fabricated was prices.
    assert "was_input" not in native
    assert "was_output" not in native


def test_apply_pricing_omits_sale_when_original_not_cheaper(monkeypatch):
    _patch_pricing(
        monkeypatch,
        free_tier=False,
        pricing={
            "nous": {
                "a/eq": {
                    "prompt": "0.000002",
                    "completion": "0.00001",
                    "original": {
                        "prompt": "0.000002",
                        "completion": "0.00001",
                    },
                },
            }
        },
    )
    rows = [{"slug": "nous", "models": ["a/eq"]}]
    inv._apply_pricing(rows)
    assert "discount_percent" not in rows[0]["pricing"]["a/eq"]


def test_apply_pricing_custom_openrouter_row_prices_from_catalog(monkeypatch):
    """A user-configured OpenRouter endpoint prices from the OpenRouter catalog."""
    seen: dict[str, bool] = {}

    def _fake_get(slug, *, force_refresh=False):
        seen[slug] = force_refresh
        return {
            "poolside/laguna-s-2.1:free": {"prompt": "0", "completion": "0"},
            "lab/paid": {"prompt": "0.000003", "completion": "0.000015"},
        }

    monkeypatch.setattr(models_mod, "get_pricing_for_provider", _fake_get)
    monkeypatch.setattr(models_mod, "check_nous_free_tier", lambda *, force_fresh=False: False)

    rows = [
        {
            "slug": "custom:openrouter",
            "name": "OpenRouter Free",
            "api_url": "https://openrouter.ai/api/v1",
            "models": ["poolside/laguna-s-2.1:free", "lab/paid"],
        },
        # Unrecognized custom endpoints must not price from anything.
        {
            "slug": "custom:mystery-proxy",
            "name": "Mystery Proxy",
            "api_url": "https://mystery.example/v1",
            "models": ["some-model"],
        },
    ]
    inv._apply_pricing(rows)

    assert set(seen) == {"openrouter", "custom:mystery-proxy"}
    pricing = rows[0]["pricing"]
    assert pricing["poolside/laguna-s-2.1:free"]["free"] is True
    assert pricing["lab/paid"] == {"input": "$3.00", "output": "$15.00", "cache": None, "free": False}
    assert "pricing" not in rows[1]


def test_apply_pricing_refresh_forces_fresh_fetch(monkeypatch):
    """Explicit refresh bypasses the pricing cache (Refresh Models)."""
    calls: list[tuple[str, dict]] = []

    def _fake_get(slug, *, force_refresh=False):
        calls.append((slug, {"force_refresh": force_refresh}))
        return {
            "a/paid": {"prompt": "0.000003", "completion": "0.000015"},
        }

    monkeypatch.setattr(models_mod, "get_pricing_for_provider", _fake_get)
    monkeypatch.setattr(models_mod, "check_nous_free_tier", lambda *, force_fresh=False: False)

    rows = [{"slug": "openrouter", "models": ["a/paid"]}]
    inv._apply_pricing(rows, refresh=True)
    assert calls == [("openrouter", {"force_refresh": True})]

    calls.clear()
    inv._apply_pricing(rows, refresh=False)
    assert calls == [("openrouter", {"force_refresh": False})]


