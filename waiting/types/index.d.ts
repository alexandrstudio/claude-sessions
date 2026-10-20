export type SessionState = 'working' | 'waiting' | 'idle' | 'closed'

// One session's line in the shared folder, rewritten on every change and on
// a heartbeat, so a reader can tell a live session from one that crashed.
export type Beacon = {
  sessionId: string
  cwd: string
  state: SessionState
  reason: string
  since: number
  seen: number
}

export type Waiter = { sessionId: string; folder: string; reason: string; minutes: number }

declare module 'claude-code' {
  interface PluginState {
    waiting: { others: Waiter[] }
  }
}
