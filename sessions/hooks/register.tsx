import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { IndexState, SessionRow, View } from '../types'
import { INDEXER } from './indexer'
import { ARCHIVER, MOVER, RESTORE } from './scripts'

const PANE = 'sessions'
// Past this many rows the list is cut; the filter narrows it down instead.
const MAX_ROWS = 200
// The first archive run waits until the session has settled in.
const FIRST_ARCHIVE_MS = 20_000
const ARCHIVE_EVERY_MS = 6 * 60 * 60 * 1000

// Settings, set again on every (re)load: a change in /config or in the pane's
// settings view reloads the module with the new values.
let archiveDir = ''
let autoArchive = true
// This session's own id: it is running, so it can never be moved.
let currentId = ''

const index = atom({ plugin: 'sessions', key: 'index' } as const, {
  sessions: [],
  isLoading: false,
  isArchiveMounted: false,
} as IndexState)
const filter = atom({ plugin: 'sessions', key: 'filter' } as const, '')
const selected = atom({ plugin: 'sessions', key: 'selected' } as const, null as string | null)
const notice = atom({ plugin: 'sessions', key: 'notice' } as const, '')
const view = atom({ plugin: 'sessions', key: 'view' } as const, 'list' as View)
const confirmMove = atom({ plugin: 'sessions', key: 'confirmMove' } as const, null as string | null)
const archiveStatus = atom({ plugin: 'sessions', key: 'archiveStatus' } as const, '')

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

const resumeCommand = (s: SessionRow) =>
  s.cwd ? `cd ${shellQuote(s.cwd)} && claude -r ${s.id}` : `claude -r ${s.id}`

// The last two segments of the folder say which project it is; the full
// path is in the detail view.
const shortFolder = (s: SessionRow) => {
  if (!s.cwd) return s.project
  const parts = s.cwd.split('/').filter(Boolean)
  return parts.slice(-2).join('/')
}

const ago = (mtime: number) => {
  const minutes = Math.max(0, Math.round((Date.now() / 1000 - mtime) / 60))
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`
  if (minutes < 60 * 24 * 60) return `${Math.round(minutes / 60 / 24)}d`
  return `${Math.round(minutes / 60 / 24 / 30)}mo`
}

const day = (mtime: number) => new Date(mtime * 1000).toISOString().slice(0, 16).replace('T', ' ')

const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16)

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

// Words narrow by text; `:archived`, `:local` and `:running` narrow by where
// the session is.
const TAGS: Record<string, (s: SessionRow) => boolean> = {
  ':archived': s => !s.isLive,
  ':local': s => s.isLive && !s.inArchive,
  ':running': s => s.isRunning,
}

const matches = (s: SessionRow, needle: string) => {
  const hay = `${s.title ?? ''} ${s.first} ${s.cwd ?? ''} ${s.project} ${s.id}`.toLowerCase()
  return needle
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every(word => (TAGS[word] ? TAGS[word](s) : hay.includes(word)))
}

const canMove = (s: SessionRow) =>
  archiveDir !== '' && s.isLive && s.inArchive && s.archiveCurrent && !s.isRunning && s.id !== currentId

const whereText = (s: SessionRow) => {
  if (!s.isLive) return 'archive only'
  if (!s.inArchive) return archiveDir ? 'on this Mac only (not archived yet)' : 'on this Mac'
  return s.archiveCurrent ? 'on this Mac and archived' : 'on this Mac; the archive copy is older'
}

const lastLine = (text: string) => text.trim().split('\n').pop() ?? ''

async function runPy($: EngineInterface, script: string, args: string[], timeoutMs = 120_000) {
  const ran = await $.process.run(['/usr/bin/env', 'python3', '-I', '-c', script, ...args], { timeoutMs })
  if (ran.exitCode !== 0) throw new Error(lastLine(ran.stderr) || `exit ${ran.exitCode}`)
  return JSON.parse(ran.stdout) as Record<string, unknown>
}

async function refresh($: EngineInterface) {
  await update($, index, old => ({ ...old, isLoading: true, error: undefined }))
  const home = (await $.env.get('HOME')) ?? ''
  try {
    const parsed = (await runPy($, INDEXER, [
      `${home}/.claude/projects`,
      archiveDir,
      `${home}/.claude/cache/sessions-mod-index.json`,
      `${home}/.claude/sessions`,
    ])) as { sessions: SessionRow[]; archiveMounted: boolean }
    await update($, index, () => ({
      sessions: parsed.sessions,
      isLoading: false,
      isArchiveMounted: parsed.archiveMounted,
    }))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await update($, index, old => ({ ...old, isLoading: false, error: message }))
  }
}

async function archiveNow($: EngineInterface) {
  if (archiveDir === '') {
    await update($, archiveStatus, () => 'No archive folder set.')
    return
  }
  await update($, archiveStatus, () => 'Archiving…')
  const home = (await $.env.get('HOME')) ?? ''
  const at = clock(await $.clock.now())
  try {
    const done = (await runPy($, ARCHIVER, [`${home}/.claude/projects`, archiveDir], 600_000)) as { copied: number }
    await update($, archiveStatus, () => `Last archived ${at} UTC: ${done.copied} files copied.`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await update($, archiveStatus, () => `Archive skipped ${at} UTC: ${message}.`)
  }
  await refresh($)
}

async function restore($: EngineInterface, s: SessionRow) {
  const home = (await $.env.get('HOME')) ?? ''
  try {
    await runPy($, RESTORE, [s.path, `${home}/.claude/projects/${s.project}`])
    await update($, notice, () => 'Restored. The resume command works again.')
  } catch (err) {
    await update($, notice, () => `Restore failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  await refresh($)
}

// The first press asks, the second removes the copy on this Mac; the script
// checks again that the archive holds an identical copy before deleting.
async function moveToArchive($: EngineInterface, s: SessionRow) {
  if ((await read($, confirmMove)) !== s.id) {
    await update($, confirmMove, () => s.id)
    await update($, notice, () => 'Press m again to remove the copy on this Mac. The archive keeps it; r brings it back.')
    return
  }
  await update($, confirmMove, () => null)
  try {
    await runPy($, MOVER, [s.path, archiveDir, s.project])
    await update($, notice, () => 'Removed from this Mac. It stays in the archive.')
  } catch (err) {
    await update($, notice, () => `Not moved: ${err instanceof Error ? err.message : String(err)}.`)
  }
  await refresh($)
}

// The row is `sessions.<field>`; should an install name it otherwise, the
// /config rows are searched for this mod's field.
async function setOption($: EngineInterface, field: string, value: string | boolean) {
  let done
  try {
    done = await $.config.set({ key: `sessions.${field}`, value })
  } catch {
    const row = (await $.config.list()).find(r => r.key.startsWith('sessions') && r.key.endsWith(`.${field}`))
    if (!row) {
      await update($, notice, () => `Not saved: no setting ${field} found. Set it in /config.`)
      return
    }
    done = await $.config.set({ key: row.key, value })
  }
  await update($, notice, () => ('deny' in done && done.deny ? `Not saved: ${done.deny}` : 'Saved.'))
}

async function go($: EngineInterface, next: View) {
  await update($, view, () => next)
  await update($, selected, () => null)
  await update($, confirmMove, () => null)
  await update($, notice, () => '')
}

const openPane = ($: EngineInterface) =>
  $.ui.open({ id: PANE, title: 'Sessions', focus: true, closeOnEscape: true })

const INFO: [string, string][] = [
  ['The list', 'Every session in ~/.claude/projects, plus the archive folder when one is set. Newest first; blue folders are on this Mac, yellow ones only in the archive, ● marks a session running now.'],
  ['Filter', 'Type words to match title, first prompt or folder. :archived shows archive-only sessions, :local the ones not archived yet, :running the open ones. Enter opens the first match.'],
  ['A session', 'c copies the resume command (paste it in a new terminal tab). r restores an archive-only session to this Mac. m moves it to the archive: removes the copy on this Mac once the archive holds an identical one; press m twice. b goes back.'],
  ['Archive', 'With an archive folder set, the mod copies new and changed sessions there when a session starts and every 6 hours (turn it off in settings). It never deletes from the archive. An archive on an external drive waits until the drive is plugged in.'],
  ['Keep sessions longer', 'Claude Code deletes transcripts after 30 days by default. Set "cleanupPeriodDays": 36500 in ~/.claude/settings.json to keep them; with the archive running you can also leave the default and let the archive keep the old ones.'],
  ['Keys', '0 refresh · i this page · s settings · Esc closes the pane. Tab walks the buttons.'],
]

export const register: Register = (on, options) => {
  archiveDir = typeof options.archiveDir === 'string' ? options.archiveDir.trim() : ''
  autoArchive = options.autoArchive !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sessions',
      description: 'Browse all sessions across projects and the archive',
    })
    currentId = await $.session.id()
    if (archiveDir !== '' && autoArchive) {
      $.clock.after(FIRST_ARCHIVE_MS, () => void archiveNow($))
      $.clock.every(ARCHIVE_EVERY_MS, () => void archiveNow($))
    }

    return next(e)
  })

  on('command.run', { command: 'sessions' }, async $ => {
    await go($, 'list')
    void refresh($)
    await openPane($)

    return { text: 'Sessions pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    // Mobile draws no text field; there the list shows unfiltered.
    const Input = 'Input' in ui ? ui.Input : undefined
    const state = await read($, index)
    const needle = await read($, filter)
    const pickedId = await read($, selected)
    const message = await read($, notice)
    const current = await read($, view)
    const status = await read($, archiveStatus)
    const width = Math.max(30, e.props.bodyColumns)

    const back = <Button key="back" label="Back" hotkey="b" onPress={() => go($, 'list')} />
    const footer = message !== '' && <Text color="green" wrap="wrap">{message}</Text>

    if (current === 'info') {
      return (
        <Box flexDirection="column">
          <Text bold>What /sessions can do</Text>
          {INFO.map(([title, text]) => (
            <Box flexDirection="column" key={title}>
              <Text> </Text>
              <Text color="cyan">{title}</Text>
              <Text wrap="wrap">{text}</Text>
            </Box>
          ))}
          <Text> </Text>
          <Box flexDirection="row" gap={2}>
            <Button key="to-settings" label="Settings" hotkey="s" onPress={() => go($, 'settings')} />
            {back}
          </Box>
        </Box>
      )
    }

    if (current === 'settings') {
      return (
        <Box flexDirection="column">
          <Text bold>Archive settings</Text>
          <Text> </Text>
          <Text>Archive folder: {archiveDir || <Text dimColor>none (no archive)</Text>}</Text>
          {Input && (
            <Input
              key="archiveDir"
              label="New folder: "
              placeholder="/Volumes/MyDrive/claude-sessions/projects (empty: no archive)"
              value={archiveDir}
              submitLabel="save"
              onSubmit={(value: string) => setOption($, 'archiveDir', value.trim())}
            />
          )}
          <Text dimColor wrap="wrap">
            The folder gets the same layout as ~/.claude/projects and is created on the first run. On an external drive
            the archive waits until the drive is plugged in.
          </Text>
          <Text> </Text>
          <Text>
            Archive automatically: {autoArchive ? 'on' : 'off'}
            <Text dimColor> (when a session starts and every 6 hours)</Text>
          </Text>
          {status !== '' && <Text dimColor wrap="wrap">{status}</Text>}
          <Text> </Text>
          <Box flexDirection="row" gap={2}>
            <Button
              key="toggle-auto"
              label={autoArchive ? 'Turn automatic archive off' : 'Turn automatic archive on'}
              hotkey="t"
              onPress={() => setOption($, 'autoArchive', !autoArchive)}
            />
            {archiveDir !== '' && <Button key="archive-now" label="Archive now" hotkey="a" onPress={() => archiveNow($)} />}
            {back}
          </Box>
          {footer}
        </Box>
      )
    }

    const picked = pickedId ? state.sessions.find(s => s.id === pickedId) : undefined
    if (picked) {
      const cmd = resumeCommand(picked)
      const isConfirming = (await read($, confirmMove)) === picked.id

      return (
        <Box flexDirection="column">
          <Text bold wrap="truncate">{picked.title ?? oneLine(picked.first)}</Text>
          <Text dimColor>
            {day(picked.mtime)} · {picked.prompts} prompts · {Math.round(picked.size / 1024)} KB · {whereText(picked)}
            {picked.isRunning ? ' · running now' : ''}
          </Text>
          <Text> </Text>
          <Text>Folder: {picked.cwd ?? '(unknown)'}</Text>
          <Text dimColor wrap="wrap">First prompt: {oneLine(picked.first).slice(0, 300)}</Text>
          <Text> </Text>
          <Text color="cyan" wrap="wrap">{cmd}</Text>
          <Text> </Text>
          <Box flexDirection="row" gap={2}>
            <Button
              key="copy"
              label="Copy resume command"
              hotkey="c"
              variant="primary"
              autoFocus
              onPress={async press => {
                const copied = await $.ui.copy({ text: cmd, surface: press.surface })
                await update($, notice, () =>
                  copied.isCopied ? 'Copied. Paste it in a new terminal tab.' : `Could not copy (${copied.reason}).`,
                )
              }}
            />
            {!picked.isLive && (
              <Button key="restore" label="Restore to this Mac" hotkey="r" onPress={() => restore($, picked)} />
            )}
            {canMove(picked) && (
              <Button
                key="move"
                label={isConfirming ? 'Press again to remove from this Mac' : 'Move to archive'}
                hotkey="m"
                onPress={() => moveToArchive($, picked)}
              />
            )}
            {archiveDir !== '' && picked.isLive && !picked.archiveCurrent && !picked.isRunning && (
              <Button key="archive-now" label="Archive now" hotkey="a" onPress={() => archiveNow($)} />
            )}
            {back}
          </Box>
          {footer}
        </Box>
      )
    }

    const shown = state.sessions.filter(s => matches(s, needle))
    const archivedOnly = state.sessions.filter(s => !s.isLive).length
    const header = state.isLoading
      ? 'Reading sessions…'
      : `${shown.length} of ${state.sessions.length} sessions` +
        (archivedOnly ? ` · ${archivedOnly} archive-only` : '') +
        (archiveDir === '' || state.isArchiveMounted ? '' : ' · archive folder not found')
    const folderWidth = Math.min(32, Math.max(12, Math.floor(width * 0.3)))

    return (
      <Box flexDirection="column">
        {Input && (
          <Input
            key="filter"
            label="Filter: "
            placeholder="words, or :archived :local :running"
            value={needle}
            submitLabel="open first"
            onInput={(value: string) => update($, filter, () => value)}
            onSubmit={() => {
              const first = shown[0]
              if (first) void update($, selected, () => first.id)
            }}
          />
        )}
        <Box flexDirection="row" gap={2}>
          <Text dimColor>{header}</Text>
          <Button key="refresh" plain label="refresh" hotkey="0" onPress={() => refresh($)} />
          <Button key="to-settings" plain label="settings" hotkey="s" onPress={() => go($, 'settings')} />
          <Button key="info" plain label="info" hotkey="i" onPress={() => go($, 'info')} />
        </Box>
        {state.error && <Text color="red">Could not read sessions: {state.error}</Text>}
        {shown.slice(0, MAX_ROWS).map(s => (
          <Button key={s.id} plain onPress={() => update($, selected, () => s.id)}>
            <Text color="green">{s.isRunning ? '●' : ' '}</Text>
            <Text dimColor>{ago(s.mtime).padStart(4)} </Text>
            <Text color={s.isLive ? 'blue' : 'yellow'}>
              {shortFolder(s).slice(0, folderWidth).padEnd(folderWidth)}
            </Text>
            {' '}
            {(s.title ?? oneLine(s.first)).slice(0, Math.max(10, width - folderWidth - 16))}
            <Text dimColor> {s.prompts}</Text>
          </Button>
        ))}
        {shown.length > MAX_ROWS && <Text dimColor>… {shown.length - MAX_ROWS} more, narrow the filter</Text>}
      </Box>
    )
  })
}
