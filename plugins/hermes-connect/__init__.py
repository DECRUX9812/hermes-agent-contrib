"""hermes-connect (hermes-plus overlay): the onboarding Connect step's backend.

Everything lives in ``dashboard/``: ``connect.py`` (gh sign-in, Quick Tunnel) and ``plugin_api.py``
(routes mounted at ``/api/plugins/hermes-connect/``). Nothing registers on the agent.
"""


def register(ctx):  # noqa: ARG001 - dashboard-only plugin
    return None
