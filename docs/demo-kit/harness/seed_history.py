"""Seed a week of past usage into the demo HERMES_HOME so the Spend page has a real week to add up.
Rows go through SessionDB's own accounting (update_token_counts); costs are estimated by Hermes's pricing."""
import random, sys, time
sys.path.insert(0, "/home/user/hermes-agent-contrib")
from hermes_state import SessionDB
from pathlib import Path

home = Path(sys.argv[1])
db = SessionDB(home / "state.db")
random.seed(7)
WEEK = [
    ("claude-sonnet-4-5", "anthropic", "Refactor the billing module", 6),
    ("claude-sonnet-4-5", "anthropic", "Debug the flaky deploy", 5),
    ("deepseek-chat", "deepseek", "Summarize support tickets", 5),
    ("claude-sonnet-4-5", "anthropic", "Write the v2 release notes", 4),
    ("deepseek-chat", "deepseek", "Translate the docs to Spanish", 4),
    ("claude-sonnet-4-5", "anthropic", "Plan the launch week", 3),
    ("deepseek-chat", "deepseek", "Clean up the CSV export", 2),
    ("claude-sonnet-4-5", "anthropic", "Review the auth PR", 2),
    ("deepseek-chat", "deepseek", "Draft investor update", 1),
    ("claude-sonnet-4-5", "anthropic", "Fix the onboarding emails", 1),
]
now = time.time()
for i, (model, provider, title, days_ago) in enumerate(WEEK):
    sid = f"hist_{i:02d}"
    db.create_session(sid, source="desktop", model=model)
    db.set_session_title(sid, title)
    calls = random.randint(14, 40)
    sent = calls * random.randint(18000, 26000)
    cached = int(sent * random.uniform(0.78, 0.86))
    db.update_token_counts(sid, input_tokens=sent - cached, output_tokens=calls * random.randint(500, 900), cache_read_tokens=cached,
                           model=model, billing_provider=provider, api_call_count=calls, source="desktop")
    start = now - days_ago * 86400 - random.randint(600, 30000)
    db._conn.execute("UPDATE sessions SET started_at = ?, ended_at = ? WHERE id = ?", (start, start + random.randint(900, 5400), sid))
db._conn.commit()
db.flush_token_counts() if hasattr(db, "flush_token_counts") else None
print("seeded", len(WEEK))
