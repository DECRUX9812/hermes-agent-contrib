#!/usr/bin/env python3
"""no-raw-style: keep colours, sizes and motion on the theme/token layer.

Bans, in plugin sources and in lines our desktop patch adds:
  hex colours, rgb()/rgba()/hsl()/hsla(), Tailwind palette colours (bg-red-500, text-white ...),
  arbitrary text-[..] rounded-[..] duration-[..] z-[..] tracking-[..] leading-[..], the `uppercase` class,
  and (plugins only) CSS vars outside the theme families.
Escape one line with a trailing `raw-style-ok: <reason>` comment; fence a theme palette with
`no-raw-style: palette-start` / `no-raw-style: palette-end` comments.

  no-raw-style.py plugins <dir> [<dir> ...]       [--baseline F] [--write-baseline]
  no-raw-style.py diff <git dir> <base> <ref>     [--baseline F] [--write-baseline]
Plugins mode walks each dir (plugins/, desktop-plugins/) for .js/.mjs/.cjs/.css/.ts/.tsx, keyed
<dir name>/<path>; tests, vendor/ and node_modules/ are skipped.
The theme layer (apps/desktop/src/themes/, design/tokens.css) is exempt in diff mode.
With --baseline it is a ratchet: exit 1 only when a file has more hits of a rule than
the baseline records (old debt is listed by count, new debt fails). Without it, any hit fails.
"""
import collections, json, re, subprocess, sys, pathlib
EXEMPT = ('apps/desktop/src/themes/', 'apps/desktop/src/design/tokens.css')

PALETTE = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
UTIL = 'bg|text|border|ring|from|to|via|fill|stroke|outline|shadow|divide|accent|caret|decoration|placeholder'
RULES = [
    ('hex colour', re.compile(r'(?<![\w&/])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b(?![-/])')),
    ('rgb()/hsl()', re.compile(r'\b(?:rgba?|hsla?)\(')),
    ('palette colour', re.compile(rf'(?<![\w-])(?:{UTIL})-(?:(?:{PALETTE})-\d{{2,3}}|white|black)(?![\w-])')),
    ('arbitrary value', re.compile(r'(?<![\w-])(?<!\*=\')(?:text|rounded(?:-[trbl]{1,2})?|duration|z|tracking|leading)-\[(?!(?:length:)?var\(--)[^\]]+\]')),
    ('uppercase class', re.compile(r'''(?<=['"` ])uppercase(?=['"` ])''')),
]
PLUGIN_VAR = re.compile(r'var\(--(?!hx-|ds-|ui-|color-|radius|font-|shadow-|chrome-|conversation-|speaker-color|dt-|text-ui-|titlebar-)([\w-]+)')
ESCAPE = 'raw-style-ok'
SOURCES = {'.js', '.mjs', '.cjs', '.css', '.ts', '.tsx'}
SKIP_DIRS = {'node_modules', 'vendor', 'tests', '__tests__', 'dist'}

def strip_comments(line):
    line = re.sub(r'/\*.*?\*/', '', line)
    m = re.search(r'(?<![:\'"`])//', line)
    return line[:m.start()] if m else line

def scan(text, plugin):
    hits, in_block, palette = [], False, False
    for n, raw in enumerate(text.split('\n'), 1):
        # A theme's own palette is the token source, fenced by palette-start/-end comments.
        if 'no-raw-style: palette-' in raw:
            palette = 'palette-start' in raw
            continue
        if ESCAPE in raw or palette:
            continue
        line = raw
        if in_block:
            if '*/' not in line: continue
            line, in_block = line.split('*/', 1)[1], False
        if '/*' in line and '*/' not in line.split('/*', 1)[1]:
            line, in_block = line.split('/*', 1)[0], True
        line = strip_comments(line)
        if line.lstrip().startswith('*'):
            continue
        for name, rx in RULES:
            for m in rx.finditer(line):
                hits.append((n, name, m.group(0)))
        if plugin:
            for m in PLUGIN_VAR.finditer(line):
                hits.append((n, 'non-theme var', m.group(0)))
    return hits

def main(argv):
    out, baseline, write = [], None, '--write-baseline' in argv
    if '--baseline' in argv:
        baseline = argv[argv.index('--baseline') + 1]
    argv = [a for a in argv if a not in ('--write-baseline', baseline)]
    argv = [a for a in argv if a != '--baseline']
    if argv[:1] == ['plugins']:
        for root in map(pathlib.Path, argv[1:]):
            for p in sorted(q for q in root.rglob('*') if q.suffix in SOURCES):
                rel = p.relative_to(root)
                if not p.is_file() or SKIP_DIRS & set(rel.parts[:-1]) or '.test.' in p.name:
                    continue
                key = f'{root.resolve().name}/{rel}'
                head = p.read_text(errors='ignore')[:400]
                if 'no-raw-style: off' in head:
                    print(f'skip {key} (opted out in its header)')
                    continue
                out += [(f'{key}:{n}', r, s) for n, r, s in scan(p.read_text(errors='ignore'), True)]
    elif argv[:1] == ['diff']:
        git, base, ref = argv[1:4]
        diff = subprocess.run(['git', '-C', git, 'diff', '-U0', '--no-color', f'{base}..{ref}', '--',
                               'apps/desktop/src/*.ts', 'apps/desktop/src/*.tsx', 'apps/desktop/src/*.css',
                               ':!*.test.ts', ':!*.test.tsx'], capture_output=True, text=True, check=True).stdout
        f = n = None
        for line in diff.split('\n'):
            if line.startswith('+++ '):
                f = line[6:]
                f = None if f.startswith(EXEMPT) else f
            elif line.startswith('@@'):
                n = int(re.search(r'\+(\d+)', line).group(1))
            elif line.startswith('+') and f:
                out += [(f'{f}:{n}', r, s) for _, r, s in scan(line[1:], False)]
                n += 1
    else:
        print(__doc__); return 2
    counts = collections.defaultdict(collections.Counter)
    for where, rule, _ in out:
        counts[where.rsplit(':', 1)[0]][rule] += 1
    if write and baseline:
        json.dump({f: dict(sorted(c.items())) for f, c in sorted(counts.items())}, open(baseline, 'w'), indent=1)
        print(f'no-raw-style: wrote baseline ({len(out)} hit(s) in {len(counts)} file(s))'); return 0
    if baseline:
        base = json.load(open(baseline))
        grown = {(f, r) for f, c in counts.items() for r, n in c.items() if n > base.get(f, {}).get(r, 0)}
        for where, rule, s in out:
            if (where.rsplit(':', 1)[0], rule) in grown:
                print(f'{where}: {rule}: {s}')
        shrunk = sum(max(0, n - counts.get(f, {}).get(r, 0)) for f, c in base.items() for r, n in c.items())
        print(f'no-raw-style: {len(out)} hit(s), {len(grown)} file/rule pair(s) over baseline'
              + (f'; {shrunk} below baseline, re-run with --write-baseline to lock that in' if shrunk else ''))
        return 1 if grown else 0
    for where, rule, s in out:
        print(f'{where}: {rule}: {s}')
    print(f'no-raw-style: {len(out)} hit(s)')
    return 1 if out else 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
