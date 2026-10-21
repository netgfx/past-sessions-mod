// past-sessions: pure helpers (no $), unit-tested in tests/lib.test.ts

// How many unpinned sessions the collapsed list shows
export const COLLAPSED_COUNT = 5
// How much of a prompt a summary keeps
const PROMPT_CHARS = 600

const SESSION_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i

// The session id of a transcript file name, or null for anything else
export function sessionIdOf(name) {
  return SESSION_FILE.test(name) ? name.slice(0, -'.jsonl'.length) : null
}

// Claude Code's folder name for a project: every character but a letter or
// digit becomes '-' (D:\a\b -> D--a-b, /Users/me/x -> -Users-me-x)
export function projectDirName(cwd) {
  return String(cwd).replace(/[^A-Za-z0-9]/g, '-')
}

export function isWindowsPath(p) {
  return /^[A-Za-z]:[\\/]/.test(p) || String(p).startsWith('\\\\')
}

// Joins with the separator the base already uses
export function joinPath(base, ...parts) {
  const sep = isWindowsPath(base) || (base.includes('\\') && !base.includes('/')) ? '\\' : '/'
  return [base.replace(/[\\/]+$/, ''), ...parts].join(sep)
}

function clip(text, n) {
  const t = String(text ?? '')
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

// The person's own words in a user row, or null for tool results, meta rows,
// command output and other rows the engine writes as user messages
export function promptOf(row) {
  if (!row || row.type !== 'user' || row.isMeta || row.isSidechain) return null
  if (row.toolUseResult !== undefined) return null
  const content = row.message?.content
  let text = ''
  if (typeof content === 'string') text = content
  else if (Array.isArray(content)) {
    if (content.some((b) => b?.type === 'tool_result')) return null
    text = content
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
  }
  text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
  if (!text) return null
  const command = /<command-name>([^<]*)<\/command-name>/.exec(text)
  if (command) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim()
    const name = command[1].trim()
    return name.startsWith('/') ? name + (args ? ' ' + args : '') : '/' + name + (args ? ' ' + args : '')
  }
  if (/^<(local-command|bash-|task-notification|user-prompt-submit-hook|command-message)/.test(text)) return null
  if (/^Caveat: The messages below/.test(text)) return null
  return text
}

// Reads a transcript (JSONL text, possibly only its head and tail) into what
// the pane shows. `prompts` is a lower bound when the text was cut.
export function summarize(text) {
  const out = {
    title: '',
    aiTitle: '',
    customTitle: '',
    firstPrompt: '',
    lastPrompt: '',
    prompts: 0,
    // prompts beyond a bare command such as /clear or /reload-plugins
    substantive: 0,
    startedAt: 0,
    endedAt: 0,
    branch: '',
    cwd: '',
  }
  let summary = ''
  for (const line of String(text).replace(/\r\n/g, '\n').split('\n')) {
    if (!line || line[0] !== '{') continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue // a cut line at a head/tail seam, or one still being written
    }
    switch (row.type) {
      case 'ai-title':
        if (row.aiTitle) out.aiTitle = String(row.aiTitle)
        continue
      case 'custom-title':
        if (row.customTitle) out.customTitle = String(row.customTitle)
        continue
      case 'summary':
        if (row.summary) summary = String(row.summary)
        continue
      case 'last-prompt':
        if (row.lastPrompt) out.lastPrompt = clip(row.lastPrompt, PROMPT_CHARS)
        continue
    }
    const at = Date.parse(row.timestamp ?? '')
    if (Number.isFinite(at)) {
      if (!out.startedAt || at < out.startedAt) out.startedAt = at
      if (at > out.endedAt) out.endedAt = at
    }
    if (row.gitBranch) out.branch = String(row.gitBranch)
    if (!out.cwd && row.cwd) out.cwd = String(row.cwd)
    const prompt = promptOf(row)
    if (prompt === null) continue
    out.prompts += 1
    if (!/^\/[\w:.-]+$/.test(prompt)) out.substantive += 1
    if (!out.firstPrompt) out.firstPrompt = clip(prompt, PROMPT_CHARS)
    out.lastPrompt = clip(prompt, PROMPT_CHARS)
  }
  out.title = out.customTitle || out.aiTitle || summary || firstLine(out.firstPrompt)
  return out
}

export function firstLine(text, n = 120) {
  return clip(String(text ?? '').trim().split('\n')[0].trim(), n)
}

// Pinned first, then newest first; among the pinned newest first too
export function orderSessions(sessions, pins) {
  return [...sessions].sort((a, b) => {
    const pa = pins.has(a.id) ? 1 : 0
    const pb = pins.has(b.id) ? 1 : 0
    if (pa !== pb) return pb - pa
    return b.mtimeMs - a.mtimeMs || (a.id < b.id ? -1 : 1)
  })
}

// The words of a search, lower case; empty when there is none
export function queryTerms(query) {
  return String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
}

// Whether a read session holds every term somewhere in its title, prompts or
// branch, or as the start of its id. An unread one matches nothing yet.
export function matchesQuery(s, terms) {
  if (!terms.length) return true
  const sum = s.summary
  if (!sum) return false
  const hay = [sum.title, sum.firstPrompt, sum.lastPrompt, sum.branch].join(' ').toLowerCase()
  return terms.every((t) => hay.includes(t) || s.id.toLowerCase().startsWith(t))
}

// What the list draws: archived and empty sessions left out, then, collapsed,
// every pinned one plus the newest `count` others. `hidden` is how many More
// would add. A search shows every match, never collapsed.
export function visibleSessions(sessions, { pins, archived, expanded, count = COLLAPSED_COUNT, query = '' }) {
  const terms = queryTerms(query)
  const live = orderSessions(
    sessions.filter((s) => !archived.has(s.id) && !s.summary?.isEmpty && matchesQuery(s, terms)),
    pins,
  )
  const pinned = live.filter((s) => pins.has(s.id))
  const others = live.filter((s) => !pins.has(s.id))
  const shown = expanded || terms.length ? others : others.slice(0, count)
  return { pinned, others: shown, hidden: others.length - shown.length, total: live.length }
}

export function archivedSessions(sessions, archived, query = '') {
  const terms = queryTerms(query)
  return orderSessions(
    sessions.filter((s) => archived.has(s.id) && !s.summary?.isEmpty && matchesQuery(s, terms)),
    new Set(),
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "now", "5m", "3h", "2d", then "Oct 4", or "Oct 4 2025" from another year
export function shortAge(ms, now) {
  if (!ms) return ''
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return 'now'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  if (s < 86400) return Math.floor(s / 3600) + 'h'
  if (s < 7 * 86400) return Math.floor(s / 86400) + 'd'
  const d = new Date(ms)
  const year = new Date(now).getFullYear() === d.getFullYear() ? '' : ' ' + d.getFullYear()
  return MONTHS[d.getMonth()] + ' ' + d.getDate() + year
}

// "Oct 4 2025, 14:02", or "Oct 4, 14:02" when `now` falls in the same year
export function longDate(ms, now) {
  if (!ms) return 'unknown'
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  const year = now && new Date(now).getFullYear() === d.getFullYear() ? '' : ' ' + d.getFullYear()
  return MONTHS[d.getMonth()] + ' ' + d.getDate() + year + ', ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

// "active now", "last active 3h ago", "last active Oct 4"
export function lastActive(ms, now) {
  const age = shortAge(ms, now)
  if (!age) return ''
  if (age === 'now') return 'active now'
  return 'last active ' + age + (/^\d/.test(age) ? ' ago' : '')
}

export function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// Cuts to `width` columns with an ellipsis; one line
export function fit(text, width) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (width <= 1) return t.slice(0, Math.max(0, width))
  return t.length > width ? t.slice(0, width - 1) + '…' : t
}

// A PowerShell single-quoted literal
export function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'"
}
