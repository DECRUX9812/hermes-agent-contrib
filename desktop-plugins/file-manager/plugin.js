/**
 * File Manager — Hermes Desktop plugin (unified Agent+Human Workspace).
 *
 * VS Code–style workspace on the Electron native bridge (window.hermesDesktop):
 * real laptop files, no backend, no restart. Fused with the systems that ship
 * on this machine:
 *   • hermes-bots   — opens agent/bot sessions scoped to a repo cwd
 *                      (host.request('session.create', { cwd, title }))
 *   • langchain-rag — auto-indexes ~/Code hourly; an "Optimize with AI"
 *                      session at that cwd leans on that index.
 *
 * UX notes (smooth, no blocking native dialogs):
 *   - Themed modal layer for rename / new-file / new-folder / delete-confirm.
 *   - New file is created locally (writeTextFile). New folder routes to a
 *     hidden agent session (mkdir) until an SSH/terminal helper is wired.
 *   - Keyboard: ↑/Backspace = up a dir, Enter = open, Esc = close modal.
 *
 * No build step. Plain ESM. Only @hermes/plugin-sdk + react resolve.
 */

import {
  atom, cn, host, useValue, Codicon, Skeleton, EmptyState, Input, Button
} from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'file-manager'

function bridge() { return (typeof window !== 'undefined') ? window.hermesDesktop : null }
const git = () => bridge()?.git
async function fsReadDir(path) {
  const b = bridge(); if (!b?.readDir) throw new Error('FS bridge unavailable')
  const r = await b.readDir(path); if (r.error) throw new Error(r.error); return r.entries || []
}
async function fsReadText(path) {
  const b = bridge(); if (!b?.readFileText) throw new Error('Read unavailable')
  const r = await b.readFileText(path); if (r.binary) throw new Error('Binary file'); return r
}
async function fsWriteText(path, content) {
  const b = bridge(); if (!b?.writeTextFile) throw new Error('Write unavailable')
  return b.writeTextFile(path, content)
}
async function fsRename(path, name) {
  const b = bridge(); if (!b?.renamePath) throw new Error('Rename unavailable')
  return (await b.renamePath(path, name)).path
}
async function fsTrash(path) {
  const b = bridge(); if (!b?.trashPath) throw new Error('Delete unavailable')
  return b.trashPath(path)
}
async function fsReveal(path) {
  const b = bridge(); if (!b?.revealPath) return false; return b.revealPath(path)
}
async function fsGitRoot(path) {
  const b = bridge(); if (!b?.gitRoot) return null
  try { return await b.gitRoot(path) } catch { return null }
}
async function fsGitStatus(repo) {
  const g = git(); if (!g?.repoStatus) return null
  try { return await g.repoStatus(repo) } catch { return null }
}
async function fsGitDiff(repo, file) {
  const g = git(); if (!g?.fileDiff) return ''
  try { return await g.fileDiff(repo, file) } catch { return '' }
}
function fsWatch(dir) {
  const b = bridge(); if (!b?.watchDirectory) return null
  try { return b.watchDirectory(dir) } catch { return null }
}
async function discoverRepos(roots) {
  const g = git(); if (!g?.scanRepos) return []
  try { return await g.scanRepos(roots, { maxDepth: 4, enabled: true, excludePaths: ['/node_modules', '/.git', '/vendor', '/.cache'] }) } catch { return [] }
}

// ── fused AI actions (hermes-bots + langchain-rag) ───────────────────────────
function openChatAt(repoRoot, prompt) {
  const payload = { cwd: repoRoot, title: repoRoot.split('/').pop() }
  if (prompt) payload.message = prompt
  try {
    host.request('session.create', payload)
      .then(() => host.notify({ kind: 'success', message: `Opened chat in ${payload.title}` }))
      .catch(() => host.notify({ kind: 'info', message: 'Chat launch unavailable — open a session manually.' }))
  } catch { host.notify({ kind: 'info', message: 'Chat launch unavailable.' }) }
}
function runAgentHere(repoRoot) {
  openChatAt(repoRoot, `You are now operating inside ${repoRoot}. Help me work on this project: explore the structure and tell me what you find.`)
}
function optimizeWithAI(repoRoot) {
  const name = repoRoot.split('/').pop()
  openChatAt(repoRoot,
    `Optimize the repository at ${repoRoot} (project: ${name}).
     1) Review the structure and surface redundant/dead code, missing docs, and config smells.
     2) Use the Knowledge & RAG index (auto-indexes ~/Code hourly) to answer questions about this repo's patterns/history.
     3) Propose a prioritized, concrete improvement plan with file:line references. Do not change anything yet — present the plan first.`)
}
// New folder has no bridge mkdir; route to a hidden agent session that mkdirs.
function createFolderViaAgent(parent, name) {
  openChatAt(parent, `Create a folder named "${name}" inside this directory using \`mkdir -p "${name}"\`, then you may stop. No other changes.`)
}

// ── file-type icon map (codicon glyph + accent color) ────────────────────────
const ICONS = {
  folder: { glyph: 'folder', color: '#7c93b0' },
  ts: { glyph: 'file-code', color: '#3178c6' }, js: { glyph: 'file-code', color: '#e8d44d' },
  jsx: { glyph: 'file-code', color: '#61dafb' }, tsx: { glyph: 'file-code', color: '#61dafb' },
  py: { glyph: 'file-code', color: '#4b8bbe' }, rs: { glyph: 'file-code', color: '#dea584' },
  go: { glyph: 'file-code', color: '#00add8' }, c: { glyph: 'file-code', color: '#a8b9cc' },
  cpp: { glyph: 'file-code', color: '#a8b9cc' }, h: { glyph: 'file-code', color: '#a8b9cc' },
  java: { glyph: 'file-code', color: '#e76f00' }, json: { glyph: 'json', color: '#cbcb41' },
  md: { glyph: 'markdown', color: '#9aa7b5' }, mdx: { glyph: 'markdown', color: '#9aa7b5' },
  yml: { glyph: 'settings', color: '#cb6fcb' }, yaml: { glyph: 'settings', color: '#cb6fcb' },
  toml: { glyph: 'settings', color: '#cb6fcb' }, cfg: { glyph: 'settings', color: '#cb6fcb' },
  ini: { glyph: 'settings', color: '#cb6fcb' }, env: { glyph: 'settings', color: '#cb6fcb' },
  css: { glyph: 'symbol-color', color: '#563d7c' }, scss: { glyph: 'symbol-color', color: '#cf649a' },
  html: { glyph: 'code', color: '#e44d26' }, sh: { glyph: 'terminal', color: '#89e051' },
  bash: { glyph: 'terminal', color: '#89e051' }, zsh: { glyph: 'terminal', color: '#89e051' },
  txt: { glyph: 'file-text', color: '#9aa7b5' }, log: { glyph: 'file-text', color: '#9aa7b5' },
  png: { glyph: 'file-media', color: '#a074c4' }, jpg: { glyph: 'file-media', color: '#a074c4' },
  jpeg: { glyph: 'file-media', color: '#a074c4' }, gif: { glyph: 'file-media', color: '#a074c4' },
  webp: { glyph: 'file-media', color: '#a074c4' }, svg: { glyph: 'file-media', color: '#a074c4' },
  mp3: { glyph: 'file-media', color: '#c4a074' }, mp4: { glyph: 'file-media', color: '#c4a074' },
  pdf: { glyph: 'file-pdf', color: '#e5534b' }, lock: { glyph: 'lock', color: '#c4a074' },
  db: { glyph: 'database', color: '#c4a074' }, sql: { glyph: 'database', color: '#c4a074' },
  zip: { glyph: 'file-zip', color: '#c4a074' }, Dockerfile: { glyph: 'package', color: '#2496ed' },
  Makefile: { glyph: 'package', color: '#2496ed' }
}
function iconFor(name, isDir) {
  if (isDir) return ICONS.folder
  const base = name.toLowerCase()
  if (base === 'dockerfile') return ICONS.Dockerfile
  if (base === 'makefile') return ICONS.Makefile
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : ''
  return ICONS[ext] || { glyph: 'file', color: '#9aa7b5' }
}

// ── state ────────────────────────────────────────────────────────────────────
const $projects = atom([])
const $root = atom(null)
const $tree = atom({ entries: [], parent: null, path: null })
const $loading = atom(false)
const $error = atom(null)
const $gitStatus = atom(null)
const $repoRoot = atom(null)
const $openTabs = atom([])
const $activeTab = atom(null)
const $drafts = atom({})
const $saved = atom({})
const $saving = atom(false)
const $search = atom('')
const $contextMenu = atom(null)
const $diff = atom(null)
const $watchId = atom(null)
const $pinned = atom([])
const $pickerOpen = atom(false)
// modal: { type:'rename'|'newfile'|'newfolder'|'delete', node?, parent? }
const $modal = atom(null)

// ── helpers ──────────────────────────────────────────────────────────────────
function parentOf(p) {
  if (!p) return null
  const i = p.replace(/\/$/, '').lastIndexOf('/')
  return i <= 0 ? (p.startsWith('/') ? '/' : null) : p.slice(0, i)
}
function homeDir() { return (typeof process !== 'undefined' && process.env.HOME) ? process.env.HOME : '/' }
function commonRoots() {
  const h = homeDir()
  return [h + '/Code', h + '/Projects', h + '/dev', h + '/repos', h + '/Desktop', h].filter(Boolean)
}
async function refreshProjects() {
  const repos = await discoverRepos(commonRoots())
  const seen = new Set(repos.map(r => r.root))
  const pins = $pinned.get().filter(p => !seen.has(p))
  const all = [...repos, ...pins.map(p => ({ root: p, label: p.split('/').pop() || p }))]
  $projects.set(all)
  return all
}
async function selectRoot(dir) {
  if (!dir) return
  $pickerOpen.set(false); $modal.set(null)
  $loading.set(true); $error.set(null)
  try {
    const entries = await fsReadDir(dir)
    entries.sort((a, b) => (a.isDirectory === b.isDirectory) ? a.name.localeCompare(b.name) : (a.isDirectory ? -1 : 1))
    $root.set(dir); $tree.set({ entries, parent: parentOf(dir), path: dir })
    const root = await fsGitRoot(dir); $repoRoot.set(root)
    $gitStatus.set(root ? await fsGitStatus(root) : null)
    const old = $watchId.get(); if (old?.stop) { try { old.stop() } catch {} }
    const w = fsWatch(dir); if (w) $watchId.set(w)
  } catch (e) { $error.set(String(e?.message || e)) } finally { $loading.set(false) }
}
function relToRepo(path) {
  const root = $repoRoot.get(); if (!root) return null
  return path.startsWith(root + '/') ? path.slice(root.length + 1) : path
}
function gitBadgeFor(path) {
  const st = $gitStatus.get(); if (!st?.files) return null
  const rel = relToRepo(path); if (!rel) return null
  const f = st.files.find(x => x.path === rel); if (!f) return null
  let letter = '?', color = '#8a8a93'
  if (f.conflicted) { letter = '!'; color = '#ec4899' }
  else if (f.untracked) { letter = '?'; color = '#8a8a93' }
  else if (f.staged && f.unstaged) { letter = '●'; color = '#34d399' }
  else if (f.staged) { letter = 'A'; color = '#34d399' }
  else if (f.unstaged) { letter = 'M'; color = '#f59e0b' }
  return jsx('span', { className: 'ml-1 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-[3px] px-0.5 text-[0.55rem] font-bold text-black/80',
    style: { background: color }, title: `git: ${letter}`, children: letter })
}
async function openFile(path) {
  if ($openTabs.get().some(t => t.path === path)) { $activeTab.set(path); return }
  $loading.set(true)
  try {
    const res = await fsReadText(path)
    $openTabs.set([...$openTabs.get(), { path, language: res.language || 'text' }])
    $drafts.set({ ...$drafts.get(), [path]: res.text }); $saved.set({ ...$saved.get(), [path]: res.text })
    $activeTab.set(path)
  } catch (e) { host.notify({ kind: 'error', message: `Cannot open: ${String(e?.message || e)}` }) } finally { $loading.set(false) }
}
async function saveActive() {
  const path = $activeTab.get(); if (!path) return
  const content = $drafts.get()[path] ?? ''
  $saving.set(true)
  try { await fsWriteText(path, content); $saved.set({ ...$saved.get(), [path]: content }); host.notify({ kind: 'success', message: `Saved ${path.split('/').pop()}` }); if ($root.get()) selectRoot($root.get()) }
  catch (e) { host.notify({ kind: 'error', message: `Save failed: ${String(e?.message || e)}` }) } finally { $saving.set(false) }
}
function closeTab(path) {
  const tabs = $openTabs.get().filter(t => t.path !== path)
  const d = { ...$drafts.get() }; delete d[path]; const s = { ...$saved.get() }; delete s[path]
  $openTabs.set(tabs); $drafts.set(d); $saved.set(s)
  if ($activeTab.get() === path) $activeTab.set(tabs[0]?.path ?? null)
}
async function doRename(node, name) {
  if (!name || name === node.name) return
  try {
    const np = await fsRename(node.path, name)
    $openTabs.set($openTabs.get().map(t => t.path === node.path ? { ...t, path: np } : t))
    if ($activeTab.get() === node.path) $activeTab.set(np)
    host.notify({ kind: 'success', message: `Renamed to ${name}` }); if ($root.get()) selectRoot($root.get())
  } catch (e) { host.notify({ kind: 'error', message: `Rename failed: ${String(e?.message || e)}` }) }
}
async function doDelete(node) {
  try { await fsTrash(node.path); closeTab(node.path); host.notify({ kind: 'success', message: `Moved ${node.name} to trash` }); if ($root.get()) selectRoot($root.get()) }
  catch (e) { host.notify({ kind: 'error', message: `Delete failed: ${String(e?.message || e)}` }) }
}
async function doReveal(node) { if (!await fsReveal(node.path)) host.notify({ kind: 'info', message: 'Reveal not available here' }) }
async function createFile(parent, name) {
  if (!name) return
  const path = parent.endsWith('/') ? parent + name : parent + '/' + name
  try { await fsWriteText(path, ''); host.notify({ kind: 'success', message: `Created ${name}` }); selectRoot(parent) }
  catch (e) { host.notify({ kind: 'error', message: `Create failed: ${String(e?.message || e)}` }) }
}
async function pickFolder() {
  const b = bridge(); if (!b?.selectPaths) { host.notify({ kind: 'info', message: 'Picker unavailable' }); return }
  try { const c = await b.selectPaths({ directories: true, multiple: false }); if (c && c[0]) { $pinned.set([...new Set([...$pinned.get(), c[0]])]); await refreshProjects(); selectRoot(c[0]) } }
  catch (e) { host.notify({ kind: 'error', message: `Picker failed: ${String(e?.message || e)}` }) }
}

// ── components ───────────────────────────────────────────────────────────────
function RepoChip() {
  const st = useValue($gitStatus); const root = useValue($repoRoot)
  if (!root || !st) return null
  return jsxs('div', {
    className: 'flex flex-wrap items-center gap-1.5 px-2 py-1 text-[0.65rem] text-(--ui-text-tertiary)',
    children: [
      jsx(Codicon, { name: 'git-branch', className: 'text-(--ui-accent)' }),
      jsx('span', { className: 'font-medium text-(--ui-text-secondary)', children: st.branch || 'detached' }),
      (st.ahead || st.behind) ? jsxs('span', { className: 'flex items-center gap-1', children: [
        st.ahead ? jsx('span', { className: 'text-(--ui-accent)', title: 'ahead', children: `↑${st.ahead}` }) : null,
        st.behind ? jsx('span', { className: 'text-(--ui-text-quaternary)', title: 'behind', children: `↓${st.behind}` }) : null
      ] }) : null,
      st.changed ? jsx('span', { className: 'rounded-full bg-(--ui-stroke-secondary) px-1.5 text-(--ui-text-tertiary)', title: 'changed files', children: `${st.changed}●` }) : null,
      jsx('span', { className: 'text-(--ui-text-quaternary)', children: '· RAG-auto-indexed' })
    ]
  })
}
function Breadcrumb() {
  const path = useValue($root); if (!path) return null
  const parts = path.split('/').filter(Boolean)
  return jsxs('div', {
    className: 'flex items-center gap-0.5 overflow-x-auto border-b border-(--ui-stroke-secondary) px-2 py-1 text-[0.65rem] text-(--ui-text-tertiary)',
    children: parts.map((p, i) => {
      const seg = '/' + parts.slice(0, i + 1).join('/')
      return jsxs('span', { className: 'flex shrink-0 items-center', children: [
        i > 0 ? jsx('span', { children: '/' }) : null,
        jsx('button', { className: 'rounded px-1 hover:bg-(--chrome-action-hover) hover:text-foreground', onClick: () => selectRoot(seg), children: p })
      ] })
    })
  })
}
function ProjectActions() {
  const repo = useValue($repoRoot); if (!repo) return null
  return jsxs('div', {
    className: 'border-y border-(--ui-stroke-secondary) px-2 py-2',
    children: [
      jsx('div', { className: 'mb-1.5 text-[0.6rem] uppercase tracking-wide text-(--ui-text-quaternary)', children: 'AI & agents' }),
      jsxs('div', { className: 'grid grid-cols-2 gap-1.5', children: [
        jsx(Button, { size: 'sm', variant: 'primary', className: 'h-7 text-[0.65rem]', onClick: () => runAgentHere(repo), children: 'Run agent here' }),
        jsx(Button, { size: 'sm', className: 'h-7 text-[0.65rem]', onClick: () => optimizeWithAI(repo), children: 'Optimize w/ AI' })
      ] })
    ]
  })
}
function Toolbar() {
  const root = useValue($root); const repo = useValue($repoRoot)
  const onNew = (type) => { if (root) $modal.set({ type, parent: root }) }
  return jsxs('div', { className: 'flex items-center gap-1 border-b border-(--ui-stroke-secondary) px-2 py-1.5', children: [
    jsx('button', { title: 'Projects', className: 'flex h-6 items-center gap-1 rounded px-1.5 text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground',
      onClick: () => $pickerOpen.set(!$pickerOpen.get()), children: [jsx(Codicon, { name: 'repo' }), jsx(Codicon, { name: 'chevron-down', className: 'text-[0.6rem]' })] }),
    jsx('button', { title: 'Up', className: 'flex h-6 w-6 items-center justify-center rounded text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground',
      onClick: () => { const p = $tree.get().parent; if (p) selectRoot(p) }, children: jsx(Codicon, { name: 'arrow-up' }) }),
    jsx('button', { title: 'Refresh', className: 'flex h-6 w-6 items-center justify-center rounded text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground',
      onClick: () => $root.get() && selectRoot($root.get()), children: jsx(Codicon, { name: 'refresh' }) }),
    jsx('button', { title: 'New file', className: 'flex h-6 w-6 items-center justify-center rounded text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground',
      onClick: () => onNew('newfile'), children: jsx(Codicon, { name: 'new-file' }) }),
    jsx('button', { title: 'New folder', className: 'flex h-6 w-6 items-center justify-center rounded text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground',
      onClick: () => onNew('newfolder'), children: jsx(Codicon, { name: 'new-folder' }) }),
    jsx('button', { title: 'Go to folder…', className: 'flex h-6 w-6 items-center justify-center rounded text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground',
      onClick: pickFolder, children: jsx(Codicon, { name: 'folder-opened' }) }),
    repo ? jsxs('span', { className: 'flex items-center', children: [
      jsx('button', { title: 'Open in chat', className: 'flex h-6 w-6 items-center justify-center rounded text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground',
        onClick: () => openChatAt(repo), children: jsx(Codicon, { name: 'comment' }) }),
      jsx('button', { title: 'Run agent here', className: 'flex h-6 w-6 items-center justify-center rounded text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground',
        onClick: () => runAgentHere(repo), children: jsx(Codicon, { name: 'agent' }) }),
      jsx('button', { title: 'Optimize with AI', className: 'flex h-6 w-6 items-center justify-center rounded text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground',
        onClick: () => optimizeWithAI(repo), children: jsx(Codicon, { name: 'sparkle' }) })
    ] }) : null,
    jsx('div', { className: 'ml-1 flex-1' })
  ] })
}
function Row({ node }) {
  const isDir = node.isDirectory
  const onClick = () => isDir ? selectRoot(node.path) : openFile(node.path)
  const onContext = (e) => { e.preventDefault(); $contextMenu.set({ x: e.clientX, y: e.clientY, node }) }
  const onKey = (e) => { if (e.key === 'Enter') onClick(); if (e.key === 'Backspace') { const p = $tree.get().parent; if (p) selectRoot(p) } }
  const ic = iconFor(node.name, isDir)
  return jsx('div', { className: 'group flex cursor-pointer items-center gap-1.5 rounded px-2 py-0.5 text-xs hover:bg-(--chrome-action-hover)', tabIndex: 0, onClick, onContextMenu: onContext, onKeyDown: onKey, children: [
    jsx(Codicon, { name: ic.glyph, className: 'shrink-0', style: { color: ic.color } }),
    jsx('span', { className: 'flex-1 truncate', children: node.name }),
    isDir ? null : gitBadgeFor(node.path)
  ] })
}
function Tree() {
  const tree = useValue($tree); const loading = useValue($loading); const error = useValue($error); const search = useValue($search)
  const q = search.trim().toLowerCase()
  if (error) return jsx(EmptyState, { title: 'Error', description: error })
  if (loading) return jsx(Skeleton, { className: 'm-2 h-40 w-full' })
  if (!tree.entries?.length) return jsx(EmptyState, { title: 'Empty folder' })
  const rows = tree.entries.filter(e => !q || e.name.toLowerCase().includes(q))
  return jsx('div', { className: 'flex-1 overflow-auto py-1', children: rows.map(e => jsx(Row, { key: e.path, node: e })) })
}
function EditorTab({ tab }) {
  const active = useValue($activeTab) === tab.path
  const dirty = ($drafts.get()[tab.path] ?? '') !== ($saved.get()[tab.path] ?? '')
  return jsx('div', { className: cn('flex cursor-pointer items-center gap-1 border-r border-(--ui-stroke-secondary) px-2 py-1 text-xs', active ? 'bg-(--chrome-action-hover) text-foreground' : 'text-(--ui-text-tertiary)'),
    onClick: () => $activeTab.set(tab.path), children: [
      jsx(Codicon, { name: 'file', className: 'shrink-0' }),
      jsx('span', { className: 'max-w-[140px] truncate', children: tab.path.split('/').pop() }),
      dirty ? jsx('span', { className: 'ml-0.5 text-(--ui-accent)', children: '●' }) : null,
      jsx('button', { className: 'ml-1 rounded px-1 text-(--ui-text-quaternary) hover:text-foreground', onClick: (e) => { e.stopPropagation(); closeTab(tab.path) }, children: '×' })
    ] })
}
function EditorArea() {
  const tabs = useValue($openTabs); const active = useValue($activeTab); const saving = useValue($saving)
  const drafts = useValue($drafts); const saved = useValue($saved)
  const taRef = useRef(null)
  if (!tabs.length) return null
  const draft = drafts[active] ?? ''
  const dirty = draft !== (saved[active] ?? '')
  const onDraft = (v) => { $drafts.set({ ...$drafts.get(), [active]: v }) }
  return jsxs('div', { className: 'flex h-[50%] min-h-[160px] flex-col border-t border-(--ui-stroke-secondary)', children: [
    jsxs('div', { className: 'flex items-center', children: [
      jsx('div', { className: 'flex flex-1 overflow-x-auto', children: tabs.map(t => jsx(EditorTab, { key: t.path, tab: t })) }),
      jsx(Button, { size: 'sm', variant: 'primary', className: 'm-1 h-6', disabled: saving || !active || !dirty, onClick: saveActive, children: saving ? 'Saving…' : 'Save' }),
      jsx('button', { title: 'Show git diff', className: 'mx-1 flex h-6 w-6 items-center justify-center rounded text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground',
        onClick: async () => { const r = $repoRoot.get(); if (!r) { host.notify({ kind: 'info', message: 'Not in a git repo' }); return } const d = await fsGitDiff(r, active); $diff.set({ path: active, text: d || '(no changes vs HEAD)' }) },
        children: jsx(Codicon, { name: 'git-compare' }) })
    ] }),
    jsx('textarea', { ref: taRef, spellCheck: false, className: 'h-full w-full flex-1 resize-none bg-transparent p-3 font-mono text-xs leading-relaxed text-(--ui-text-secondary) outline-none', value: draft, onChange: (e) => onDraft(e.target.value),
      onKeyDown: (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveActive() } if (e.key === 'Tab') { e.preventDefault(); const el = e.target; const s = el.selectionStart; const en = el.selectionEnd; onDraft(draft.slice(0, s) + '  ' + draft.slice(en)); requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2 }) } } })
  ] })
}
function DiffView() {
  const diff = useValue($diff); if (!diff) return null
  return jsxs('div', { className: 'absolute inset-0 z-30 flex flex-col bg-(--card)', children: [
    jsxs('div', { className: 'flex items-center justify-between border-b border-(--ui-stroke-secondary) px-3 py-1.5 text-xs', children: [
      jsx('span', { className: 'font-medium', children: `Diff — ${diff.path.split('/').pop()}` }),
      jsx('button', { className: 'rounded px-2 py-0.5 text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground', onClick: () => $diff.set(null), children: 'Close' })
    ] }),
    jsx('pre', { className: 'flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed text-(--ui-text-secondary)', children: diff.text })
  ] })
}
function ProjectPicker() {
  const open = useValue($pickerOpen); const projects = useValue($projects); const root = useValue($root)
  if (!open) return null
  return jsxs('div', { className: 'absolute inset-x-0 top-9 z-40 max-h-[70%] overflow-auto border-b border-(--ui-stroke-secondary) bg-(--card) shadow-xl', children: [
    jsx('div', { className: 'px-3 py-2 text-[0.6rem] uppercase tracking-wide text-(--ui-text-quaternary)', children: 'Projects' }),
    projects.length ? projects.map(r => jsx('div', {
      key: r.root, className: cn('flex cursor-pointer items-center gap-2 rounded px-3 py-1.5 text-xs hover:bg-(--chrome-action-hover)', root === r.root && 'bg-(--chrome-action-hover)'),
      onClick: () => selectRoot(r.root), children: [
        jsx(Codicon, { name: 'repo-forked', className: 'shrink-0 text-(--ui-accent)' }),
        jsx('div', { className: 'flex min-w-0 flex-1 flex-col', children: [
          jsx('span', { className: 'truncate font-medium text-(--ui-text-secondary)', children: r.label }),
          jsx('span', { className: 'truncate text-[0.6rem] text-(--ui-text-quaternary)', children: r.root })
        ] })
      ]
    })) : jsx('div', { className: 'px-3 py-2 text-xs text-(--ui-text-quaternary)', children: 'No projects found.' }),
    jsx('button', { className: 'm-2 flex items-center gap-1 rounded border border-(--ui-stroke-secondary) px-2 py-1 text-xs text-(--ui-text-tertiary) hover:text-foreground',
      onClick: pickFolder, children: [jsx(Codicon, { name: 'add' }), 'Add folder…'] })
  ] })
}
function ContextMenuLayer() {
  const menu = useValue($contextMenu); if (!menu) return null
  const { x, y, node } = menu; const isDir = node.isDirectory
  const item = (label, fn) => jsx('button', { className: 'block w-full px-3 py-1.5 text-left hover:bg-(--chrome-action-hover)', onClick: () => { $contextMenu.set(null); fn() }, children: label })
  return jsx('div', { className: 'fixed z-50 min-w-[170px] rounded-md border border-(--ui-stroke-secondary) bg-(--card) py-1 text-xs shadow-xl', style: { left: x, top: y }, children: [
    item('Open', () => isDir ? selectRoot(node.path) : openFile(node.path)),
    item('Rename', () => $modal.set({ type: 'rename', node })),
    item('New file here', () => $modal.set({ type: 'newfile', parent: node.isDirectory ? node.path : parentOf(node.path) })),
    item('New folder here', () => $modal.set({ type: 'newfolder', parent: node.isDirectory ? node.path : parentOf(node.path) })),
    item('Reveal in file manager', () => doReveal(node)),
    jsx('div', { className: 'my-1 border-t border-(--ui-stroke-secondary)' }),
    item('Delete (trash)', () => $modal.set({ type: 'delete', node }))
  ] })
}
function ModalLayer() {
  const m = useValue($modal); if (!m) return null
  const [val, setVal] = useState(m.node?.name || '')
  const submit = () => {
    if (m.type === 'rename') doRename(m.node, val.trim())
    else if (m.type === 'newfile') createFile(m.parent, val.trim())
    else if (m.type === 'newfolder') createFolderViaAgent(m.parent, val.trim())
    else if (m.type === 'delete') doDelete(m.node)
    $modal.set(null)
  }
  const title = { rename: 'Rename', newfile: 'New file', newfolder: 'New folder', delete: 'Delete' }[m.type]
  const placeholder = { rename: 'name', newfile: 'file.txt', newfolder: 'folder' }[m.type] || ''
  const confirmLabel = m.type === 'delete' ? 'Delete' : 'Create'
  return jsxs('div', { className: 'absolute inset-0 z-40 flex items-center justify-center bg-black/40', onClick: () => $modal.set(null), children: [
    jsxs('div', { className: 'w-72 rounded-lg border border-(--ui-stroke-secondary) bg-(--card) p-3 shadow-xl', onClick: (e) => e.stopPropagation(), children: [
      jsx('div', { className: 'mb-2 text-sm font-medium', children: title }),
      m.type === 'delete'
        ? jsx('div', { className: 'mb-3 text-xs text-(--ui-text-tertiary)', children: `Move “${m.node.name}” to trash?` })
        : jsx(Input, { className: 'mb-3', value: val, autoFocus: true, placeholder, onChange: setVal,
            onKeyDown: (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') $modal.set(null) } }),
      jsxs('div', { className: 'flex justify-end gap-2', children: [
        jsx(Button, { size: 'sm', onClick: () => $modal.set(null), children: 'Cancel' }),
        m.type === 'delete'
          ? jsx(Button, { size: 'sm', variant: 'primary', className: 'bg-red-500 hover:bg-red-600', onClick: submit, children: confirmLabel })
          : jsx(Button, { size: 'sm', variant: 'primary', onClick: submit, children: confirmLabel })
      ] })
    ] })
  ] })
}
function FileManagerPane() {
  const tabs = useValue($openTabs); const root = useValue($root)
  useEffect(() => {
    (async () => {
      const all = await refreshProjects()
      if (!all.length) { selectRoot(homeDir()); return }
      const pref = all.find(p => p.root === $root.get()) || all[0]
      selectRoot(pref.root)
    })()
    return () => { const w = $watchId.get(); if (w?.stop) { try { w.stop() } catch {} } }
  }, [])
  return jsxs('div', { className: 'relative flex h-full flex-col', children: [
    jsx(Toolbar, {}),
    jsx(Breadcrumb, {}),
    jsx(ProjectActions, {}),
    root ? jsx(Input, { className: 'm-2 h-7', placeholder: 'Filter files…', value: useValue($search), onChange: (v) => $search.set(v) }) : null,
    root ? jsx(Tree, {}) : jsx(EmptyState, { title: 'No folder open', description: 'Use Projects ▾ to pick a repo.' }),
    jsx(EditorArea, {}),
    jsx(ProjectPicker, {}),
    jsx(ContextMenuLayer, {}),
    jsx(ModalLayer, {}),
    jsx(DiffView, {})
  ] })
}

// ── register ──────────────────────────────────────────────────────────────────
export default {
  id: ID,
  name: 'File Manager',
  register(ctx) {
    ctx.register({ id: 'pane', area: 'panes', title: 'Files', data: { placement: 'left', width: '320px' }, render: () => jsx(FileManagerPane, {}) })
  }
}
