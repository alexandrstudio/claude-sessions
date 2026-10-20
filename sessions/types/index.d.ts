export type SessionRow = {
  id: string
  project: string
  path: string
  cwd: string | null
  title: string | null
  first: string
  prompts: number
  mtime: number
  size: number
  isLive: boolean
  inArchive: boolean
}

export type IndexState = {
  sessions: SessionRow[]
  isLoading: boolean
  isArchiveMounted: boolean
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    sessions: {
      index: IndexState
      filter: string
      selected: string | null
      notice: string
    }
  }
}
