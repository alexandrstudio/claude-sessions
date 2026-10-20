import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Beacon, SessionState, Waiter } from '../types'

const others = atom({ plugin: 'waiting', key: 'others' } as const, [] as Waiter[])

const HEARTBEAT_MS = 10_000
const POLL_MS = 3_000
// A beacon not rewritten for this long belongs to a session that is gone.
const STALE_MS = 35_000
// Beacons this old are deleted rather than skipped.
const PRUNE_MS = 24 * 60 * 60 * 1000
// Waits answered within this time never notify.
const NOTIFY_AFTER_MS = 15_000

const folderOf = (cwd: string) => cwd.split('/').filter(Boolean).slice(-2).join('/') || cwd

// One session per module instance: these are this session's own beacon and
// settings, set again on every (re)load by `register` and `session.start`.
let shouldNotify = true
let showYourTurn = false
let dir = ''
let me: Beacon | undefined
let notifyTimer: Timer | undefined

async function write($: EngineInterface) {
  if (!me || !dir) return
  me = { ...me, seen: await $.clock.now() }
  await $.fs.write(`${dir}/${me.sessionId}.json`, JSON.stringify(me))
}

async function setState($: EngineInterface, state: SessionState, reason: string) {
  if (!me) return
  if (me.state === state && me.reason === reason) return
  me = { ...me, state, reason, since: await $.clock.now() }
  await write($)

  notifyTimer?.cancel()
  notifyTimer = undefined
  if (state === 'waiting' && shouldNotify) {
    const waitedFor = me.since
    notifyTimer = $.clock.after(NOTIFY_AFTER_MS, () => {
      if (me?.state !== 'waiting' || me.since !== waitedFor) return
      void $.ui.notify(`${folderOf(me.cwd)}: ${me.reason}`, { title: 'Claude is waiting for you' })
    })
  }
}

async function poll($: EngineInterface) {
  if (!dir) return
  const now = await $.clock.now()
  let entries: Awaited<ReturnType<EngineInterface['fs']['list']>> = []
  try {
    entries = await $.fs.list(dir)
  } catch {
    return
  }
  const found: Waiter[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    if (me && entry.name === `${me.sessionId}.json`) continue
    const path = `${dir}/${entry.name}`
    let beacon: Beacon
    try {
      beacon = JSON.parse(String(await $.fs.read(path))) as Beacon
    } catch {
      continue
    }
    if (now - beacon.seen > PRUNE_MS || beacon.state === 'closed') {
      void $.process.run(['rm', '-f', path]).catch(() => undefined)
      continue
    }
    if (now - beacon.seen > STALE_MS) continue
    const isWaiting = beacon.state === 'waiting' || (showYourTurn && beacon.state === 'idle' && beacon.reason !== '')
    if (!isWaiting) continue
    found.push({
      sessionId: beacon.sessionId,
      folder: folderOf(beacon.cwd),
      reason: beacon.reason,
      minutes: Math.floor((now - beacon.since) / 60_000),
    })
  }
  found.sort((a, b) => b.minutes - a.minutes || a.folder.localeCompare(b.folder))
  // Rewriting an equal list would redraw the band every poll for nothing.
  const before = await read($, others)
  if (JSON.stringify(before) !== JSON.stringify(found)) await update($, others, () => found)
}

export const register: Register = (on, options) => {
  shouldNotify = options.notify !== false
  showYourTurn = options.showYourTurn === true

  on('session.start', async ($, e, next) => {
    const home = (await $.env.get('HOME')) ?? ''
    dir = `${home}/.claude/cache/waiting`
    const now = await $.clock.now()
    me = { sessionId: await $.session.id(), cwd: await $.session.cwd(), state: 'idle', reason: '', since: now, seen: now }
    await write($)
    $.clock.every(HEARTBEAT_MS, () => void write($))
    $.clock.every(POLL_MS, () => void poll($))
    void poll($)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await setState($, 'closed', '')

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await setState($, 'working', '')

    return next(e)
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    await setState($, 'waiting', `permission for ${e.tool_name}`)

    return next(e)
  })

  on('classic.Notification', async ($, e, next) => {
    if (/permission/.test(e.notification_type) && me?.state !== 'waiting') {
      await setState($, 'waiting', 'needs your permission')
    } else if (/elicitation/.test(e.notification_type)) {
      await setState($, 'waiting', 'has a question')
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'AskUserQuestion') await setState($, 'waiting', 'has a question')
    const result = await next(e)
    // The call is through, so whatever it waited on (a question, a
    // permission) has been answered.
    if (me?.state === 'waiting') await setState($, 'working', '')

    return result
  })

  on('turn.complete', async ($, e, next) => {
    await setState($, 'idle', 'finished, your turn')

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, others)
    if (list.length === 0 || e.props.hasSurvey) return next(e)

    const { Text } = $.ui.resolve(e)
    const parts = list.map(w => `${w.folder}: ${w.reason}${w.minutes > 0 ? ` (${w.minutes}m)` : ''}`)

    return (
      <Text wrap="truncate">
        <Text color="yellow">⏳ {list.length} waiting</Text>
        <Text dimColor> · </Text>
        {parts.join(' · ')}
      </Text>
    )
  })
}
