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
  // The archive copy matches the live file (size and mtime), so the live one
  // can be removed safely.
  archiveCurrent: boolean
  isRunning: boolean
}

export type IndexState = {
  sessions: SessionRow[]
  isLoading: boolean
  isArchiveMounted: boolean
  error?: string
}

export type View = 'list' | 'info' | 'settings'

export type Editing = 'filter' | 'folder' | null

declare module 'claude-code' {
  interface PluginState {
    sessions: {
      index: IndexState
      filter: string
      selected: string | null
      notice: string
      view: View
      // The session whose "move to archive" waits for a second press.
      confirmMove: string | null
      archiveStatus: string
      editing: Editing
    }
  }
}
