"""Scripted OpenAI-compatible model for the Hermes demo video.

Reacts to natural sentences (never visible trigger codes): bot introductions, a bot topic
question, a single-listener group chat where the lead delegates, and an MCP App tool call.
Streams like a real model so the UI shows typing."""
import json, re, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 18999
LOG = open(sys.argv[2] if len(sys.argv) > 2 else "/dev/null", "a")

def text_of(m):
    c = m.get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "\n".join(p.get("text", "") for p in c if isinstance(p, dict))
    return ""

INTROS = {
    "nova": "Hi, I'm Nova ✨ I'll plan your week and keep you on track. What's on your plate?",
    "scout": "Hi, I'm Scout 👋 I dig up sources and cite everything I find. What should I look into first?",
    "forge": "Forge here. I write and review code in small, tested diffs. Point me at a repo and a goal.",
    "pilot": "Pilot online. I run checks, schedules and deploys, and I always confirm before anything irreversible.",
}

import os
_HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN_PATH = os.path.join(_HERE, "sandbox", "hermes-home", "desktop-plugins", "launch-countdown", "plugin.js")
PLUGIN_SRC = open(os.path.join(_HERE, "launch_countdown_plugin.js"), encoding="utf-8").read()

HIRE = [
    ("Hiring a researcher to lead.", 'hermes bots create scout --title Scout --role "Research lead — finds, reads and cites" --persona "Cite every claim." --color "#3b82f6"'),
    ("Now an engineer.", 'hermes bots create forge --title Forge --role "Engineer — small, tested diffs" --color "#f59e0b"'),
    ("And someone to ship it.", 'hermes bots create pilot --title Pilot --role "Ops — checks, schedules and deploys" --color "#10b981"'),
    ("Wiring them into a team with Scout as lead.",
     'hermes bots team create "Launch crew" --mission "Ship v2 on Thursday" && '
     'hermes bots team add "Launch crew" scout --lead --title Lead && '
     'hermes bots team add "Launch crew" forge --reports-to scout --title Engineer && '
     'hermes bots team add "Launch crew" pilot --reports-to scout --title Ops'),
]

def _plugin(pid, source=None):
    return (os.path.join(_HERE, "sandbox", "hermes-home", "desktop-plugins", pid, "plugin.js"),
            open(os.path.join(_HERE, "plugins", source or pid, "plugin.js"), encoding="utf-8").read())

TIMER = '::timer{minutes="25" label="Deep work"}'
FLOW = '::flow{title="Launch plan" steps="Draft|Review|Ship"}'

# v2 film: (keywords, plugin id, source dir, line while writing, reply once loaded, think seconds)
PLUGINS_V2 = [
    (("feel", "synthwave"), "synthwave", None, "Repainting everything. Palette, light and motion in one file.",
     "Welcome to the night drive. Same app, new world. Ask me to change any of it.", 1.2),
    (("see", "agents"), "mission-control", None, "Building you a control room.",
     "Mission Control is in your sidebar. Every chat is a star; the ones working right now are lit.", 1.0),
    (("gold",), "pulse", "pulse-gold", "Editing Pulse.",
     "Done: gold, twice as fast, denser. Plugins are just files I can change.", 1.0),
    (("focus", "timer"), "focus-timer", None, "Adding timers to the chat.",
     "Here you go:\n\n" + TIMER + "\n\nIt keeps counting in your status bar.", 1.4),
    (("flow",), "flow", None, "Teaching the chat to draw flows you can edit.",
     "Here's the launch:\n\n" + FLOW + "\n\nClick a step to rename it, or add one anywhere.", 1.2),
    (("money",), "spend", None, "Adding up your week.",
     "It's in your sidebar under **Spend**. Most of what you send is read from cache, so it costs far less than it looks.", 1.0),
]

PROJECT = os.path.join(_HERE, "sandbox", "projects", "launch-site")
THEME_JS = """// Dark mode: follows the system, remembers the user's choice.
const KEY = 'theme'
const root = document.documentElement
const saved = localStorage.getItem(KEY)
const dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches

export function setTheme(next) {
  root.dataset.theme = next
  localStorage.setItem(KEY, next)
}

setTheme(dark ? 'dark' : 'light')
document.querySelector('#theme-toggle')?.addEventListener('click', () =>
  setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'))
"""
THEME_TEST = """import { test, expect } from 'vitest'
import { setTheme } from './theme.js'

test('the toggle flips and remembers the theme', () => {
  setTheme('dark')
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(localStorage.getItem('theme')).toBe('dark')
})
"""
# Developer film: (keywords, file in the project, content, line while writing, reply)
DEV_EDITS = [
    (("dark mode",), "theme.js", THEME_JS, "Adding a theme toggle.",
     "Added **theme.js**: follows the system, remembers your choice. It's open in VS Code next to us."),
    (("tests",), "theme.test.js", THEME_TEST, "Writing the test.",
     "theme.test.js covers the toggle. Same chat, now from the terminal."),
]

# Background work the demo starts in other chats, so Mission Control has something to watch.
BACKGROUND = ("Research", "Draft", "Review", "Summarize", "Audit", "Translate")

CHART = '::chart{title="Signups this week" values="120,164,210,248,331,402,518" labels="Mon,Tue,Wed,Thu,Fri,Sat,Sun"}'

# (keywords, plugin id, line while writing, reply once loaded, seconds to "think" before the reply)
PLUGINS = [
    (("pulse",), "pulse", "Writing a Pulse plugin. One file; the app loads it the moment it lands.",
     "That's me. I idle slowly while I listen and light up while I think. Ask me something hard and watch.", 3.2),
    (("chart", "signup"), "chart", "I'll teach the chat to draw first.",
     "Signups are up 4x this week:\n\n" + CHART + "\n\nSaturday's launch post did most of it.", 2.5),
    (("cyanotype",), "cyanotype", "Mixing a cyanotype theme.",
     "Prussian blue and paper, like a sun print. It's in Appearance now if you want to switch back.", 1.5),
]

def me_from(system):
    m = re.search(r"You are `@([a-z0-9_-]+)`", system) or re.search(r"You are @([a-z0-9_-]+)", system)
    return m.group(1).lower() if m else ""

def decide(body):
    msgs = body.get("messages", [])
    system = "\n".join(text_of(m) for m in msgs if m.get("role") == "system")
    last = msgs[-1] if msgs else {}
    last_user = next((text_of(m) for m in reversed(msgs) if m.get("role") == "user"), "")
    low = last_user.lower()
    if "hire" in low and "crew" in low:
        done = sum(1 for m in msgs[msgs.index(next(m for m in reversed(msgs) if m.get("role") == "user")):] if m.get("role") == "tool")
        if done < len(HIRE):
            say, cmd = HIRE[done]
            return {"text": say, "tool_calls": [{"name": "terminal", "args": {"command": cmd}}]}
        return {"text": "Your **Launch crew** is hired. **Scout** leads, **Forge** builds, **Pilot** ships. Put them in a room and only Scout will listen; the rest wake when they're needed."}
    for keys, rel, content, writing, done_text in DEV_EDITS:
        if all(k in low for k in keys):
            turn = msgs[max(i for i, m in enumerate(msgs) if m.get("role") == "user"):]
            if not any(m.get("role") == "tool" for m in turn):
                return {"text": writing, "tool_calls": [{"name": "write_file", "args": {"path": os.path.join(PROJECT, rel), "content": content}}]}
            return {"text": done_text, "delay": 0.8}
    for keys, pid, source, writing, done_text, think in PLUGINS_V2:
        if all(k in low for k in keys):
            path, src = _plugin(pid, source)
            # Tools run since the user's last message. An edit reads the file first, like a careful agent.
            turn = msgs[max(i for i, m in enumerate(msgs) if m.get("role") == "user"):]
            done = sum(1 for m in turn if m.get("role") == "tool")
            steps = ([{"name": "read_file", "args": {"path": path}}] if source else []) + \
                    [{"name": "write_file", "args": {"path": path, "content": src}}]
            if done < len(steps):
                return {"text": writing if done == 0 else "", "tool_calls": [steps[done]]}
            return {"text": done_text, "delay": think}
    if last_user.strip().startswith(BACKGROUND):
        return {"delay": 30, "text": "Done. I left the details in this chat."}
    for keys, pid, writing, done_text, think in PLUGINS:
        if all(k in low for k in keys):
            if last.get("role") == "tool":
                return {"text": done_text, "delay": think}
            path, src = _plugin(pid)
            return {"text": writing, "tool_calls": [{"name": "write_file", "args": {"path": path, "content": src}}]}
    if "countdown" in low and "plugin" in low:
        if last.get("role") == "tool":
            return {"text": "**Launch countdown** is live in your app: a pane that ticks down to Thursday 10:00 with the crew on it, and a chip in the status bar. It's a plain plugin file, so I can change it any time."}
        return {"text": "Writing it as a desktop plugin. The app loads it the moment the file lands.",
                "tool_calls": [{"name": "write_file", "args": {"path": PLUGIN_PATH, "content": PLUGIN_SRC}}]}
    if last.get("role") == "tool":
        name = next((tc["function"]["name"] + tc["function"].get("arguments", "") for m in reversed(msgs) if m.get("role") == "assistant"
                     for tc in (m.get("tool_calls") or [])), "")
        if "launch" in name:
            return {"text": "Here's your launch board. Tick cards off right here; I'll see the progress."}
        return {"text": "Done."}
    # Group room turn: the room prompt names the speaker.
    speaker = (re.search(r"You are @([a-z0-9_-]+)", last_user) or [None, ""])[1].lower() if "Group chat" in last_user or "You are @" in last_user else ""
    if speaker:
        said_forge = "@forge:" in low or "forge:" in low and "changelog draft" in low
        if speaker == "scout":
            if "changelog draft" in low:
                return {"text": "(pass)"}
            return {"text": "On it. I'll own the launch plan: announcement Thursday, docs Friday. @forge can you draft the changelog?"}
        if speaker == "forge":
            if "changelog draft" in low:
                return {"text": "(pass)"}
            return {"text": "Changelog draft is up: 3 features, 2 fixes, 1 breaking note. Linking it in the plan."}
        return {"text": "(pass)"}
    if "launch board" in low or "launch checklist" in low:
        return {"text": "Pulling up your launch board.", "tool_calls": [{"name": "tool_call", "args": {"calls": [{"name": "mcp__launch__show_board", "arguments": {}}]}}]}
    if "launch week" in low:
        return {"delay": 4.5, "text": "Here's the week:\n\n1. **Mon** freeze the release branch\n2. **Tue** docs and changelog\n3. **Wed** dry-run the deploy\n4. **Thu** ship at 10:00\n5. **Fri** watch the numbers"}
    if "ramen" in low:
        return {"text": "Three late-night spots near you: **Mensho** (tori paitan), **Ramen Nagi** (build-your-own), **Ichiran** (solo booths). Want me to check wait times?"}
    if "introduce" in low or "introduction" in low or "say hi" in low or "about yourself" in low:
        me = me_from(system)
        for key, line in INTROS.items():
            if key in me or key in system.lower()[:4000]:
                return {"text": line}
        return {"text": "Hi! I'm ready. What are we working on?"}
    return {"text": "Got it. Here's the short version, and I can go deeper on any part."}

def chunk(model, delta, finish=None):
    return "data: " + json.dumps({"id": "chatcmpl-demo", "object": "chat.completion.chunk", "created": int(time.time()),
        "model": model, "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}) + "\n\n"

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _json(self, obj, code=200):
        data = json.dumps(obj).encode(); self.send_response(code)
        self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(data)))
        self.end_headers(); self.wfile.write(data)
    def do_GET(self):
        if self.path.startswith("/v1/models"):
            return self._json({"object": "list", "data": [{"id": "demo-model", "object": "model", "owned_by": "demo"}]})
        self._json({}, 404)
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        turn = decide(body); model = body.get("model", "demo-model")
        msgs = body.get("messages") or []
        LOG.write(json.dumps({"roles": [m.get("role") for m in msgs], "last": text_of(msgs[-1])[:300] if msgs else "",
            "sys": next((text_of(m)[-600:] for m in msgs if m.get("role") == "system"), "")[-600:],
            "user": next((text_of(m)[:300] for m in reversed(msgs) if m.get("role") == "user"), ""),
            "tools": len(body.get("tools") or []), "toolnames": [t.get("function", {}).get("name") for t in (body.get("tools") or [])], "turn": turn}) + "\n"); LOG.flush()
        calls = [{"index": i, "id": f"call_demo_{int(time.time()*1000)}_{i}", "type": "function",
                  "function": {"name": c["name"], "arguments": json.dumps(c["args"])}} for i, c in enumerate(turn.get("tool_calls", []))]
        if not body.get("stream"):
            msg = {"role": "assistant", "content": turn["text"]}
            if calls: msg["tool_calls"] = [{k: v for k, v in c.items() if k != "index"} for c in calls]
            return self._json({"id": "chatcmpl-demo", "object": "chat.completion", "created": int(time.time()), "model": model,
                "choices": [{"index": 0, "message": msg, "finish_reason": "tool_calls" if calls else "stop"}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20}})
        self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.send_header("Cache-Control", "no-cache"); self.end_headers()
        time.sleep(turn.get("delay", 0))
        for i, word in enumerate(turn["text"].split(" ")):
            self.wfile.write(chunk(model, {"role": "assistant", "content": (" " if i else "") + word}).encode()); self.wfile.flush()
            time.sleep(0.035)
        self.wfile.write(chunk(model, {"tool_calls": calls} if calls else {}, "tool_calls" if calls else "stop").encode())
        self.wfile.write(b"data: [DONE]\n\n"); self.wfile.flush()

ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
