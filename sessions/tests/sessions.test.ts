import { expect, mock, test } from 'claude-code/testing'

const FIXTURE = {
  archiveMounted: true,
  sessions: [
    {
      id: 's-new', project: '-work-alpha', path: '/home/t/.claude/projects/-work-alpha/s-new.jsonl',
      cwd: '/work/alpha', title: 'Alpha pipeline fix', first: 'fix the alpha pipeline', prompts: 12,
      mtime: 1_800_000_000, size: 4096, isLive: true, inArchive: true,
    },
    {
      id: 's-old', project: '-work-beta', path: '/arch/-work-beta/s-old.jsonl',
      cwd: "/work/beta's", title: null, first: 'old beta question', prompts: 3,
      mtime: 1_700_000_000, size: 2048, isLive: false, inArchive: true,
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

test('lists sessions, filters them and shows the resume command', { options: { archiveDir: '/arch' } }, async ($, on) => {
  mock.env(on, { HOME: '/home/t' })
  const runs: string[][] = []
  on('process.run', async (_$, e) => {
    runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: JSON.stringify(FIXTURE), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  const ui = await $.ui.mount({ plugin: 'sessions', surface: 'terminal', ...PANE })
  await ui.press({ key: 'refresh' })
  expect(runs[0]?.slice(-3)).toEqual([
    '/home/t/.claude/projects',
    '/arch',
    '/home/t/.claude/cache/sessions-mod-index.json',
  ])
  expect(await ui.find({ text: /2 of 2 sessions · 1 archive-only/ })).toBeDefined()

  await ui.input({ key: 'filter', text: 'alpha', kind: 'change' })
  expect(await ui.find({ text: /1 of 2 sessions/ })).toBeDefined()
  await ui.input({ key: 'filter', text: '', kind: 'change' })

  await ui.press({ key: 's-old' })
  expect(await ui.find({ text: "cd '/work/beta'\\''s' && claude -r s-old" })).toBeDefined()
  expect(await ui.find({ key: 'restore' })).toBeDefined()

  await ui.press({ key: 'back' })
  await ui.press({ key: 's-new' })
  expect(await ui.find({ key: 'restore' })).toBeUndefined()
  await ui.unmount()
})

test('without an archive folder it lists live sessions only', async ($, on) => {
  mock.env(on, { HOME: '/home/t' })
  const runs: string[][] = []
  on('process.run', async (_$, e) => {
    runs.push([...e.argv])
    const live = { ...FIXTURE, archiveMounted: false, sessions: FIXTURE.sessions.filter(s => s.isLive) }
    return { value: { exitCode: 0, stdout: JSON.stringify(live), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  const ui = await $.ui.mount({ plugin: 'sessions', surface: 'terminal', ...PANE })
  await ui.press({ key: 'refresh' })
  expect(runs[0]?.at(-2)).toBe('')
  expect(await ui.find({ text: /^1 of 1 sessions$/ })).toBeDefined()
  await ui.unmount()
})
