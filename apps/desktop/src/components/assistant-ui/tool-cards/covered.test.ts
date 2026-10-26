import { describe, expect, it } from 'vitest'

import { coveredByToolCards } from './covered'

describe('coveredByToolCards', () => {
  describe('covered tools (returns true)', () => {
    it('returns true for file reads and searches', () => {
      expect(coveredByToolCards({ toolName: 'read_file', args: { path: '/src/main.ts' } })).toBe(true)
      expect(coveredByToolCards({ toolName: 'search_files', args: { query: 'export' } })).toBe(true)
      expect(coveredByToolCards({ toolName: 'list_files', args: { path: '/src' } })).toBe(true)
      expect(coveredByToolCards({ toolName: 'list_directory', args: { path: '/src' } })).toBe(true)
    })

    it('returns true for web and browser tools', () => {
      expect(coveredByToolCards({ toolName: 'web_search', args: { query: 'hermes agent' } })).toBe(true)
      expect(coveredByToolCards({ toolName: 'fetch_url', args: { url: 'https://example.com' } })).toBe(true)
      expect(coveredByToolCards({ toolName: 'browser_navigate', args: { url: 'https://example.com' } })).toBe(true)
      expect(coveredByToolCards({ toolName: 'browser_click', args: { selector: '#btn' } })).toBe(true)
    })

    it('returns true for regular terminal and code execution', () => {
      expect(coveredByToolCards({ toolName: 'terminal', args: { command: 'ls -la' } })).toBe(true)
      expect(coveredByToolCards({ toolName: 'terminal', args: { command: 'npm test' } })).toBe(true)
      expect(coveredByToolCards({ toolName: 'terminal', args: { command: 'git status' } })).toBe(true)
      expect(coveredByToolCards({ toolName: 'execute_code', args: { code: 'console.log(1)' } })).toBe(true)
      expect(coveredByToolCards({ toolName: 'process', args: { pid: 123 } })).toBe(true)
    })

    it('returns true for generic/memory tools', () => {
      expect(coveredByToolCards({ toolName: 'memory', args: { action: 'recall' } })).toBe(true)
      expect(coveredByToolCards({ toolName: 'cronjob', args: {} })).toBe(true)
      expect(coveredByToolCards({ toolName: 'custom_extension_tool', args: {} })).toBe(true)
    })

    it('returns true for failed calls that the card stack renders as error cards', () => {
      expect(
        coveredByToolCards({
          toolName: 'read_file',
          args: { path: '/missing.txt' },
          isError: true,
          result: { error: 'disk full, act now' }
        })
      ).toBe(true)
      expect(
        coveredByToolCards({
          toolName: 'terminal',
          args: { command: 'exit 1' },
          result: { exit_code: 1, output: 'command failed' }
        })
      ).toBe(true)
    })
  })

  describe('uncovered tools (returns false)', () => {
    it('returns false for todo tools', () => {
      expect(coveredByToolCards({ toolName: 'todo' })).toBe(false)
      expect(coveredByToolCards({ toolName: 'todo_list' })).toBe(false)
    })

    it('returns false for terminal commands that are inter-agent delivery notices', () => {
      expect(
        coveredByToolCards({
          toolName: 'terminal',
          args: { command: 'hermes -p beta chat -q "Message from alpha: please review"' }
        })
      ).toBe(false)
    })

    it('returns false for react_to_message', () => {
      expect(coveredByToolCards({ toolName: 'react_to_message', args: { message_id: '1', emoji: '👍' } })).toBe(
        false
      )
      expect(
        coveredByToolCards({
          toolName: 'react_to_message',
          args: { message_id: '1', emoji: '👍' },
          isError: false
        })
      ).toBe(false)
      expect(
        coveredByToolCards({
          toolName: 'react_to_message',
          args: { message_id: '1', emoji: '👍' },
          isError: true
        })
      ).toBe(false)
    })

    it('returns false for card tools (diffs, clarify, visualization, catalog, connections)', () => {
      expect(coveredByToolCards({ toolName: 'clarify' })).toBe(false)
      expect(coveredByToolCards({ toolName: 'create_visualization' })).toBe(false)
      expect(coveredByToolCards({ toolName: 'delegate_task' })).toBe(false)
      expect(coveredByToolCards({ toolName: 'image_generate' })).toBe(false)
      expect(coveredByToolCards({ toolName: 'manage_catalog' })).toBe(false)
      expect(coveredByToolCards({ toolName: 'manage_connections' })).toBe(false)
      expect(coveredByToolCards({ toolName: 'setup_beat' })).toBe(false)

      // file edits (diffs)
      expect(coveredByToolCards({ toolName: 'edit_file' })).toBe(false)
      expect(coveredByToolCards({ toolName: 'write_file' })).toBe(false)
      expect(coveredByToolCards({ toolName: 'patch' })).toBe(false)
    })

    it('returns false for set_theme and bridged set_theme tool calls', () => {
      expect(coveredByToolCards({ toolName: 'set_theme', args: { picker: 'accent' } })).toBe(false)
      expect(
        coveredByToolCards({
          toolName: 'tool_call',
          args: { calls: [{ name: 'set_theme', arguments: { picker: 'accent' } }] }
        })
      ).toBe(false)
    })

    it('returns false for connector executions with labels', () => {
      expect(
        coveredByToolCards({
          toolName: 'connectors__slack__send_message',
          args: {
            hermes_tool_labels: [{ app: 'slack', name: 'send_message', text: 'Send Slack message' }]
          }
        })
      ).toBe(false)
    })
  })
})
