import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const DIR = '/home/t/.claude/cache/waiting'

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

// A filesystem in memory beneath the plugin, holding the shared folder.
function fakeWorld(on: On) {
  const files = new Map<string, string>()
  const notes: string[] = []
  mock.env(on, { HOME: '/home/t' })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('classic.PermissionRequest', async () => ({}))
  on('prompt.submit', async (_$, e) => ({ text: e.text }) as never)
  on('session.id', async () => ({ value: 'me' }))
  on('session.cwd', async () => ({ value: '/work/alpha' }))
  on('fs.write', async (_$, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', async (_$, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error('missing')
    return { value: text }
  })
  on('fs.list', async (_$, e) => ({
    value: [...files.keys()]
      .filter(path => path.startsWith(`${e.path}/`))
      .map(path => ({ name: path.slice(e.path.length + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('ui.notify', async (_$, e) => {
    notes.push(`${e.title}: ${e.text}`)
    return { value: { isSent: true, channel: 'iterm2' } }
  })
  on('process.run', async (_$, e) => {
    files.delete(String(e.argv.at(-1)))
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  return { files, notes }
}

test('shows other sessions that wait, and notifies when this one waits', async ($, on) => {
  const clock = mock.clock(on)
  const { files, notes } = fakeWorld(on)

  await $.session.start({ cwd: '/work/alpha', surface: 'terminal', isInteractive: true })
  expect(JSON.parse(files.get(`${DIR}/me.json`) ?? '{}').state).toBe('idle')

  const now = clock.now()
  files.set(`${DIR}/other.json`, JSON.stringify({
    sessionId: 'other', cwd: '/work/beta/api', state: 'waiting', reason: 'permission for Bash',
    since: now - 3 * 60_000, seen: now,
  }))
  files.set(`${DIR}/gone.json`, JSON.stringify({
    sessionId: 'gone', cwd: '/work/gamma', state: 'waiting', reason: 'has a question',
    since: now - 600_000, seen: now - 600_000,
  }))
  await clock.advance(3_000)

  const band = await $.ui.mount({ plugin: 'waiting', surface: 'terminal', ...BAND })
  expect(await band.find({ text: /1 waiting/ })).toBeDefined()
  expect(await band.find({ text: /beta\/api: permission for Bash \(3m\)/ })).toBeDefined()
  expect(await band.find({ text: /gamma/ })).toBeUndefined()
  await band.unmount()

  await $.classic.PermissionRequest({ tool_name: 'Edit', tool_input: {} })
  expect(JSON.parse(files.get(`${DIR}/me.json`) ?? '{}').reason).toBe('permission for Edit')
  expect(notes).toEqual([])
  await clock.advance(15_000)
  expect(notes).toEqual(['Claude is waiting for you: work/alpha: permission for Edit'])
})

test('a wait answered quickly never notifies', async ($, on) => {
  const clock = mock.clock(on)
  const { notes } = fakeWorld(on)

  await $.session.start({ cwd: '/work/alpha', surface: 'terminal', isInteractive: true })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  await clock.advance(5_000)
  await $.prompt.submit({ text: 'go on' } as never)
  await clock.advance(20_000)
  expect(notes).toEqual([])
})
