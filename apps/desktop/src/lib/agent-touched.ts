import { deriveChangedFiles } from '@/components/assistant-ui/thread/changed-files'

interface MessageLike {
  parts?: readonly unknown[]
  pending?: boolean
  role?: string
}

/**
 * Every file the agent edited in this conversation, as absolute paths (a
 * repo-relative tool path is resolved against `cwd`). The file tree marks
 * these so "what did this chat touch" reads at a glance, apart from what git
 * says is dirty.
 */
export function agentTouchedPaths(messages: readonly MessageLike[], cwd: string): Set<string> {
  const root = cwd.replace(/[\\/]+$/, '')
  const touched = new Set<string>()

  for (const message of messages) {
    if (message.role !== 'assistant' || !message.parts?.length) {
      continue
    }

    for (const file of deriveChangedFiles(message.parts)) {
      const path = file.path.replace(/\\/g, '/')
      const absolute = path.startsWith('/') || /^[a-zA-Z]:\//.test(path) || !root ? path : `${root}/${path.replace(/^\.\//, '')}`

      touched.add(absolute)
    }
  }

  return touched
}
