import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { IndexState, SessionRow } from '../types'
import { INDEXER } from './indexer'

const PANE = 'sessions'
// The archive folder comes from the mod's `archiveDir` setting; empty means
// there is no archive and only ~/.claude/projects is listed.
let archiveDir = ''
// Past this many rows the list is cut; the filter narrows it down instead.
const MAX_ROWS = 200

const index = atom({ plugin: 'sessions', key: 'index' } as const, {
  sessions: [],
  isLoading: false,
  isArchiveMounted: false,
} as IndexState)
const filter = atom({ plugin: 'sessions', key: 'filter' } as const, '')
const selected = atom({ plugin: 'sessions', key: 'selected' } as const, null as string | null)
const notice = atom({ plugin: 'sessions', key: 'notice' } as const, '')

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

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

const matches = (s: SessionRow, needle: string) => {
  if (!needle) return true
  const hay = `${s.title ?? ''} ${s.first} ${s.cwd ?? ''} ${s.project} ${s.id}`.toLowerCase()
  return needle
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every(word => hay.includes(word))
}

async function refresh($: EngineInterface) {
  await update($, index, old => ({ ...old, isLoading: true, error: undefined }))
  const home = (await $.env.get('HOME')) ?? ''
  try {
    const ran = await $.process.run(
      [
        '/usr/bin/env',
        'python3',
        '-I',
        '-c',
        INDEXER,
        `${home}/.claude/projects`,
        archiveDir,
        `${home}/.claude/cache/sessions-mod-index.json`,
      ],
      { timeoutMs: 120_000 },
    )
    if (ran.exitCode !== 0) throw new Error(ran.stderr.trim().split('\n').pop() || `exit ${ran.exitCode}`)
    const parsed = JSON.parse(ran.stdout) as { sessions: SessionRow[]; archiveMounted: boolean }
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

// Copies an archived transcript (and its subagent folder, when there is one)
// back where `claude -r` looks for it.
const RESTORE = String.raw`
import os, shutil, sys
src, dest_dir = sys.argv[1], sys.argv[2]
os.makedirs(dest_dir, exist_ok=True)
dest = os.path.join(dest_dir, os.path.basename(src))
if os.path.exists(dest):
    sys.exit('already restored')
shutil.copy2(src, dest)
side = src[:-6]
if os.path.isdir(side):
    shutil.copytree(side, os.path.join(dest_dir, os.path.basename(side)), dirs_exist_ok=True)
`

async function restore($: EngineInterface, s: SessionRow) {
  const home = (await $.env.get('HOME')) ?? ''
  const ran = await $.process.run([
    '/usr/bin/env',
    'python3',
    '-I',
    '-c',
    RESTORE,
    s.path,
    `${home}/.claude/projects/${s.project}`,
  ])
  if (ran.exitCode !== 0) {
    await update($, notice, () => `Restore failed: ${ran.stderr.trim().split('\n').pop()}`)
    return
  }
  await update($, notice, () => 'Restored. The resume command works again.')
  await refresh($)
}

const openPane = ($: EngineInterface) =>
  $.ui.open({ id: PANE, title: 'Sessions', focus: true, closeOnEscape: true })

export const register: Register = (on, options) => {
  archiveDir = typeof options.archiveDir === 'string' ? options.archiveDir.trim() : ''

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sessions',
      description: 'Browse all sessions across projects and the archive',
    })

    return next(e)
  })

  on('command.run', { command: 'sessions' }, async $ => {
    await update($, selected, () => null)
    await update($, notice, () => '')
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
    const width = Math.max(30, e.props.bodyColumns)

    const picked = pickedId ? state.sessions.find(s => s.id === pickedId) : undefined
    if (picked) {
      const cmd = resumeCommand(picked)
      const where = picked.isLive
        ? picked.inArchive
          ? 'live and archived'
          : 'live only (not archived yet)'
        : 'archive only'

      return (
        <Box flexDirection="column">
          <Text bold wrap="truncate">{picked.title ?? oneLine(picked.first)}</Text>
          <Text dimColor>
            {day(picked.mtime)} · {picked.prompts} prompts · {Math.round(picked.size / 1024)} KB · {where}
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
              <Button key="restore" label="Restore from archive" hotkey="r" onPress={() => restore($, picked)} />
            )}
            <Button
              key="back"
              label="Back"
              hotkey="b"
              onPress={async () => {
                await update($, selected, () => null)
                await update($, notice, () => '')
              }}
            />
          </Box>
          {message !== '' && <Text color="green">{message}</Text>}
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
          placeholder="words in title, prompt or folder"
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
        </Box>
        {state.error && <Text color="red">Could not read sessions: {state.error}</Text>}
        {shown.slice(0, MAX_ROWS).map(s => (
          <Button key={s.id} plain onPress={() => update($, selected, () => s.id)}>
            <Text dimColor>{ago(s.mtime).padStart(4)} </Text>
            <Text color={s.isLive ? 'blue' : 'yellow'}>
              {shortFolder(s).slice(0, folderWidth).padEnd(folderWidth)}
            </Text>
            {' '}
            {(s.title ?? oneLine(s.first)).slice(0, Math.max(10, width - folderWidth - 14))}
            <Text dimColor> {s.prompts}</Text>
          </Button>
        ))}
        {shown.length > MAX_ROWS && <Text dimColor>… {shown.length - MAX_ROWS} more, narrow the filter</Text>}
      </Box>
    )
  })
}
