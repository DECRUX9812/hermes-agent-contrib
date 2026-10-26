/**
 * Knowledge & RAG — Desktop Pane & Manager for LangChain indexes.
 *
 * Provides visual index inspection, one-click indexing, interactive semantic
 * query sandbox, auto-crawling, and bot/agent knowledge binding.
 */

import * as React from 'react'
import { cn, haptic, host, Tip, useQuery, useQueryClient } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'langchain-rag'

let ctxRest = async () => { throw new Error('not registered') }

function StatusChip() {
  const { data } = useQuery({
    queryKey: [ID, 'stats'],
    queryFn: async () => ctxRest('/stats', { method: 'GET', timeoutMs: 8000 }),
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
  })

  const total = (data && data.total_indexes) || 0
  const chunks = (data && data.total_chunks) || 0

  return jsx(Tip, {
    label: `LangChain Auto-RAG: ${total} index(es) · ${chunks.toLocaleString()} chunks auto-indexed`,
    children: jsxs('button', {
      className: cn(
        'inline-flex h-full items-center gap-1 px-1.5 font-mono text-[0.6875rem] transition-colors',
        'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground'
      ),
      type: 'button',
      onClick: () => {
        haptic('tap')
        host.navigate?.('/knowledge')
      },
      children: [
        jsx('span', { className: 'text-xs', children: '📚' }),
        jsx('span', { children: `RAG: ${chunks.toLocaleString()} chunks` })
      ]
    })
  })
}

function RagPane() {
  const qc = useQueryClient()
  const [tab, setTab] = React.useState('indexes') // 'indexes' | 'search' | 'bots'

  // Form states
  const [indexPath, setIndexPath] = React.useState('')
  const [indexName, setIndexName] = React.useState('')
  const [isIndexing, setIsIndexing] = React.useState(false)
  const [isAutoCrawling, setIsAutoCrawling] = React.useState(false)

  // Query states
  const [queryTarget, setQueryTarget] = React.useState('all')
  const [queryText, setQueryText] = React.useState('')
  const [queryResults, setQueryResults] = React.useState(null)
  const [isSearching, setIsSearching] = React.useState(false)

  // Query all indexes
  const { data, isLoading } = useQuery({
    queryKey: [ID, 'stats'],
    queryFn: async () => ctxRest('/stats', { method: 'GET', timeoutMs: 10000 }),
    refetchInterval: 10000,
  })

  const indexes = (data && data.indexes) || []

  const handleAutoCrawl = async () => {
    setIsAutoCrawling(true)
    haptic('tap')
    try {
      const res = await ctxRest('/autocrawl', { method: 'POST' })
      if (res && res.success) {
        host.notify({ kind: 'success', message: `Auto-crawled & updated ${res.crawled_sources} project sources!` })
        qc.invalidateQueries({ queryKey: [ID, 'stats'] })
      }
    } catch (err) {
      host.notify({ kind: 'error', message: 'Auto-crawl failed.' })
    } finally {
      setIsAutoCrawling(false)
    }
  }

  const handleIndexSubmit = async (e) => {
    e?.preventDefault()
    if (!indexPath || !indexName) {
      host.notify({ kind: 'error', message: 'Please provide both directory path and index name.' })
      return
    }
    setIsIndexing(true)
    haptic('tap')
    try {
      const res = await ctxRest('/index', {
        method: 'POST',
        body: { path: indexPath, index_name: indexName, chunk_size: 1000, chunk_overlap: 150 }
      })
      if (res && res.success) {
        host.notify({ kind: 'success', message: `Indexed ${res.total_chunks} chunks across ${res.total_files} files!` })
        setIndexPath('')
        setIndexName('')
        qc.invalidateQueries({ queryKey: [ID, 'stats'] })
      } else {
        host.notify({ kind: 'error', message: res.error || 'Indexing failed' })
      }
    } catch (err) {
      host.notify({ kind: 'error', message: String(err.message || err) })
    } finally {
      setIsIndexing(false)
    }
  }

  const handleSearchSubmit = async (e) => {
    e?.preventDefault()
    if (!queryText) {
      host.notify({ kind: 'error', message: 'Enter a search query.' })
      return
    }
    setIsSearching(true)
    haptic('tap')
    try {
      const target = queryTarget === 'all' ? '' : queryTarget
      const res = await ctxRest('/query', {
        method: 'POST',
        body: { index_name: target, query: queryText, top_k: 5 }
      })
      if (res && res.success) {
        setQueryResults(res.matches || [])
      } else {
        host.notify({ kind: 'error', message: res.error || 'Search failed' })
      }
    } catch (err) {
      host.notify({ kind: 'error', message: String(err.message || err) })
    } finally {
      setIsSearching(false)
    }
  }

  const handleDelete = async (name) => {
    if (!confirm(`Delete index "${name}"?`)) return
    haptic('tap')
    try {
      await ctxRest(`/index/${encodeURIComponent(name)}`, { method: 'DELETE' })
      host.notify({ kind: 'success', message: `Index "${name}" deleted.` })
      qc.invalidateQueries({ queryKey: [ID, 'stats'] })
    } catch (err) {
      host.notify({ kind: 'error', message: 'Failed to delete index' })
    }
  }

  return jsxs('div', {
    className: 'flex h-full flex-col gap-3 overflow-hidden p-3 font-sans text-xs',
    children: [
      // Top Header
      jsxs('div', {
        className: 'flex items-center justify-between border-b border-(--ui-stroke-secondary) pb-2',
        children: [
          jsxs('div', {
            className: 'flex items-center gap-2',
            children: [
              jsx('span', { className: 'text-base', children: '📚' }),
              jsxs('div', {
                children: [
                  jsx('div', { className: 'font-semibold text-(--ui-text-primary)', children: 'Knowledge RAG' }),
                  jsx('div', { className: 'text-[10px] text-(--ui-text-quaternary)', children: 'Auto-Indexed Workspaces' })
                ]
              })
            ]
          }),
          jsxs('div', {
            className: 'flex items-center gap-1 rounded bg-(--chrome-action-hover) p-0.5',
            children: [
              jsx('button', {
                className: cn('rounded px-2 py-0.5 font-medium transition-colors', tab === 'indexes' ? 'bg-(--ui-accent) text-white' : 'text-(--ui-text-tertiary) hover:text-(--ui-text-primary)'),
                onClick: () => setTab('indexes'),
                children: 'Indexes'
              }),
              jsx('button', {
                className: cn('rounded px-2 py-0.5 font-medium transition-colors', tab === 'search' ? 'bg-(--ui-accent) text-white' : 'text-(--ui-text-tertiary) hover:text-(--ui-text-primary)'),
                onClick: () => setTab('search'),
                children: 'Search'
              }),
              jsx('button', {
                className: cn('rounded px-2 py-0.5 font-medium transition-colors', tab === 'bots' ? 'bg-(--ui-accent) text-white' : 'text-(--ui-text-tertiary) hover:text-(--ui-text-primary)'),
                onClick: () => setTab('bots'),
                children: 'Bots'
              })
            ]
          })
        ]
      }),

      // Content Tab 1: Indexes List & Auto-Crawl
      tab === 'indexes' && jsxs('div', {
        className: 'flex flex-1 flex-col gap-3 overflow-y-auto pr-1',
        children: [
          // Auto-Crawl Action Box
          jsxs('div', {
            className: 'flex items-center justify-between rounded-lg border border-(--ui-stroke-secondary) bg-(--chrome-action-hover) p-2.5',
            children: [
              jsxs('div', {
                className: 'flex flex-col',
                children: [
                  jsx('span', { className: 'font-medium text-(--ui-text-primary)', children: '⚡ Background Auto-Indexer' }),
                  jsx('span', { className: 'text-[10px] text-(--ui-text-quaternary)', children: 'Crawls ~/Code, Skills, Sessions, Vaults hourly' })
                ]
              }),
              jsx('button', {
                className: cn(
                  'rounded bg-(--ui-accent) px-2.5 py-1 font-medium text-white transition-opacity',
                  isAutoCrawling ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
                ),
                disabled: isAutoCrawling,
                onClick: handleAutoCrawl,
                children: isAutoCrawling ? 'Scanning...' : 'Sync Now'
              })
            ]
          }),

          // Manual Index Add Box
          jsxs('div', {
            className: 'flex flex-col gap-2 rounded-lg border border-(--ui-stroke-secondary) bg-(--chrome-action-hover) p-2.5',
            children: [
              jsx('div', { className: 'font-medium text-(--ui-text-primary)', children: '➕ Add Custom Folder' }),
              jsxs('div', {
                className: 'flex flex-col gap-1.5',
                children: [
                  jsx('input', {
                    className: 'rounded border border-(--ui-stroke-secondary) bg-transparent px-2 py-1 text-xs text-(--ui-text-primary) placeholder:text-(--ui-text-quaternary) focus:outline-none focus:border-(--ui-accent)',
                    placeholder: 'Custom Path (e.g. ~/MyDocs)',
                    value: indexPath,
                    onChange: (e) => setIndexPath(e.target.value)
                  }),
                  jsx('input', {
                    className: 'rounded border border-(--ui-stroke-secondary) bg-transparent px-2 py-1 text-xs text-(--ui-text-primary) placeholder:text-(--ui-text-quaternary) focus:outline-none focus:border-(--ui-accent)',
                    placeholder: 'Index Name (e.g. legal-docs)',
                    value: indexName,
                    onChange: (e) => setIndexName(e.target.value)
                  }),
                  jsx('button', {
                    className: cn(
                      'rounded border border-(--ui-stroke-secondary) py-1 font-medium text-(--ui-text-primary) hover:bg-(--chrome-action-hover) transition-opacity',
                      isIndexing ? 'opacity-50 cursor-not-allowed' : ''
                    ),
                    disabled: isIndexing,
                    onClick: handleIndexSubmit,
                    children: isIndexing ? 'Indexing...' : 'Index Custom Path'
                  })
                ]
              })
            ]
          }),

          // Existing Indexes
          jsx('div', { className: 'font-medium text-(--ui-text-secondary)', children: `Active Indexes (${indexes.length})` }),
          indexes.map((idx) => jsxs('div', {
            key: idx.index_name,
            className: 'flex flex-col gap-1 rounded-md border border-(--ui-stroke-secondary) bg-(--chrome-action-hover) p-2 text-xs',
            children: [
              jsxs('div', {
                className: 'flex items-center justify-between',
                children: [
                  jsx('span', { className: 'font-semibold text-(--ui-text-primary)', children: idx.index_name }),
                  jsx('button', {
                    className: 'text-[11px] text-(--ui-text-quaternary) hover:text-red-400',
                    onClick: () => handleDelete(idx.index_name),
                    children: '🗑 Delete'
                  })
                ]
              }),
              jsx('div', { className: 'truncate text-[11px] font-mono text-(--ui-text-tertiary)', title: idx.source_path, children: idx.source_path }),
              jsxs('div', {
                className: 'flex items-center gap-2 text-[10px] text-(--ui-text-quaternary)',
                children: [
                  jsx('span', { children: `📦 ${idx.total_chunks.toLocaleString()} chunks` }),
                  jsx('span', { children: `📄 ${idx.total_files} files` }),
                ]
              })
            ]
          }))
        ]
      }),

      // Content Tab 2: Universal Search Sandbox
      tab === 'search' && jsxs('div', {
        className: 'flex flex-1 flex-col gap-2.5 overflow-y-auto pr-1',
        children: [
          jsxs('div', {
            className: 'flex flex-col gap-1.5',
            children: [
              jsx('select', {
                className: 'rounded border border-(--ui-stroke-secondary) bg-transparent px-2 py-1 text-xs text-(--ui-text-primary) focus:outline-none',
                value: queryTarget,
                onChange: (e) => setQueryTarget(e.target.value),
                children: [
                  jsx('option', { value: 'all', children: '🔍 Search All Projects & Knowledge Bases' }),
                  ...indexes.map((idx) => jsx('option', { key: idx.index_name, value: idx.index_name, children: `${idx.index_name} (${idx.total_chunks.toLocaleString()} chunks)` }))
                ]
              }),
              jsx('input', {
                className: 'rounded border border-(--ui-stroke-secondary) bg-transparent px-2 py-1 text-xs text-(--ui-text-primary) placeholder:text-(--ui-text-quaternary) focus:outline-none focus:border-(--ui-accent)',
                placeholder: 'Ask question or keyword...',
                value: queryText,
                onChange: (e) => setQueryText(e.target.value)
              }),
              jsx('button', {
                className: 'rounded bg-(--ui-accent) py-1 font-medium text-white hover:opacity-90',
                disabled: isSearching,
                onClick: handleSearchSubmit,
                children: isSearching ? 'Retrieving...' : 'Search Across Knowledge'
              })
            ]
          }),

          queryResults && jsxs('div', {
            className: 'flex flex-col gap-2 pt-1',
            children: [
              jsx('div', { className: 'font-medium text-(--ui-text-secondary)', children: `Matches (${queryResults.length})` }),
              queryResults.length === 0 ? jsx('div', { className: 'text-(--ui-text-quaternary)', children: 'No matches found.' }) : null,
              queryResults.map((m, i) => jsxs('div', {
                key: i,
                className: 'flex flex-col gap-1 rounded border border-(--ui-stroke-secondary) bg-(--chrome-action-hover) p-2 text-xs',
                children: [
                  jsxs('div', {
                    className: 'flex items-center justify-between text-[10px] text-(--ui-text-tertiary)',
                    children: [
                      jsx('span', { className: 'truncate font-mono font-medium text-(--ui-text-primary)', title: m.source, children: `${m.index_name ? `[${m.index_name}] ` : ''}${m.filename || m.source}` }),
                      jsx('span', { className: 'font-semibold text-(--ui-accent)', children: `Score: ${m.score}` })
                    ]
                  }),
                  jsx('div', { className: 'line-clamp-4 font-mono text-[11px] text-(--ui-text-secondary)', children: m.content })
                ]
              }))
            ]
          })
        ]
      }),

      // Content Tab 3: Bot Wiring Info
      tab === 'bots' && jsxs('div', {
        className: 'flex flex-1 flex-col gap-3 overflow-y-auto pr-1 text-xs text-(--ui-text-secondary)',
        children: [
          jsx('div', { className: 'font-medium text-(--ui-text-primary)', children: '🤖 100% Automatic Bot Retrieval' }),
          jsx('p', {
            className: 'leading-relaxed text-(--ui-text-tertiary)',
            children: 'All bots automatically have access to rag_query. If you ask any question about your projects or notes, the bot will search across all indexed folders automatically without needing an index name specified.'
          }),
          jsxs('div', {
            className: 'flex flex-col gap-1 rounded bg-(--chrome-action-hover) p-2 font-mono text-[11px]',
            children: [
              jsx('span', { className: 'text-(--ui-text-quaternary)', children: '// Example Autonomous Tool Call:' }),
              jsx('span', { className: 'text-(--ui-accent)', children: 'rag_query(query="circuit breaker directive")' })
            ]
          })
        ]
      })
    ]
  })
}

export default {
  id: ID,
  name: 'Knowledge & RAG',
  register(ctx) {
    ctxRest = (path, opts) => ctx.rest(path, opts)

    // Register Statusbar Chip
    ctx.register({
      id: 'rag-chip',
      area: 'statusBar.right',
      order: 190,
      render: () => jsx(StatusChip, {})
    })

    // Register UI Pane
    ctx.register({
      id: 'rag-pane',
      area: 'panes',
      title: 'Knowledge & RAG',
      data: { placement: 'right', width: '330px' },
      render: () => jsx(RagPane, {})
    })
  }
}
