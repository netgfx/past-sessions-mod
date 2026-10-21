// past-sessions: a side pane listing this project's past sessions. Select one
// to read what it was about, then resume it, pin it on top, or archive it.

import { archivedSessions, COLLAPSED_COUNT, isWindowsPath, joinPath, projectDirName, psQuote, queryTerms, sessionIdOf, summarize, visibleSessions } from './lib.js'
import { renderPane } from './view.js'

const PANE = 'past-sessions'
const TITLE = 'Sessions'
// $.fs.read refuses files over 4 MiB; bigger transcripts are read head and tail
const READ_LIMIT = 4 * 1024 * 1024 - 1024
const HEAD_TAIL_LINES = 150
// Bumped when summarize() changes, so cached summaries are read again
const SUMMARY_VERSION = 2
const RESCAN_MS = 60_000

let options = {}
// The folder holding this project's transcripts, once found
let projectDir = null
let currentId = null
// id -> { id, path, mtimeMs, size, summary? }
let sessions = new Map()
let pins = new Set()
let archived = new Set()
// `query` is the search text; `searching` keeps its field up while empty
let ui = { expanded: false, showArchived: false, selected: null, status: '', statusIsError: false, problem: '', query: '', searching: false }
let paneOpen = false
let scanning = false
let pumping = false
// Sessions to read before any other (the one just selected)
let priority = []
let isFullscreen
let wantsAutoOpen = false

export function register(on, opts) {
  options = opts ?? {}

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    projectDir = null
    sessions = new Map()
    priority = []
    try {
      currentId = await $.session.id()
    } catch {
      currentId = null
    }
    paneOpen = (await $.ui.panes()).some((p) => p.id === PANE)
    if (paneOpen) void refresh($)
    wantsAutoOpen = options.auto_open !== false && !paneOpen

    // Picks up sessions that other windows start or keep writing
    $.clock.every(RESCAN_MS, () => {
      if (paneOpen) void refresh($)
    })

    // Register commands last: a name that is taken throws
    try {
      await $.command.register({
        name: 'past-sessions',
        description: 'Toggle the past sessions pane (open | close | refresh | search <text>)',
        argumentHint: '[open|close|refresh|search <text>]',
        immediate: true,
      })
    } catch (err) {
      $.ui.log('past-sessions: could not register /past-sessions: ' + err.message, { to: 'debug' })
    }
    return started
  })

  // /clear, /resume and /branch switch the session: the old one joins the list
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    currentId = e.session_id ?? (await $.session.id().catch(() => currentId))
    ui = { ...ui, selected: null, status: '', statusIsError: false }
    if (paneOpen) void refresh($)
    return next(e)
  })

  on('command.run', { command: 'past-sessions' }, async ($, e) => {
    const raw = String(e.args ?? '').trim()
    const arg = raw.toLowerCase()
    const isUp = (await $.ui.panes()).some((p) => p.id === PANE)
    if (arg === 'search' || arg.startsWith('search ')) {
      const query = raw.slice('search'.length).trim()
      ui = { ...ui, query, searching: true, selected: null }
      if (!isUp) await openPane($, true)
      else $.ui.invalidate('ui.render')
      pump($)
      void $.ui.focus({ requestId: PANE, key: 'search' }).catch(() => {})
      return {}
    }
    if (arg === 'refresh') {
      await refresh($)
      if (!isUp) await openPane($, true)
      return {}
    }
    if (arg === 'close' || (isUp && arg !== 'open')) {
      await $.ui.close({ id: PANE })
      paneOpen = false
      return {}
    }
    await openPane($, true)
    return {}
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) paneOpen = false
    return next(e)
  })

  // Opens the pane unasked only once a drawing says it would dock beside the
  // transcript; above the prompt it would push the conversation up
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface === 'terminal' && e.viewport?.isFullscreen !== undefined) isFullscreen = e.viewport.isFullscreen
    if (wantsAutoOpen && (isFullscreen !== undefined || e.surface === 'desktop')) {
      wantsAutoOpen = false
      if ((isFullscreen || e.surface === 'desktop') && !paneOpen) void openPane($, false)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    paneOpen = true
    const E = $.ui.resolve(e)
    const redraw = () => $.ui.invalidate('ui.render')
    return renderPane(
      E,
      {
        width: (e.props.bodyColumns ?? 48) - 1,
        now: await $.clock.now(),
        sessions: [...sessions.values()],
        pins,
        archived,
        expanded: ui.expanded,
        showArchived: ui.showArchived,
        selected: ui.selected,
        status: ui.status,
        statusIsError: ui.statusIsError,
        problem: ui.problem,
        scanning,
        isFocused: e.props.isFocused === true,
        query: ui.query,
        searching: ui.searching,
      },
      {
        refresh: () => refresh($),
        toggleMore: () => {
          ui = { ...ui, expanded: !ui.expanded }
          if (!ui.expanded) ui.selected = keepSelected(ui.selected)
          redraw()
          pump($)
        },
        toggleArchived: () => {
          ui = { ...ui, showArchived: !ui.showArchived }
          if (!ui.showArchived && archived.has(ui.selected)) ui.selected = null
          redraw()
          pump($)
        },
        select: (id) => {
          ui = { ...ui, selected: ui.selected === id ? null : id, status: '', statusIsError: false }
          if (ui.selected && !sessions.get(id)?.summary) priority = [id, ...priority]
          redraw()
          pump($)
        },
        openSearch: async () => {
          ui = { ...ui, searching: true }
          redraw()
          await $.ui.focus({ requestId: PANE, key: 'search' }).catch(() => {})
        },
        search: (value) => {
          ui = { ...ui, query: value }
          ui.selected = keepSelected(ui.selected)
          redraw()
          pump($)
        },
        // Enter opens the top match, with the focus on its Resume
        submitSearch: async (value) => {
          ui = { ...ui, query: value }
          const top = shownSessions()[0]
          ui.selected = top ? top.id : keepSelected(ui.selected)
          redraw()
          if (top) await $.ui.focus({ requestId: PANE, key: 'resume' }).catch(() => {})
        },
        clearSearch: async () => {
          ui = { ...ui, query: '', searching: false }
          redraw()
          await $.ui.focus({ requestId: PANE, key: 'search-open' }).catch(() => {})
        },
        resume: (id) => resume($, id),
        pin: (id) => togglePin($, id),
        archive: (id) => toggleArchive($, id),
        copy: (id, press) => copyResume($, id, press),
      },
    )
  })
}

async function openPane($, asked) {
  const opened = await $.ui.open({ id: PANE, title: TITLE, ...(asked ? { focus: true } : {}), columns: 50, rows: 18 })
  paneOpen = true
  if (asked && !opened.isPlaced) $.ui.toast('Sessions pane is waiting: ' + (opened.reason ?? 'not placed yet'))
  await refresh($)
}

// Finds the project's transcript folder: ~/.claude/projects/<cwd with every
// non-alphanumeric as '-'>. Paths too long for one folder name are cut and get
// a suffix, so fall back to the folder that starts the same way.
async function locateProject($) {
  const config = await configDir($)
  if (!config) return null
  const projects = joinPath(config, 'projects')
  const places = new Set()
  for (const ask of ['root', 'cwd']) {
    try {
      places.add(ask === 'root' ? await $.session.root() : await $.session.cwd())
    } catch {
      // older builds have no root()
    }
  }
  for (const place of places) {
    const dir = joinPath(projects, projectDirName(place))
    if (await $.fs.exists(dir)) return dir
  }
  let entries = []
  try {
    entries = await $.fs.list(projects)
  } catch {
    return null
  }
  for (const place of places) {
    const stem = projectDirName(place).slice(0, 200).toLowerCase()
    const hit = entries.find((d) => d.kind === 'directory' && d.name.toLowerCase().startsWith(stem))
    if (hit) return joinPath(projects, hit.name)
  }
  return null
}

async function configDir($) {
  const custom = await $.env.get('CLAUDE_CONFIG_DIR')
  if (custom) return custom
  const profile = await $.env.get('USERPROFILE')
  if (profile) return joinPath(profile, '.claude')
  const home = await $.env.get('HOME')
  if (home) return joinPath(home, '.claude')
  return null
}

// Lists the transcripts again, keeping summaries whose file has not changed
async function refresh($) {
  if (scanning) return
  scanning = true
  $.ui.invalidate('ui.render')
  try {
    if (!projectDir) projectDir = await locateProject($)
    if (!projectDir) {
      ui = { ...ui, problem: 'No saved sessions found for this project yet.' }
      return
    }
    ui = { ...ui, problem: '' }
    const entries = await $.fs.list(projectDir)
    const seen = new Map()
    for (const entry of entries) {
      if (entry.kind !== 'file') continue
      const id = sessionIdOf(entry.name)
      if (!id || id === currentId) continue
      const known = sessions.get(id)
      const isSame = known && known.mtimeMs === entry.mtimeMs && known.size === entry.size
      seen.set(
        id,
        isSame ? known : { id, path: joinPath(projectDir, entry.name), mtimeMs: entry.mtimeMs, size: entry.size, summary: null },
      )
    }
    sessions = seen
    await loadMarks($)
    if (ui.selected && !sessions.has(ui.selected)) ui = { ...ui, selected: null }
  } catch (err) {
    ui = { ...ui, problem: 'Could not list sessions: ' + err.message }
  } finally {
    scanning = false
    $.ui.invalidate('ui.render')
  }
  pump($)
}

async function loadMarks($) {
  const keys = await $.store.keys()
  pins = new Set(keys.filter((k) => k.startsWith('pin:')).map((k) => k.slice(4)))
  archived = new Set(keys.filter((k) => k.startsWith('archive:')).map((k) => k.slice(8)))
}

// The rows the list draws now, top to bottom
function shownSessions() {
  const all = [...sessions.values()]
  const list = visibleSessions(all, { pins, archived, expanded: ui.expanded, query: ui.query })
  const isSearch = queryTerms(ui.query).length > 0
  return [...list.pinned, ...list.others, ...(isSearch || ui.showArchived ? archivedSessions(all, archived, ui.query) : [])]
}

// A selection the list no longer shows is dropped
function keepSelected(id) {
  if (!id) return null
  return shownSessions().some((s) => s.id === id) ? id : null
}

// The next transcript to read: the selected one, then pinned ones, then the
// newest. Collapsed, reading stops once the top five have something to show.
function nextToRead() {
  for (const id of priority) {
    const s = sessions.get(id)
    if (s && !s.summary) return s
  }
  priority = []
  const all = [...sessions.values()]
  const order = [...all].sort((a, b) => (pins.has(b.id) ? 1 : 0) - (pins.has(a.id) ? 1 : 0) || b.mtimeMs - a.mtimeMs)
  // A search needs every transcript, archived ones too
  if (queryTerms(ui.query).length) return order.find((s) => !s.summary) ?? null
  let shown = 0
  for (const s of order) {
    const isPinned = pins.has(s.id)
    const isArchived = archived.has(s.id)
    if (isArchived && !ui.showArchived) continue
    if (!isPinned && !isArchived && !ui.expanded && shown >= COLLAPSED_COUNT) continue
    if (!s.summary) return s
    if (!isPinned && !isArchived && !s.summary.isEmpty) shown += 1
  }
  return null
}

// Reads one transcript per clock tick, so no single hook runs long
function pump($) {
  if (pumping) return
  pumping = true
  $.clock.after(0, async () => {
    let more = false
    try {
      const s = nextToRead()
      if (s) {
        s.summary = await summaryOf($, s)
        more = true
        $.ui.invalidate('ui.render')
      }
    } finally {
      pumping = false
    }
    if (more) pump($)
  })
}

async function summaryOf($, s) {
  const key = 'summary:' + s.id
  const cached = await $.store.get(key)
  if (cached && cached.v === SUMMARY_VERSION && cached.mtimeMs === s.mtimeMs && cached.size === s.size) return cached
  let text = null
  let isPartial = false
  try {
    if (s.size <= READ_LIMIT) text = await $.fs.read(s.path)
    else {
      text = await readHeadTail($, s.path)
      isPartial = true
    }
  } catch (err) {
    $.ui.log('past-sessions: could not read ' + s.path + ': ' + err.message, { to: 'debug' })
  }
  if (text === null) {
    return { v: SUMMARY_VERSION, mtimeMs: s.mtimeMs, size: s.size, title: '(could not read)', firstPrompt: '', lastPrompt: '', prompts: 0, startedAt: 0, isEmpty: false, isPartial }
  }
  const sum = summarize(text)
  const out = {
    v: SUMMARY_VERSION,
    mtimeMs: s.mtimeMs,
    size: s.size,
    title: sum.title,
    firstPrompt: sum.firstPrompt,
    lastPrompt: sum.lastPrompt,
    prompts: sum.prompts,
    startedAt: sum.startedAt,
    branch: sum.branch,
    isEmpty: sum.substantive === 0,
    isPartial,
  }
  try {
    await $.store.set(key, out)
  } catch {
    // store full: the summary is still kept for this session
  }
  return out
}

// The first and last lines of a transcript too big for $.fs.read
async function readHeadTail($, path) {
  const argv = isWindowsPath(path)
    ? [
        'powershell',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '[Console]::OutputEncoding=[Text.Encoding]::UTF8; $p=' +
          psQuote(path) +
          '; Get-Content -LiteralPath $p -TotalCount ' +
          HEAD_TAIL_LINES +
          ' -Encoding UTF8; Get-Content -LiteralPath $p -Tail ' +
          HEAD_TAIL_LINES +
          ' -Encoding UTF8',
      ]
    : ['/bin/sh', '-c', 'head -n ' + HEAD_TAIL_LINES + ' "$1"; tail -n ' + HEAD_TAIL_LINES + ' "$1"', 'sh', path]
  try {
    const r = await $.process.run(argv, { timeoutMs: 30_000 })
    return r.exitCode === 0 ? r.stdout : null
  } catch (err) {
    $.ui.log('past-sessions: head/tail read failed: ' + err.message, { to: 'debug' })
    return null
  }
}

async function togglePin($, id) {
  const key = 'pin:' + id
  if (pins.has(id)) {
    pins.delete(id)
    await $.store.delete(key)
  } else {
    pins.add(id)
    await $.store.set(key, true)
  }
  $.ui.invalidate('ui.render')
  pump($)
}

async function toggleArchive($, id) {
  const key = 'archive:' + id
  if (archived.has(id)) {
    archived.delete(id)
    await $.store.delete(key)
  } else {
    archived.add(id)
    ui = { ...ui, selected: ui.showArchived ? ui.selected : null }
    await $.store.set(key, true)
    if (pins.has(id)) {
      pins.delete(id)
      await $.store.delete('pin:' + id)
    }
  }
  $.ui.invalidate('ui.render')
  pump($)
}

// Runs /resume <id>, as typing it would; where that is refused, copies the
// command that resumes it from a terminal
async function resume($, id) {
  ui = { ...ui, status: 'Resuming…', statusIsError: false }
  $.ui.invalidate('ui.render')
  try {
    await $.command.run({ command: 'resume', args: id })
    ui = { ...ui, status: '', statusIsError: false }
  } catch (err) {
    let copied = false
    try {
      await $.ui.copy({ text: 'claude --resume ' + id })
      copied = true
    } catch {
      // no clipboard here
    }
    ui = {
      ...ui,
      statusIsError: true,
      status: 'Could not resume here (' + err.message + '). ' + (copied ? 'Copied ' : 'Run ') + 'claude --resume ' + id,
    }
  }
  $.ui.invalidate('ui.render')
}

async function copyResume($, id, press) {
  const text = 'claude --resume ' + id
  try {
    await $.ui.copy({ text, ...(press?.surface ? { surface: press.surface } : {}) })
    $.ui.toast('Copied: ' + text)
  } catch (err) {
    $.ui.toast('Could not copy: ' + err.message)
  }
}
