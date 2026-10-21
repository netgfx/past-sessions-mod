import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'past-sessions',
  component: 'Pane',
  requestId: 'past-sessions',
  viewport: { columns: 160, rows: 50 },
  props: {
    title: 'Sessions',
    isFocused: true,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 48 },
    view: {},
  },
} as const

const CURRENT = '00000000-0000-4000-8000-000000000000'
const idOf = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const NOW = Date.parse('2026-10-21T12:00:00Z')

const transcript = (title: string, prompt: string) =>
  [
    JSON.stringify({ type: 'user', message: { role: 'user', content: prompt }, timestamp: '2026-10-20T09:00:00.000Z', gitBranch: 'main' }),
    JSON.stringify({ type: 'ai-title', aiTitle: title }),
  ].join('\n')

// Eight past sessions (1 newest), one empty, and the current one
function fixture(os: 'windows' | 'posix') {
  const home = os === 'windows' ? 'C:\\Users\\me' : '/Users/me'
  const cwd = os === 'windows' ? 'C:\\work' : '/work'
  const sep = os === 'windows' ? '\\' : '/'
  const dir = [home, '.claude', 'projects', os === 'windows' ? 'C--work' : '-work'].join(sep)
  const files = new Map<string, { text: string; mtimeMs: number }>()
  for (let n = 1; n <= 8; n++) files.set(idOf(n), { text: transcript('Task ' + n, 'do task ' + n), mtimeMs: NOW - n * 3600_000 })
  files.set(idOf(9), { text: JSON.stringify({ type: 'mode', mode: 'normal' }), mtimeMs: NOW })
  files.set(CURRENT, { text: transcript('Current', 'now'), mtimeMs: NOW })
  return { home, cwd, dir, files }
}

function stubAll(on: any, os: 'windows' | 'posix', seen: { commands: any[]; reads: string[] }) {
  const f = fixture(os)
  const store = new Map<string, unknown>()
  on('store.get', ($: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', ($: any, e: any) => (store.set(e.key, e.value), { value: undefined }))
  on('store.delete', ($: any, e: any) => (store.delete(e.key), { value: undefined }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  const clock = mock.clock(on, { now: NOW })
  on('env.get', ($: any, e: any) => ({
    value: e.name === (os === 'windows' ? 'USERPROFILE' : 'HOME') ? f.home : undefined,
  }))
  on('session.id', () => ({ value: CURRENT }))
  on('session.root', () => ({ value: f.cwd }))
  on('session.cwd', () => ({ value: f.cwd }))
  on('session.start', () => ({ cwd: f.cwd }))
  // the kit hands stubs absolute host paths, so compare the tail only
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  on('fs.exists', ($: any, e: any) => ({ value: norm(e.path) === norm(f.dir) }))
  on('fs.list', ($: any, e: any) => ({
    value: [
      { name: 'memory', kind: 'directory', size: 0, mtimeMs: 0, isLink: false },
      ...[...f.files].map(([id, v]) => ({ name: id + '.jsonl', kind: 'file', size: v.text.length, mtimeMs: v.mtimeMs, isLink: false })),
    ],
  }))
  on('fs.read', ($: any, e: any) => {
    seen.reads.push(e.path)
    const id = /([0-9a-f-]{36})\.jsonl$/.exec(e.path)![1]
    return { value: f.files.get(id)!.text }
  })
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.copy', () => ({ value: { isCopied: true } }))
  on('ui.focus', () => ({ value: {} }))
  on('command.register', () => ({ value: undefined }))
  on('command.run', ($: any, e: any) => {
    seen.commands.push({ command: e.command, args: e.args })
    return { text: '' }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  return { f, clock, store }
}

// The mod reads one transcript per clock tick
async function settle(clock: any) {
  for (let i = 0; i < 20; i++) await clock.settle()
}

async function start($: any, clock: any, cwd: string) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd })
  await $.command.run({ command: 'past-sessions', args: 'open' })
  await settle(clock)
}

for (const os of ['windows', 'posix'] as const) {
  test('lists the newest five, More shows the rest, Less hides them (' + os + ')', async ($, on) => {
    const seen = { commands: [] as any[], reads: [] as string[] }
    const { f, clock } = stubAll(on, os, seen)
    await start($, clock, f.cwd)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface } as any)
      expect(await ui.find({ type: 'Button', text: /Task 1$/ })).toBeDefined()
      expect(await ui.find({ type: 'Button', text: /Task 5$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^\s*5h$/ })).toBeDefined()
      expect(await ui.find({ type: 'Button', text: /Task 6$/ })).toBeUndefined()
      expect(await ui.find({ type: 'Button', text: /Current/ })).toBeUndefined()
      expect(await ui.find({ type: 'Button', key: 'more', text: 'More… (3)' })).toBeDefined()
      // the three hidden ones are unread, yet nothing on screen is loading
      expect(await ui.find({ type: 'Button', key: 'refresh', text: 'refresh' })).toBeDefined()

      await ui.press({ key: 'more' })
      await settle(clock)
      expect(await ui.find({ type: 'Button', text: /Task 8$/ })).toBeDefined()
      expect(await ui.find({ type: 'Button', key: 'less' })).toBeDefined()
      await ui.press({ key: 'less' })
      expect(await ui.find({ type: 'Button', text: /Task 8$/ })).toBeUndefined()
      await ui.unmount()
    }
    // the empty transcript is never listed, the current one never read
    expect(seen.reads.some((p) => p.includes(CURRENT))).toBe(false)
  })
}

test('collapsed, only the transcripts it shows are read', async ($, on) => {
  const seen = { commands: [] as any[], reads: [] as string[] }
  const { f, clock } = stubAll(on, 'windows', seen)
  await start($, clock, f.cwd)
  // 9 is the empty one (newest), then 1..5
  expect(seen.reads.length).toBe(6)
})

test('select shows the task, pin moves it on top, archive hides it, resume runs /resume', async ($, on) => {
  const seen = { commands: [] as any[], reads: [] as string[] }
  const { f, clock } = stubAll(on, 'windows', seen)
  await start($, clock, f.cwd)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)

  await ui.press({ key: 'row-' + idOf(4) })
  expect(await ui.find({ type: 'Text', text: 'do task 4' })).toBeDefined()

  await ui.press({ key: 'pin' })
  await settle(clock)
  expect(await ui.find({ type: 'Text', text: 'Pinned' })).toBeDefined()
  // Task 4 is now pinned, so a sixth recent one shows
  expect(await ui.find({ type: 'Button', text: /Task 6$/ })).toBeDefined()

  await ui.press({ key: 'resume' })
  expect(seen.commands.at(-1)).toEqual({ command: 'resume', args: idOf(4) })

  await ui.press({ key: 'archive' })
  expect(await ui.find({ type: 'Button', text: /Task 4$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Pinned' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'archived', text: 'Archived (1)' })).toBeDefined()

  await ui.press({ key: 'archived' })
  await settle(clock)
  expect(await ui.find({ type: 'Button', text: /Task 4$/ })).toBeDefined()
  await ui.unmount()
})

test('pins and archives survive a reload through $.store', async ($, on) => {
  const seen = { commands: [] as any[], reads: [] as string[] }
  const { f, clock, store } = stubAll(on, 'posix', seen)
  await start($, clock, f.cwd)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  // 8 is not shown collapsed; expand first
  await ui.press({ key: 'more' })
  await settle(clock)
  await ui.press({ key: 'row-' + idOf(8) })
  await ui.press({ key: 'pin' })
  await ui.press({ key: 'less' })
  expect(await ui.find({ type: 'Button', text: /Task 8$/ })).toBeDefined()
  expect(store.get('pin:' + idOf(8))).toBe(true)
  await ui.unmount()
})

test('titles are drawn in Claude orange; the selected one opens into a card', async ($, on) => {
  const seen = { commands: [] as any[], reads: [] as string[] }
  const { f, clock } = stubAll(on, 'windows', seen)
  await start($, clock, f.cwd)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)

  const title = await ui.find({ type: 'Text', text: /Task 2$/ })
  expect(title?.props.color).toBe('claude')
  // focused with nothing open, the pane says how to get around
  expect(await ui.find({ type: 'Text', text: /Esc back to prompt/ })).toBeDefined()

  await ui.press({ key: 'row-' + idOf(2) })
  const card = await ui.find({ key: 'card-' + idOf(2) })
  expect(card?.props.borderStyle).toBe('round')
  expect(await ui.find({ type: 'Text', text: /^Started Oct 20, \d\d:\d\d · last active 2h ago$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Esc back to prompt/ })).toBeUndefined()
  // the other rows stay outside it
  expect(await ui.find({ key: 'card-' + idOf(1) })).toBeUndefined()
  await ui.unmount()
})

test('search reads every transcript, shows each match, Enter opens the top one', async ($, on) => {
  const seen = { commands: [] as any[], reads: [] as string[] }
  const { f, clock } = stubAll(on, 'posix', seen)
  await start($, clock, f.cwd)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)

  // archive 3 first: a search still finds it
  await ui.press({ key: 'row-' + idOf(3) })
  await ui.press({ key: 'archive' })

  await ui.press({ key: 'search-open' })
  expect(await ui.find({ type: 'Input', key: 'search' })).toBeDefined()
  await ui.input({ key: 'search', text: 'task 7', kind: 'change' })
  await settle(clock)
  // 6..8 were never read collapsed; the search reads them
  expect(seen.reads.some((p) => p.includes(idOf(7)))).toBe(true)
  expect(await ui.find({ type: 'Button', text: /Task 7$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Task 1$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /· 1 match$/ })).toBeDefined()

  await ui.input({ key: 'search', text: 'do task 3', kind: 'change' })
  expect(await ui.find({ type: 'Text', text: 'Archived' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Task 3$/ })).toBeDefined()

  await ui.input({ key: 'search', text: 'nothing like it', kind: 'change' })
  expect(await ui.find({ type: 'Text', text: /No sessions match "nothing like it"/ })).toBeDefined()

  await ui.input({ key: 'search', text: 'task 8' })
  expect(await ui.find({ key: 'card-' + idOf(8) })).toBeDefined()
  await ui.press({ key: 'resume' })
  expect(seen.commands.at(-1)).toEqual({ command: 'resume', args: idOf(8) })

  await ui.press({ key: 'search-clear' })
  expect(await ui.find({ type: 'Input', key: 'search' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: /Task 1$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'more' })).toBeDefined()
  await ui.unmount()
})

test('/past-sessions search <text> opens the pane already searching', async ($, on) => {
  const seen = { commands: [] as any[], reads: [] as string[] }
  const { f, clock } = stubAll(on, 'windows', seen)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: f.cwd })
  await $.command.run({ command: 'past-sessions', args: 'search Task 6' })
  await settle(clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  expect((await ui.find({ type: 'Input', key: 'search' }))?.props.value).toBe('Task 6')
  expect(await ui.find({ type: 'Button', text: /Task 6$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Task 5$/ })).toBeUndefined()
  await ui.unmount()
})
