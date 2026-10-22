import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const FIXTURE = {
  archiveMounted: true,
  sessions: [
    {
      id: 's-new', project: '-work-alpha', path: '/home/t/.claude/projects/-work-alpha/s-new.jsonl',
      cwd: '/work/alpha', title: 'Alpha pipeline fix', first: 'fix the alpha pipeline', prompts: 12,
      mtime: 1_800_000_000, size: 4096, isLive: true, inArchive: true, archiveCurrent: true, isRunning: false,
    },
    {
      id: 's-old', project: '-work-beta', path: '/arch/-work-beta/s-old.jsonl',
      cwd: "/work/beta's", title: null, first: 'old beta question', prompts: 3,
      mtime: 1_700_000_000, size: 2048, isLive: false, inArchive: true, archiveCurrent: true, isRunning: false,
    },
    {
      id: 's-open', project: '-work-gamma', path: '/home/t/.claude/projects/-work-gamma/s-open.jsonl',
      cwd: '/work/gamma', title: 'Gamma running', first: 'gamma', prompts: 1,
      mtime: 1_790_000_000, size: 1024, isLive: true, inArchive: false, archiveCurrent: false, isRunning: true,
    },
  ],
}

const PANE = {
  component: 'Pane',
  requestId: 'sessions',
  props: {
    title: 'Sessions',
    isFocused: true,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const ok = (stdout: string) => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

// Answers each host script by what it does: the index with FIXTURE, the
// rest with a success line, and records which ran.
function fakeHost(on: On, sessions = FIXTURE) {
  const runs: string[][] = []
  const saved: Record<string, unknown> = {}
  mock.env(on, { HOME: '/home/t' })
  on('process.run', async (_$, e) => {
    const argv = [...e.argv]
    runs.push(argv)
    const script = argv[4] ?? ''
    if (script.includes('os.remove(live_path)')) return ok('{"removed": 1}')
    if (script.includes('copied')) return ok('{"copied": 2, "files": 9}')
    return ok(JSON.stringify(sessions))
  })
  on('config.set', async (_$, e) => {
    saved[e.key] = e.value
    return { value: e.value }
  })

  return { runs, saved }
}

test('lists sessions, filters them and shows the resume command', { options: { archiveDir: '/arch' } }, async ($, on) => {
  const { runs } = fakeHost(on)

  const ui = await $.ui.mount({ plugin: 'sessions', surface: 'terminal', ...PANE })
  await ui.press({ key: 'refresh' })
  expect(runs[0]?.slice(-4)).toEqual([
    '/home/t/.claude/projects',
    '/arch',
    '/home/t/.claude/cache/sessions-mod-index.json',
    '/home/t/.claude/sessions',
  ])
  expect(await ui.find({ text: /3 of 3 sessions · 1 archive-only/ })).toBeDefined()
  // No text field takes the keys until the person asks for one.
  expect(await ui.find({ type: 'Input' })).toBeUndefined()

  await ui.press({ key: 'filter-edit' })
  await ui.input({ key: 'filter', text: 'alpha', kind: 'change' })
  expect(await ui.find({ text: /1 of 3 sessions/ })).toBeDefined()
  await ui.input({ key: 'filter', text: ':archived', kind: 'change' })
  expect(await ui.find({ key: 's-old' })).toBeDefined()
  expect(await ui.find({ key: 's-new' })).toBeUndefined()
  await ui.input({ key: 'filter', text: ':running', kind: 'change' })
  expect(await ui.find({ text: /1 of 3 sessions/ })).toBeDefined()
  expect(await ui.find({ key: 's-open' })).toBeDefined()
  await ui.input({ key: 'filter', text: 'beta' })
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  expect(await ui.find({ key: 'filter-clear' })).toBeDefined()
  await ui.press({ key: 'filter-clear' })
  expect(await ui.find({ text: /3 of 3 sessions/ })).toBeDefined()

  await ui.press({ key: 's-old' })
  expect(await ui.find({ text: "cd '/work/beta'\\''s' && claude -r s-old" })).toBeDefined()
  expect(await ui.find({ key: 'restore' })).toBeDefined()
  expect(await ui.find({ key: 'move' })).toBeUndefined()
  await ui.unmount()
})

test('moving to the archive asks first, then removes the local copy', { options: { archiveDir: '/arch' } }, async ($, on) => {
  const { runs } = fakeHost(on)
  const ui = await $.ui.mount({ plugin: 'sessions', surface: 'terminal', ...PANE })
  await ui.press({ key: 'refresh' })

  await ui.press({ key: 's-new' })
  await ui.press({ key: 'move' })
  expect(await ui.find({ text: /Press m again/ })).toBeDefined()
  expect(runs.some(r => r[4]?.includes('os.remove(live_path)'))).toBe(false)

  await ui.press({ key: 'move' })
  const moved = runs.find(r => r[4]?.includes('os.remove(live_path)'))
  expect(moved?.slice(-3)).toEqual(['/home/t/.claude/projects/-work-alpha/s-new.jsonl', '/arch', '-work-alpha'])
  expect(await ui.find({ text: /Removed from this Mac/ })).toBeDefined()

  // A running session, or one not archived yet, offers no move.
  await ui.press({ key: 'back' })
  await ui.press({ key: 's-open' })
  expect(await ui.find({ key: 'move' })).toBeUndefined()
  await ui.unmount()
})

test('info explains the options; settings save to the mod config', async ($, on) => {
  const { runs, saved } = fakeHost(on)
  const ui = await $.ui.mount({ plugin: 'sessions', surface: 'terminal', ...PANE })

  await ui.press({ key: 'info' })
  expect(await ui.find({ text: /cleanupPeriodDays/ })).toBeDefined()
  expect(await ui.find({ text: /:archived shows archive-only sessions/ })).toBeDefined()

  await ui.press({ key: 'to-settings' })
  expect(await ui.find({ text: /none \(no archive\)/ })).toBeDefined()
  expect(await ui.find({ key: 'archive-now' })).toBeUndefined()
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  await ui.press({ key: 'change-folder' })
  await ui.input({ key: 'archiveDir', text: ' /Volumes/Drive/claude/projects ' })
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  expect(saved['sessions.archiveDir']).toBe('/Volumes/Drive/claude/projects')
  await ui.press({ key: 'toggle-auto' })
  expect(saved['sessions.autoArchive']).toBe(false)
  expect(await ui.find({ text: 'Saved.' })).toBeDefined()
  expect(runs).toEqual([])
  await ui.unmount()
})

test('archive now copies to the archive folder', { options: { archiveDir: '/arch', autoArchive: false } }, async ($, on) => {
  mock.clock(on)
  const { runs } = fakeHost(on)
  const ui = await $.ui.mount({ plugin: 'sessions', surface: 'terminal', ...PANE })

  await ui.press({ key: 'to-settings' })
  expect(await ui.find({ text: /Archive automatically: off/ })).toBeDefined()
  await ui.press({ key: 'archive-now' })
  expect(runs[0]?.slice(-2)).toEqual(['/home/t/.claude/projects', '/arch'])
  expect(await ui.find({ text: /2 files copied/ })).toBeDefined()
  await ui.unmount()
})

test('without an archive folder it lists local sessions only', async ($, on) => {
  const local = { ...FIXTURE, archiveMounted: false, sessions: FIXTURE.sessions.filter(s => s.isLive) }
  const { runs } = fakeHost(on, local)

  const ui = await $.ui.mount({ plugin: 'sessions', surface: 'terminal', ...PANE })
  await ui.press({ key: 'refresh' })
  expect(runs[0]?.at(-3)).toBe('')
  expect(await ui.find({ text: /^2 of 2 sessions$/ })).toBeDefined()
  await ui.press({ key: 's-new' })
  expect(await ui.find({ key: 'move' })).toBeUndefined()
  await ui.unmount()
})

test('an unfocused pane says how to give it the keys', async ($, on) => {
  fakeHost(on)
  const blurred = { ...PANE, props: { ...PANE.props, isFocused: false } }
  const ui = await $.ui.mount({ plugin: 'sessions', surface: 'terminal', ...blurred })
  expect(await ui.find({ text: /ctrl\+x tab/ })).toBeDefined()
  await ui.unmount()
  const focused = await $.ui.mount({ plugin: 'sessions', surface: 'terminal', ...PANE })
  expect(await focused.find({ text: /ctrl\+x tab/ })).toBeUndefined()
  await focused.unmount()
})
