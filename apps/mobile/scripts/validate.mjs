// Structural check: required files exist and JSON parses. No network, no build.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const required = [
  'package.json',
  'app.json',
  'tsconfig.json',
  'babel.config.js',
  'index.js',
  'App.tsx',
  'src/theme.ts',
  'src/pairing.ts',
  'src/api/client.ts',
  'src/screens/ChatScreen.tsx',
  'src/screens/FeedScreen.tsx',
  'src/screens/SettingsScreen.tsx',
  'README.md',
];
let fail = 0;
for (const f of required) {
  if (!existsSync(join(root, f))) {
    console.error(`MISSING ${f}`);
    fail++;
  }
}
for (const f of ['package.json', 'app.json', 'tsconfig.json']) {
  try {
    JSON.parse(readFileSync(join(root, f), 'utf8'));
  } catch (e) {
    console.error(`BAD JSON ${f}: ${e.message}`);
    fail++;
  }
}
import { readdirSync, statSync } from 'node:fs';
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}
// No-mock guard: reject actual mock implementations, not prose.
const MOCK_CODE = /\bmock\s*\(|from\s+['"][^'"]*mock|class\s+\w*Mock\b|Mock\w+\s*=/i;
for (const f of walk(join(root, 'src'))) {
  const text = readFileSync(f, 'utf8');
  if (MOCK_CODE.test(text)) {
    console.error(`MOCK REFERENCE in ${f}`);
    fail++;
  }
}
console.log(fail === 0 ? 'validate: OK (13 files, JSON parses, no mocks)' : `validate: ${fail} problem(s)`);
process.exit(fail === 0 ? 0 : 1);
